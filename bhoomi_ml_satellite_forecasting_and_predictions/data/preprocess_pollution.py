# BHOOMI — preprocess_pollution.py

import json
import logging
import os

import numpy as np
import pandas as pd

from config.constants import METRIC_RANGES, KEEP_COLUMNS, TRAINING_SPLIT_RATIO
from config.settings import RAW_DATA_DIR, PROCESSED_DATA_DIR, MODEL_SAVE_DIR
from data import validators

log = logging.getLogger(__name__)


def main():
    # ── Step 1: Load CSV ──────────────────────────────────────────────────────
    csv_path = RAW_DATA_DIR / "BHOOMI_Pollution.csv"
    file_size = os.path.getsize(csv_path)
    if file_size > 500 * 1024 * 1024:
        chunks = pd.read_csv(csv_path, chunksize=500_000)
        df = pd.concat(chunks, ignore_index=True)
    else:
        df = pd.read_csv(csv_path)
    log.info("Loaded Pollution: %s", df.shape)
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
    df, n = validators.enforce_range(df, "no2_ugm3", 0, 500, action="null"); outliers += n
    df, n = validators.enforce_range(df, "so2_ugm3", 0, 400, action="null"); outliers += n
    df, n = validators.enforce_range(df, "co_ugm3", 0, 15000, action="null"); outliers += n
    df, n = validators.enforce_range(df, "aqi_proxy", 0, 500, action="null"); outliers += n
    df, n = validators.enforce_range(df, "centroid_lat", 20, 25, action="null"); outliers += n
    df, n = validators.enforce_range(df, "centroid_lng", 70, 75, action="null"); outliers += n

    # ── Step 7b: AQI recomputation ───────────────────────────────────────────
    recompute_mask = (
        df["aqi_proxy"].isna()
        & df["no2_ugm3"].notna()
        & df["so2_ugm3"].notna()
    )
    if recompute_mask.any():
        co_safe = df.loc[recompute_mask, "co_ugm3"].fillna(0)
        raw_aqi = (
            0.5 * df.loc[recompute_mask, "no2_ugm3"] / 500
            + 0.3 * df.loc[recompute_mask, "so2_ugm3"] / 400
            + 0.2 * co_safe / 15000
        ) * 500
        df.loc[recompute_mask, "aqi_proxy"] = raw_aqi.round().clip(0, 500)
        log.info("AQI recomputed for %d rows", int(recompute_mask.sum()))

    # ── Step 8: Sort ──────────────────────────────────────────────────────────
    df = df.sort_values(["grid_id", "captured_at"]).reset_index(drop=True)

    # ── Step 9: Impute ────────────────────────────────────────────────────────
    all_drop = set()
    for metric in ["no2_ugm3", "so2_ugm3", "co_ugm3", "aqi_proxy"]:
        df, ds = validators.impute_per_grid(df, "grid_id", "captured_at", metric, max_gap=7)
        if metric == "aqi_proxy":
            all_drop |= ds
    if all_drop:
        df = df[~df["grid_id"].isin(all_drop)].copy()
        log.info("Dropped %d grids with insufficient aqi_proxy data", len(all_drop))

    # ── Step 10: Features ─────────────────────────────────────────────────────
    g = df.groupby("grid_id")
    df["aqi_lag1"] = g["aqi_proxy"].shift(1)
    df["aqi_lag7"] = g["aqi_proxy"].shift(7)
    df["aqi_lag30"] = g["aqi_proxy"].shift(30)
    df["aqi_roll7_mean"] = g["aqi_proxy"].transform(lambda x: x.rolling(7, min_periods=1).mean())
    df["aqi_roll30_mean"] = g["aqi_proxy"].transform(lambda x: x.rolling(30, min_periods=1).mean())
    df["aqi_delta7"] = df["aqi_proxy"] - df["aqi_lag7"]
    df["no2_lag7"] = g["no2_ugm3"].shift(7)
    df["so2_lag7"] = g["so2_ugm3"].shift(7)

    df["month"] = df["captured_at"].dt.month
    df["day_of_year"] = df["captured_at"].dt.dayofyear
    df["is_monsoon"] = df["month"].isin([6, 7, 8, 9]).astype(int)
    df["is_winter"] = df["month"].isin([11, 12, 1, 2]).astype(int)
    df["is_diwali"] = ((df["month"] == 10) | ((df["month"] == 11) & (df["day_of_year"] <= 315))).astype(int)
    df["is_harvest"] = df["month"].isin([10, 11]).astype(int)

    # ── Step 12: Drop rows where aqi_proxy null ──────────────────────────────
    df = df.dropna(subset=["aqi_proxy"]).copy()

    # ── Step 13: Save ─────────────────────────────────────────────────────────
    out_path = PROCESSED_DATA_DIR / "pollution_clean.csv"
    df.to_csv(out_path, index=False)
    log.info("Saved -> %s", out_path)

    # ── Step 14: Report ───────────────────────────────────────────────────────
    null_after = df.isnull().sum().to_dict()
    report = validators.generate_report(
        "pollution", orig_rows, len(df), null_before, null_after, outliers, all_drop
    )
    report_path = PROCESSED_DATA_DIR / "preprocessing_report.json"
    if report_path.exists():
        with open(report_path) as f:
            full_report = json.load(f)
    else:
        full_report = {}
    full_report["pollution"] = report
    with open(report_path, "w") as f:
        json.dump(full_report, f, indent=2)

    # ── Step 15 ───────────────────────────────────────────────────────────────
    print(f"Pollution preprocessing complete: {df.shape}")


if __name__ == "__main__":
    main()
