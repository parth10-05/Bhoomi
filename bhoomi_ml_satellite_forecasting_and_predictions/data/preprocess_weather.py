# BHOOMI — preprocess_weather.py

import json
import logging
import os

import numpy as np
import pandas as pd
from tqdm import tqdm

from config.constants import METRIC_RANGES, KEEP_COLUMNS
from config.settings import RAW_DATA_DIR, PROCESSED_DATA_DIR
from data import validators

log = logging.getLogger(__name__)

_DIR_LABELS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def _deg_to_label(deg):
    """Map wind direction degrees to 8-sector compass label."""
    if pd.isna(deg):
        return np.nan
    idx = int(((deg + 22.5) % 360) / 45)
    return _DIR_LABELS[idx]


def _interpolate_wind_direction(grp):
    """
    Circular-safe wind direction imputation:
    interpolate u_ms and v_ms linearly, then recompute wind_dir_deg.
    """
    grp["u_ms"] = grp["u_ms"].interpolate(method="linear", limit=7)
    grp["v_ms"] = grp["v_ms"].interpolate(method="linear", limit=7)

    recompute = grp["wind_dir_deg"].isna() & grp["u_ms"].notna() & grp["v_ms"].notna()
    both_zero = (grp["u_ms"] == 0) & (grp["v_ms"] == 0)
    recompute = recompute & ~both_zero
    if recompute.any():
        grp.loc[recompute, "wind_dir_deg"] = (
            270 - np.degrees(np.arctan2(grp.loc[recompute, "v_ms"], grp.loc[recompute, "u_ms"]))
        ) % 360
    return grp


def main():
    # ── Step 1: Load CSV ──────────────────────────────────────────────────────
    csv_path = RAW_DATA_DIR / "BHOOMI_Weather.csv"
    file_size = os.path.getsize(csv_path)
    if file_size > 500 * 1024 * 1024:
        chunks = pd.read_csv(csv_path, chunksize=500_000)
        df = pd.concat(chunks, ignore_index=True)
    else:
        df = pd.read_csv(csv_path)
    log.info("Loaded Weather: %s", df.shape)
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
    df, n = validators.enforce_range(df, "wind_speed_ms", 0, 35, action="null"); outliers += n
    df, n = validators.enforce_range(df, "wind_dir_deg", 0, 360, action="null"); outliers += n
    df, n = validators.enforce_range(df, "temp_celsius", 5, 55, action="null"); outliers += n
    df, n = validators.enforce_range(df, "u_ms", -30, 30, action="null"); outliers += n
    df, n = validators.enforce_range(df, "v_ms", -30, 30, action="null"); outliers += n

    # ── Step 7b: Wind recomputation from u/v ─────────────────────────────────
    # wind_dir_deg from u/v
    dir_mask = (
        df["wind_dir_deg"].isna()
        & df["u_ms"].notna()
        & df["v_ms"].notna()
        & ~((df["u_ms"] == 0) & (df["v_ms"] == 0))
    )
    if dir_mask.any():
        df.loc[dir_mask, "wind_dir_deg"] = (
            270 - np.degrees(np.arctan2(df.loc[dir_mask, "v_ms"], df.loc[dir_mask, "u_ms"]))
        ) % 360
        log.info("wind_dir_deg recomputed from u/v for %d rows", int(dir_mask.sum()))

    # wind_speed_ms from u/v
    spd_mask = df["wind_speed_ms"].isna() & df["u_ms"].notna() & df["v_ms"].notna()
    if spd_mask.any():
        df.loc[spd_mask, "wind_speed_ms"] = np.sqrt(
            df.loc[spd_mask, "u_ms"] ** 2 + df.loc[spd_mask, "v_ms"] ** 2
        )
        log.info("wind_speed_ms recomputed from u/v for %d rows", int(spd_mask.sum()))

    # ── Step 8: Sort ──────────────────────────────────────────────────────────
    df = df.sort_values(["grid_id", "captured_at"]).reset_index(drop=True)

    # ── Step 9: Impute ────────────────────────────────────────────────────────
    # Normal imputation for wind_speed_ms, temp_celsius
    drop_set = set()
    for metric in ["wind_speed_ms", "temp_celsius"]:
        df, ds = validators.impute_per_grid(df, "grid_id", "captured_at", metric, max_gap=7)
        drop_set |= ds

    # Circular imputation for wind_dir_deg via u/v
    chunks = []
    for gid, grp in tqdm(df.groupby("grid_id"), desc="Imputing wind_dir (circular)"):
        grp = grp.sort_values("captured_at")
        grp = _interpolate_wind_direction(grp)
        chunks.append(grp)
    df = pd.concat(chunks, ignore_index=True)

    if drop_set:
        df = df[~df["grid_id"].isin(drop_set)].copy()

    # ── Step 10: Features ─────────────────────────────────────────────────────
    g = df.groupby("grid_id")
    df["wind_lag1"] = g["wind_speed_ms"].shift(1)
    df["wind_roll3"] = g["wind_speed_ms"].transform(lambda x: x.rolling(3, min_periods=1).mean())
    df["is_high_wind"] = (df["wind_speed_ms"] > 5.0).astype(int)
    df["temp_lag1"] = g["temp_celsius"].shift(1)
    df["temp_roll7"] = g["temp_celsius"].transform(lambda x: x.rolling(7, min_periods=1).mean())
    df["wind_dir_label"] = df["wind_dir_deg"].apply(_deg_to_label)

    # ── Step 12: Drop rows where BOTH wind_speed and wind_dir null ───────────
    df = df.dropna(subset=["wind_speed_ms", "wind_dir_deg"], how="all").copy()

    # ── Step 13: Save ─────────────────────────────────────────────────────────
    out_path = PROCESSED_DATA_DIR / "weather_clean.csv"
    df.to_csv(out_path, index=False)
    log.info("Saved -> %s", out_path)

    # ── Step 14: Report ───────────────────────────────────────────────────────
    null_after = df.isnull().sum().to_dict()
    report = validators.generate_report(
        "weather", orig_rows, len(df), null_before, null_after, outliers, drop_set
    )
    report_path = PROCESSED_DATA_DIR / "preprocessing_report.json"
    if report_path.exists():
        with open(report_path) as f:
            full_report = json.load(f)
    else:
        full_report = {}
    full_report["weather"] = report
    with open(report_path, "w") as f:
        json.dump(full_report, f, indent=2)

    print(f"Weather preprocessing complete: {df.shape}")


if __name__ == "__main__":
    main()
