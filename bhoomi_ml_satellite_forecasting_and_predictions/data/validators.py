# BHOOMI — validators.py

import re
import logging
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from tqdm import tqdm

log = logging.getLogger(__name__)


# ── 1. enforce_range ──────────────────────────────────────────────────────────
def enforce_range(df, col, min_val, max_val, action="null"):
    """Set out-of-range values to NaN ('null') or clip them ('clamp')."""
    if df.empty or col not in df.columns:
        return df, 0

    mask = (df[col] < min_val) | (df[col] > max_val)
    count = int(mask.sum())

    if action == "clamp":
        df[col] = df[col].clip(min_val, max_val)
    else:
        df.loc[mask, col] = np.nan

    log.info("enforce_range %s [%s,%s] action=%s -> %d changed", col, min_val, max_val, action, count)
    return df, count


# ── 2. validate_grid_id ──────────────────────────────────────────────────────
_GRID_RE = re.compile(r"^[A-Z]{2}_[A-Z]{3}_R\d{3}_C\d{3}$")


def validate_grid_id(df, col="grid_id"):
    """Drop rows with null, empty, or malformed grid_id."""
    if df.empty or col not in df.columns:
        return df, 0

    before = len(df)
    valid = df[col].astype(str).apply(lambda v: bool(_GRID_RE.match(v)))
    df = df[valid].copy()
    dropped = before - len(df)
    log.info("validate_grid_id -> dropped %d rows", dropped)
    return df, dropped


# ── 3. check_date_window ─────────────────────────────────────────────────────
def check_date_window(df, col, years=4):
    """Keep only rows within [max_date - years, today]."""
    if df.empty or col not in df.columns:
        return df, 0

    before = len(df)
    today = pd.Timestamp(datetime.now().date())
    max_date = df[col].max()
    cutoff = max_date - pd.DateOffset(years=years)

    df = df[(df[col] >= cutoff) & (df[col] <= today)].copy()
    dropped = before - len(df)
    log.info("check_date_window [%s -> %s] -> dropped %d rows", cutoff.date(), today.date(), dropped)
    return df, dropped


# ── 4. remove_duplicates ─────────────────────────────────────────────────────
def remove_duplicates(df, subset):
    """Drop duplicate rows on *subset*, keeping first."""
    if df.empty:
        return df, 0

    before = len(df)
    df = df.drop_duplicates(subset=subset, keep="first").copy()
    dropped = before - len(df)
    log.info("remove_duplicates on %s -> dropped %d rows", subset, dropped)
    return df, dropped


# ── 5. impute_per_grid ───────────────────────────────────────────────────────
def impute_per_grid(df, grid_col, date_col, metric_col, max_gap=7):
    """
    Per-grid daily imputation:
      a. Reindex to daily frequency.
      b. Linear-interpolate gaps <= max_gap days.
      c. Remaining gaps: fill with that grid's monthly median.
      d. Grids with < 30 valid rows -> drop_set.
    """
    if df.empty or metric_col not in df.columns:
        return df, set()

    drop_set = set()
    chunks = []

    grids = df[grid_col].unique()
    for gid in tqdm(grids, desc=f"Imputing {metric_col}"):
        grp = df[df[grid_col] == gid].copy()
        grp = grp.set_index(date_col).sort_index()

        # a. reindex to daily
        idx = pd.date_range(grp.index.min(), grp.index.max(), freq="D")
        grp = grp.reindex(idx)
        grp.index.name = date_col

        # forward-fill grid metadata (grid_id, centroid_*)
        for c in [grid_col, "centroid_lat", "centroid_lng"]:
            if c in grp.columns:
                grp[c] = grp[c].ffill().bfill()

        # b. linear interpolate small gaps
        grp[metric_col] = grp[metric_col].interpolate(method="linear", limit=max_gap)

        # c. monthly median for remaining gaps
        still_null = grp[metric_col].isna()
        if still_null.any():
            monthly_med = grp[metric_col].groupby(grp.index.month).transform("median")
            grp[metric_col] = grp[metric_col].fillna(monthly_med)

        # d. check validity
        valid_count = grp[metric_col].notna().sum()
        if valid_count < 30:
            drop_set.add(gid)

        grp = grp.reset_index()
        chunks.append(grp)

    if not chunks:
        return df, drop_set

    result = pd.concat(chunks, ignore_index=True)
    log.info("impute_per_grid %s -> %d grids flagged for drop", metric_col, len(drop_set))
    return result, drop_set


# ── 6. generate_report ───────────────────────────────────────────────────────
def generate_report(name, orig_rows, final_rows, null_before, null_after,
                    outliers, grids_dropped):
    """Return structured dict for preprocessing_report.json."""
    return {
        "dataset": name,
        "original_rows": int(orig_rows),
        "final_rows": int(final_rows),
        "rows_removed": int(orig_rows - final_rows),
        "null_before": {k: int(v) for k, v in null_before.items()} if isinstance(null_before, dict) else int(null_before),
        "null_after": {k: int(v) for k, v in null_after.items()} if isinstance(null_after, dict) else int(null_after),
        "outliers_handled": int(outliers),
        "grids_dropped": list(grids_dropped) if grids_dropped else [],
        "grids_dropped_count": len(grids_dropped) if grids_dropped else 0,
    }
