# BHOOMI — preprocess_lst.py

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
    csv_path = RAW_DATA_DIR / "BHOOMI_LST.csv"
    file_size = os.path.getsize(csv_path)
    if file_size > 500 * 1024 * 1024:
        chunks = pd.read_csv(csv_path, chunksize=500_000)
        df = pd.concat(chunks, ignore_index=True)
    else:
        df = pd.read_csv(csv_path)
    log.info("Loaded LST: %s", df.shape)
    orig_rows = len(df)

    # ── Step 2: Drop unnecessary columns ──────────────────────────────────────
    df = df.drop(columns=["row_idx", "col_idx", "pixel_count", "source"], errors="ignore")

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
    df, n = validators.enforce_range(df, "lst_celsius", 10, 65, action="null")
    outliers += n
    df, n = validators.enforce_range(df, "data_quality", 0, 1, action="clamp")
    outliers += n
    df, n = validators.enforce_range(df, "centroid_lat", 20, 25, action="null")
    outliers += n
    df, n = validators.enforce_range(df, "centroid_lng", 70, 75, action="null")
    outliers += n

    # ── Step 8: Sort ──────────────────────────────────────────────────────────
    df = df.sort_values(["grid_id", "captured_at"]).reset_index(drop=True)

    # ── Step 9: Impute lst_celsius ────────────────────────────────────────────
    df, drop_set = validators.impute_per_grid(df, "grid_id", "captured_at", "lst_celsius", max_gap=7)
    if drop_set:
        df = df[~df["grid_id"].isin(drop_set)].copy()
        log.info("Dropped %d grids with insufficient data", len(drop_set))

    # ── Step 10: Monthly means & anomaly ──────────────────────────────────────
    monthly_means = {}
    for gid, grp in df.groupby("grid_id"):
        grp_sorted = grp.sort_values("captured_at")
        split_idx = int(len(grp_sorted) * TRAINING_SPLIT_RATIO)
        train = grp_sorted.iloc[:split_idx]
        means = train.groupby(train["captured_at"].dt.month)["lst_celsius"].mean()
        monthly_means[gid] = {str(int(m)): round(v, 4) for m, v in means.items()}

    means_path = MODEL_SAVE_DIR / "lst_monthly_means.json"
    with open(means_path, "w") as f:
        json.dump(monthly_means, f, indent=2)
    log.info("Saved monthly means -> %s", means_path)

    df["month"] = df["captured_at"].dt.month
    df["lst_monthly_mean"] = df.apply(
        lambda r: monthly_means.get(r["grid_id"], {}).get(str(int(r["month"])), np.nan),
        axis=1,
    )
    df["lst_anomaly"] = df["lst_celsius"] - df["lst_monthly_mean"]

    # ── Step 11: Lag / rolling features ───────────────────────────────────────
    g = df.groupby("grid_id")
    df["lst_lag1"] = g["lst_celsius"].shift(1)
    df["lst_lag7"] = g["lst_celsius"].shift(7)
    df["lst_roll7_mean"] = g["lst_celsius"].transform(lambda x: x.rolling(7, min_periods=1).mean())
    df["lst_delta7"] = df["lst_celsius"] - df["lst_lag7"]
    df["day_of_year"] = df["captured_at"].dt.dayofyear
    df["is_monsoon"] = df["month"].isin([6, 7, 8, 9]).astype(int)
    df["is_summer"] = df["month"].isin([3, 4, 5]).astype(int)

    # ── Step 12: Drop remaining nulls ─────────────────────────────────────────
    df = df.dropna(subset=["lst_celsius"]).copy()

    # ── Step 13: Save ─────────────────────────────────────────────────────────
    out_path = PROCESSED_DATA_DIR / "lst_clean.csv"
    df.to_csv(out_path, index=False)
    log.info("Saved -> %s", out_path)

    # ── Step 14: Report ───────────────────────────────────────────────────────
    null_after = df.isnull().sum().to_dict()
    report = validators.generate_report(
        "lst", orig_rows, len(df), null_before, null_after, outliers, drop_set
    )

    report_path = PROCESSED_DATA_DIR / "preprocessing_report.json"
    if report_path.exists():
        with open(report_path) as f:
            full_report = json.load(f)
    else:
        full_report = {}
    full_report["lst"] = report
    with open(report_path, "w") as f:
        json.dump(full_report, f, indent=2)

    # ── Step 15 ───────────────────────────────────────────────────────────────
    print(f"LST preprocessing complete: {df.shape}")


if __name__ == "__main__":
    main()
