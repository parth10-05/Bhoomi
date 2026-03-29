# BHOOMI — preprocess_vegetation.py

import json
import logging
import os

import numpy as np
import pandas as pd
from tqdm import tqdm

from config.constants import METRIC_RANGES, KEEP_COLUMNS, TRAINING_SPLIT_RATIO
from config.settings import RAW_DATA_DIR, PROCESSED_DATA_DIR, MODEL_SAVE_DIR
from data import validators

log = logging.getLogger(__name__)


def _impute_ndvi_monsoon(df, grid_col, date_col, max_gap=7):
    """
    Special NDVI imputation: during monsoon (Jun-Sep) gaps > max_gap days,
    use same grid's same-month median from the previous year rather than
    linear interpolation.
    """
    chunks = []
    for gid, grp in tqdm(df.groupby(grid_col), desc="Imputing ndvi (monsoon-aware)"):
        grp = grp.set_index(date_col).sort_index()
        idx = pd.date_range(grp.index.min(), grp.index.max(), freq="D")
        grp = grp.reindex(idx)
        grp.index.name = date_col

        for c in [grid_col, "centroid_lat", "centroid_lng"]:
            if c in grp.columns:
                grp[c] = grp[c].ffill().bfill()

        # Compute previous-year monthly medians
        prev_year_med = {}
        for yr in grp.index.year.unique():
            prev = grp[grp.index.year == yr - 1]
            if not prev.empty:
                for mo in range(1, 13):
                    vals = prev.loc[prev.index.month == mo, "ndvi"].dropna()
                    if not vals.empty:
                        prev_year_med[(yr, mo)] = vals.median()

        # Standard linear interp for small gaps
        grp["ndvi"] = grp["ndvi"].interpolate(method="linear", limit=max_gap)

        # Monsoon large-gap fill with previous year median
        still_null = grp["ndvi"].isna()
        monsoon_null = still_null & grp.index.month.isin([6, 7, 8, 9])
        for idx_ts in grp.index[monsoon_null]:
            key = (idx_ts.year, idx_ts.month)
            if key in prev_year_med:
                grp.loc[idx_ts, "ndvi"] = prev_year_med[key]

        # Remaining gaps: monthly median from own data
        still_null2 = grp["ndvi"].isna()
        if still_null2.any():
            monthly_med = grp["ndvi"].groupby(grp.index.month).transform("median")
            grp["ndvi"] = grp["ndvi"].fillna(monthly_med)

        grp = grp.reset_index()
        chunks.append(grp)

    if not chunks:
        return df, set()

    result = pd.concat(chunks, ignore_index=True)
    drop_set = set()
    for gid, grp in result.groupby(grid_col):
        if grp["ndvi"].notna().sum() < 30:
            drop_set.add(gid)
    return result, drop_set


def main():
    # ── Step 1: Load CSV ──────────────────────────────────────────────────────
    csv_path = RAW_DATA_DIR / "BHOOMI_Vegetation.csv"
    file_size = os.path.getsize(csv_path)
    if file_size > 500 * 1024 * 1024:
        chunks = pd.read_csv(csv_path, chunksize=500_000)
        df = pd.concat(chunks, ignore_index=True)
    else:
        df = pd.read_csv(csv_path)
    log.info("Loaded Vegetation: %s", df.shape)
    orig_rows = len(df)

    # ── Step 2: Drop columns ─────────────────────────────────────────────────
    df = df.drop(columns=["row_idx", "col_idx", "period_end", "source"], errors="ignore")

    # ── Step 3: Parse dates ───────────────────────────────────────────────────
    df["captured_at"] = pd.to_datetime(df["captured_at"], errors="coerce")
    df = df.dropna(subset=["captured_at"]).copy()

    # ── Step 4: Validate grid_id ──────────────────────────────────────────────
    df, _ = validators.validate_grid_id(df)

    # ── Step 5: Date window ───────────────────────────────────────────────────
    df, _ = validators.check_date_window(df, "captured_at", years=4)

    # ── Step 6: Remove duplicates ─────────────────────────────────────────────
    df, _ = validators.remove_duplicates(df, ["grid_id", "captured_at"])

    # ── Step 7: Enforce ranges ────────────────────────────────────────────────
    null_before = df.isnull().sum().to_dict()
    outliers = 0
    df, n = validators.enforce_range(df, "ndvi", -0.1, 0.9, action="null"); outliers += n
    df, n = validators.enforce_range(df, "vci", 0, 1, action="clamp"); outliers += n
    df, n = validators.enforce_range(df, "tci", 0, 1, action="clamp"); outliers += n
    df, n = validators.enforce_range(df, "vhi", 0, 1, action="null"); outliers += n

    # ── Step 7b: VHI recompute ───────────────────────────────────────────────
    vhi_mask = df["vhi"].isna() & df["vci"].notna() & df["tci"].notna()
    if vhi_mask.any():
        df.loc[vhi_mask, "vhi"] = (0.5 * df.loc[vhi_mask, "vci"] + 0.5 * df.loc[vhi_mask, "tci"]).round(4)
        log.info("VHI recomputed for %d rows", int(vhi_mask.sum()))

    # ── Step 8: Sort ──────────────────────────────────────────────────────────
    df = df.sort_values(["grid_id", "captured_at"]).reset_index(drop=True)

    # ── Step 9: Impute ────────────────────────────────────────────────────────
    df, drop_set = _impute_ndvi_monsoon(df, "grid_id", "captured_at", max_gap=7)

    for metric in ["vhi", "vci", "tci"]:
        df, ds = validators.impute_per_grid(df, "grid_id", "captured_at", metric, max_gap=7)
        drop_set |= ds

    if drop_set:
        df = df[~df["grid_id"].isin(drop_set)].copy()
        log.info("Dropped %d grids with insufficient ndvi data", len(drop_set))

    # ── Step 10: Features ─────────────────────────────────────────────────────
    g = df.groupby("grid_id")
    df["ndvi_lag7"] = g["ndvi"].shift(7)
    df["ndvi_lag30"] = g["ndvi"].shift(30)
    df["ndvi_roll30_mean"] = g["ndvi"].transform(lambda x: x.rolling(30, min_periods=1).mean())
    df["ndvi_delta7"] = df["ndvi"] - df["ndvi_lag7"]
    df["vhi_lag7"] = g["vhi"].shift(7)

    df["month"] = df["captured_at"].dt.month
    df["is_monsoon"] = df["month"].isin([6, 7, 8, 9]).astype(int)
    df["is_post_monsoon"] = df["month"].isin([10, 11]).astype(int)
    df["is_dry"] = df["month"].isin([3, 4, 5]).astype(int)

    # ── Step 12: Drop rows where BOTH ndvi AND vhi null ──────────────────────
    df = df.dropna(subset=["ndvi", "vhi"], how="all").copy()

    # ── Step 13: Save ─────────────────────────────────────────────────────────
    out_path = PROCESSED_DATA_DIR / "vegetation_clean.csv"
    df.to_csv(out_path, index=False)
    log.info("Saved -> %s", out_path)

    # ── Step 14: Report ───────────────────────────────────────────────────────
    null_after = df.isnull().sum().to_dict()
    report = validators.generate_report(
        "vegetation", orig_rows, len(df), null_before, null_after, outliers, drop_set
    )
    report_path = PROCESSED_DATA_DIR / "preprocessing_report.json"
    if report_path.exists():
        with open(report_path) as f:
            full_report = json.load(f)
    else:
        full_report = {}
    full_report["vegetation"] = report
    with open(report_path, "w") as f:
        json.dump(full_report, f, indent=2)

    print(f"Vegetation preprocessing complete: {df.shape}")


if __name__ == "__main__":
    main()
