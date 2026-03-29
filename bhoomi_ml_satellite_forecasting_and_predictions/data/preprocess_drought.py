# BHOOMI — preprocess_drought.py

import json
import logging
import os

import numpy as np
import pandas as pd

from config.constants import METRIC_RANGES, KEEP_COLUMNS
from config.settings import RAW_DATA_DIR, PROCESSED_DATA_DIR
from data import validators

log = logging.getLogger(__name__)


def main():
    # ── Step 1: Load CSV ──────────────────────────────────────────────────────
    csv_path = RAW_DATA_DIR / "BHOOMI_Drought.csv"
    file_size = os.path.getsize(csv_path)
    if file_size > 500 * 1024 * 1024:
        chunks = pd.read_csv(csv_path, chunksize=500_000)
        df = pd.concat(chunks, ignore_index=True)
    else:
        df = pd.read_csv(csv_path)
    log.info("Loaded Drought: %s", df.shape)
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
    df, n = validators.enforce_range(df, "soil_moisture", 0, 0.6, action="null"); outliers += n
    df, n = validators.enforce_range(df, "soil_moisture_deficit", -0.5, 0.5, action="null"); outliers += n
    df, n = validators.enforce_range(df, "spi_30d", -3, 3, action="clamp"); outliers += n
    df, n = validators.enforce_range(df, "rainfall_mm", 0, 300, action="null"); outliers += n
    df, n = validators.enforce_range(df, "drought_risk", 0, 1, action="null"); outliers += n

    # ── Step 7b: drought_risk recomputation ──────────────────────────────────
    dr_mask = (
        df["drought_risk"].isna()
        & df["soil_moisture"].notna()
        & df["spi_30d"].notna()
    )
    if dr_mask.any():
        sm = df.loc[dr_mask, "soil_moisture"]
        spi = df.loc[dr_mask, "spi_30d"]
        soil_deficit_norm = ((0.3 - sm) / 0.3).clip(lower=0)
        spi_contrib = (-spi).clip(lower=0) / 3.0
        dr = (0.6 * soil_deficit_norm + 0.4 * spi_contrib).round(4).clip(0, 1)
        df.loc[dr_mask, "drought_risk"] = dr
        log.info("drought_risk recomputed for %d rows", int(dr_mask.sum()))

    # ── Step 8: Sort ──────────────────────────────────────────────────────────
    df = df.sort_values(["grid_id", "captured_at"]).reset_index(drop=True)

    # ── Step 9: Impute ────────────────────────────────────────────────────────
    drop_set = set()
    for metric in ["soil_moisture", "spi_30d", "drought_risk"]:
        df, ds = validators.impute_per_grid(df, "grid_id", "captured_at", metric, max_gap=7)
        drop_set |= ds

    # rainfall_mm: only interpolate true NaN, never replace 0.0
    df, ds = validators.impute_per_grid(df, "grid_id", "captured_at", "rainfall_mm", max_gap=7)
    drop_set |= ds

    if drop_set:
        df = df[~df["grid_id"].isin(drop_set)].copy()
        log.info("Dropped %d grids with insufficient drought data", len(drop_set))

    # ── Step 10: Features ─────────────────────────────────────────────────────
    g = df.groupby("grid_id")
    df["soil_lag7"] = g["soil_moisture"].shift(7)
    df["soil_lag30"] = g["soil_moisture"].shift(30)
    df["soil_roll30_mean"] = g["soil_moisture"].transform(lambda x: x.rolling(30, min_periods=1).mean())
    df["rainfall_roll30"] = g["rainfall_mm"].transform(lambda x: x.rolling(30, min_periods=1).sum())
    df["drought_lag7"] = g["drought_risk"].shift(7)
    df["drought_lag30"] = g["drought_risk"].shift(30)
    df["spi_trend"] = df["spi_30d"] - g["spi_30d"].shift(7)

    df["month"] = df["captured_at"].dt.month
    df["is_monsoon"] = df["month"].isin([6, 7, 8, 9]).astype(int)
    df["is_pre_monsoon"] = df["month"].isin([4, 5]).astype(int)

    # ── Step 12: Drop rows where drought_risk null ───────────────────────────
    df = df.dropna(subset=["drought_risk"]).copy()

    # ── Step 13: Save ─────────────────────────────────────────────────────────
    out_path = PROCESSED_DATA_DIR / "drought_clean.csv"
    df.to_csv(out_path, index=False)
    log.info("Saved -> %s", out_path)

    # ── Step 14: Report ───────────────────────────────────────────────────────
    null_after = df.isnull().sum().to_dict()
    report = validators.generate_report(
        "drought", orig_rows, len(df), null_before, null_after, outliers, drop_set
    )
    report_path = PROCESSED_DATA_DIR / "preprocessing_report.json"
    if report_path.exists():
        with open(report_path) as f:
            full_report = json.load(f)
    else:
        full_report = {}
    full_report["drought"] = report
    with open(report_path, "w") as f:
        json.dump(full_report, f, indent=2)

    print(f"Drought preprocessing complete: {df.shape}")


if __name__ == "__main__":
    main()
