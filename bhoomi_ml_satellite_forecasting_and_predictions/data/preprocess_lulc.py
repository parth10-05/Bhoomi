# BHOOMI — preprocess_lulc.py

import json
import logging
import os
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from config.constants import METRIC_RANGES, KEEP_COLUMNS
from config.settings import RAW_DATA_DIR, PROCESSED_DATA_DIR
from data import validators

log = logging.getLogger(__name__)

VALID_CLASSES = ["urban", "trees", "crops", "water", "bare", "rangeland", "flooded", "built"]
PCT_COLS = ["water_pct", "trees_pct", "flooded_pct", "crops_pct", "built_pct", "bare_pct", "rangeland_pct"]

# Map pct column name -> class label for dominant_class recomputation
_PCT_TO_CLASS = {
    "water_pct": "water", "trees_pct": "trees", "flooded_pct": "flooded",
    "crops_pct": "crops", "built_pct": "built", "bare_pct": "bare",
    "rangeland_pct": "rangeland",
}


def main():
    # ── Step 1: Load CSV ──────────────────────────────────────────────────────
    csv_path = RAW_DATA_DIR / "BHOOMI_LULC.csv"
    file_size = os.path.getsize(csv_path)
    if file_size > 500 * 1024 * 1024:
        chunks = pd.read_csv(csv_path, chunksize=500_000)
        df = pd.concat(chunks, ignore_index=True)
    else:
        df = pd.read_csv(csv_path)
    log.info("Loaded LULC: %s", df.shape)
    orig_rows = len(df)

    # ── Step 2: Drop columns ─────────────────────────────────────────────────
    df = df.drop(columns=["row_idx", "col_idx", "snapshot_year", "source"], errors="ignore")

    # ── Step 3: Parse snapshot_date ───────────────────────────────────────────
    df["snapshot_date"] = pd.to_datetime(df["snapshot_date"], errors="coerce")
    df = df.dropna(subset=["snapshot_date"]).copy()

    # ── Step 4: Validate grid_id ──────────────────────────────────────────────
    df, _ = validators.validate_grid_id(df)

    # ── Step 6: Remove duplicates (keep latest) ──────────────────────────────
    df = df.sort_values(["grid_id", "snapshot_date"]).drop_duplicates(
        subset=["grid_id", "snapshot_date"], keep="last"
    ).copy()

    # ── Step 7: Enforce ranges on pct columns ────────────────────────────────
    null_before = df.isnull().sum().to_dict()
    outliers = 0
    for col in PCT_COLS + ["dominant_class_pct"]:
        if col in df.columns:
            df, n = validators.enforce_range(df, col, 0, 100, action="clamp")
            outliers += n

    # ── Step 7b: Pct sum normalisation ───────────────────────────────────────
    pct_sum = df[PCT_COLS].sum(axis=1)
    all_null = df[PCT_COLS].isna().all(axis=1)

    # Fill rows where all pct cols are null
    if all_null.any():
        fill_val = 100.0 / 7
        for col in PCT_COLS:
            df.loc[all_null, col] = fill_val
        log.info("Filled %d rows with uniform pct (100/7)", int(all_null.sum()))
        pct_sum = df[PCT_COLS].sum(axis=1)

    # Normalise where sum is outside [95, 105]
    needs_norm = (pct_sum > 105) | (pct_sum < 95)
    needs_norm = needs_norm & ~all_null
    if needs_norm.any():
        row_sums = df.loc[needs_norm, PCT_COLS].sum(axis=1)
        for col in PCT_COLS:
            df.loc[needs_norm, col] = (df.loc[needs_norm, col] / row_sums * 100)
        log.info("Normalised pct sums for %d rows", int(needs_norm.sum()))

    # ── Step 7c: dominant_class validation ───────────────────────────────────
    if "dominant_class" in df.columns:
        invalid_mask = ~df["dominant_class"].isin(VALID_CLASSES)
        if invalid_mask.any():
            df.loc[invalid_mask, "dominant_class"] = np.nan
            # Recompute from highest pct column
            null_class = df["dominant_class"].isna()
            if null_class.any():
                best_col = df.loc[null_class, PCT_COLS].idxmax(axis=1)
                df.loc[null_class, "dominant_class"] = best_col.map(_PCT_TO_CLASS)
            log.info("Recomputed dominant_class for %d rows", int(invalid_mask.sum()))

    # ── Step 8: Sort ──────────────────────────────────────────────────────────
    df = df.sort_values(["grid_id", "snapshot_date"]).reset_index(drop=True)

    # ── Step 9: Add valid_until ───────────────────────────────────────────────
    today_plus_3y = pd.Timestamp(datetime.now()) + pd.DateOffset(years=3)
    valid_untils = []
    for gid, grp in df.groupby("grid_id"):
        dates = grp["snapshot_date"].values
        vu = []
        for i in range(len(dates)):
            if i + 1 < len(dates):
                vu.append(dates[i + 1])
            else:
                vu.append(today_plus_3y)
        valid_untils.extend(vu)
    df["valid_until"] = valid_untils

    # ── Step 10: Features ─────────────────────────────────────────────────────
    df["urban_plus_built"] = df["built_pct"] + (df["dominant_class"] == "urban").astype(float) * df["dominant_class_pct"] * 0.5
    df["green_cover"] = df["trees_pct"] + df["crops_pct"] * 0.3

    # ── Step 12: Drop rows where dominant_class null ─────────────────────────
    drop_set = set()
    df = df.dropna(subset=["dominant_class"]).copy()

    # ── Step 13: Save ─────────────────────────────────────────────────────────
    out_path = PROCESSED_DATA_DIR / "lulc_clean.csv"
    df.to_csv(out_path, index=False)
    log.info("Saved -> %s", out_path)

    # ── Step 14: Report ───────────────────────────────────────────────────────
    null_after = df.isnull().sum().to_dict()
    report = validators.generate_report(
        "lulc", orig_rows, len(df), null_before, null_after, outliers, drop_set
    )
    report_path = PROCESSED_DATA_DIR / "preprocessing_report.json"
    if report_path.exists():
        with open(report_path) as f:
            full_report = json.load(f)
    else:
        full_report = {}
    full_report["lulc"] = report
    with open(report_path, "w") as f:
        json.dump(full_report, f, indent=2)

    print(f"LULC preprocessing complete: {df.shape}")


if __name__ == "__main__":
    main()
