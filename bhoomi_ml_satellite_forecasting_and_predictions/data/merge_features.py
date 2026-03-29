# BHOOMI — merge_features.py

import logging

import numpy as np
import pandas as pd

from config.settings import PROCESSED_DATA_DIR

log = logging.getLogger(__name__)

# Source files
_DAILY_FILES = {
    "lst": "lst_clean.csv",
    "pollution": "pollution_clean.csv",
    "vegetation": "vegetation_clean.csv",
    "weather": "weather_clean.csv",
    "drought": "drought_clean.csv",
}
_LULC_FILE = "lulc_clean.csv"


def _load(name, date_col="captured_at"):
    path = PROCESSED_DATA_DIR / name
    df = pd.read_csv(path)
    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    log.info("Loaded %s: %s", name, df.shape)
    return df


def _dedupe_columns(df):
    """After merges, resolve _x/_y duplicate columns: keep first non-null."""
    cols_done = set()
    drop_cols = []
    for c in list(df.columns):
        if c.endswith("_x") or c.endswith("_y"):
            base = c[:-2]
            if base in cols_done:
                continue
            x_col = f"{base}_x"
            y_col = f"{base}_y"
            if x_col in df.columns and y_col in df.columns:
                df[base] = df[x_col].fillna(df[y_col])
                drop_cols.extend([x_col, y_col])
                cols_done.add(base)
    df = df.drop(columns=[c for c in drop_cols if c in df.columns])
    return df


def main():
    # ── Step 1: Load all 6 datasets ───────────────────────────────────────────
    daily = {}
    for key, fname in _DAILY_FILES.items():
        daily[key] = _load(fname, "captured_at")

    lulc = _load(_LULC_FILE, "snapshot_date")

    # ── Step 2: LULC merge_asof ───────────────────────────────────────────────
    lulc = lulc.sort_values(["grid_id", "snapshot_date"])

    # ── Step 3: Outer-merge daily tables ──────────────────────────────────────
    # Start with pollution (priority for centroid)
    merge_order = ["pollution", "lst", "vegetation", "weather", "drought"]
    merged = daily[merge_order[0]].copy()

    for key in merge_order[1:]:
        right = daily[key]
        merged = pd.merge(merged, right, on=["grid_id", "captured_at"],
                          how="outer", suffixes=("", f"_{key}"))

    # Resolve centroid duplicates: keep first non-null in priority order
    for coord in ["centroid_lat", "centroid_lng"]:
        suffixed = [f"{coord}_{k}" for k in merge_order[1:]]
        existing = [c for c in suffixed if c in merged.columns]
        for sc in existing:
            merged[coord] = merged[coord].fillna(merged[sc])
        merged = merged.drop(columns=[c for c in existing if c in merged.columns])

    # Resolve any remaining _x/_y columns
    merged = _dedupe_columns(merged)

    # ── LULC join via merge_asof ──────────────────────────────────────────────
    merged = merged.sort_values(["grid_id", "captured_at"]).reset_index(drop=True)
    lulc_cols = [c for c in lulc.columns if c not in ["centroid_lat", "centroid_lng", "valid_until"]]
    lulc_for_merge = lulc[lulc_cols].rename(columns={"snapshot_date": "captured_at"}).copy()
    lulc_for_merge = lulc_for_merge.sort_values(["grid_id", "captured_at"])

    merged = pd.merge_asof(
        merged.sort_values("captured_at"),
        lulc_for_merge.sort_values("captured_at"),
        on="captured_at",
        by="grid_id",
        direction="backward",
    )
    merged = _dedupe_columns(merged)

    # ── Step 4: Assert no null keys ───────────────────────────────────────────
    if merged["grid_id"].isna().any() or merged["captured_at"].isna().any():
        raise ValueError("Null grid_id or captured_at found after merge!")

    # ── Step 5: Sort ──────────────────────────────────────────────────────────
    merged = merged.sort_values(["grid_id", "captured_at"]).reset_index(drop=True)

    # ── Step 6: Composite columns ─────────────────────────────────────────────
    # Normalised metrics
    merged["aqi_norm"] = merged["aqi_proxy"].clip(0, 500) / 500 if "aqi_proxy" in merged.columns else 0
    merged["lst_norm"] = (merged["lst_celsius"].clip(10, 65) - 10) / 55 if "lst_celsius" in merged.columns else 0

    ndvi_col = merged["ndvi"] if "ndvi" in merged.columns else pd.Series(0, index=merged.index)
    merged["ndvi_norm"] = (ndvi_col.clip(-0.1, 0.9) + 0.1) / 1.0

    merged["drought_norm"] = merged["drought_risk"].clip(0, 1) if "drought_risk" in merged.columns else 0

    # Carbon balance
    aqi_n = merged["aqi_norm"].fillna(0.5) if "aqi_norm" in merged.columns else 0.5
    built = merged["built_pct"].fillna(50) / 100 if "built_pct" in merged.columns else 0.5
    co = merged["co_ugm3"].fillna(5000) / 15000 if "co_ugm3" in merged.columns else 5000 / 15000
    trees = merged["trees_pct"].fillna(10) / 100 if "trees_pct" in merged.columns else 0.1
    ndvi_n = merged["ndvi_norm"].fillna(0.3) if "ndvi_norm" in merged.columns else 0.3
    crops = merged["crops_pct"].fillna(20) / 100 if "crops_pct" in merged.columns else 0.2

    carbon_source = aqi_n * 0.40 + built * 0.35 + co * 0.25
    carbon_sink = trees * 0.50 + ndvi_n * 0.30 + crops * 0.20
    merged["carbon_balance"] = (carbon_sink - carbon_source).clip(-1, 1).round(4)

    # Composite risk
    aqi_r = merged["aqi_norm"].fillna(0) if "aqi_norm" in merged.columns else 0
    lst_r = merged["lst_norm"].fillna(0) if "lst_norm" in merged.columns else 0
    dr_r = merged["drought_norm"].fillna(0) if "drought_norm" in merged.columns else 0
    ndvi_r = merged["ndvi_norm"].fillna(0.5) if "ndvi_norm" in merged.columns else 0.5

    merged["composite_risk"] = (
        (0.30 * aqi_r + 0.25 * lst_r + 0.25 * dr_r + 0.20 * (1 - ndvi_r)) * 10
    ).clip(0, 10).round(4)

    # ── Step 7: Save ──────────────────────────────────────────────────────────
    out_path = PROCESSED_DATA_DIR / "merged_features.csv"
    merged.to_csv(out_path, index=False)
    log.info("Saved -> %s", out_path)

    # ── Step 8: Summary stats ─────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"Merged features: {merged.shape[0]} rows, {merged.shape[1]} columns")
    print(f"Unique grids:    {merged['grid_id'].nunique()}")
    print(f"Date range:      {merged['captured_at'].min()} -> {merged['captured_at'].max()}")

    null_pct = (merged.isnull().sum() / len(merged) * 100).round(2)
    print(f"\nNull % per column:")
    for col, pct in null_pct.items():
        if pct > 0:
            print(f"  {col}: {pct}%")

    if "carbon_balance" in merged.columns:
        cb = merged["carbon_balance"].dropna()
        print(f"\nCarbon balance:")
        print(f"  Mean:   {cb.mean():.4f}")
        print(f"  Median: {cb.median():.4f}")
        positive_grids = merged.groupby("grid_id")["carbon_balance"].mean()
        pct_positive = (positive_grids > 0).sum() / len(positive_grids) * 100
        print(f"  Positive grids: {pct_positive:.1f}%")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
