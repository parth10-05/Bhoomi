# BHOOMI — attribution.py
"""
Causal attribution pipeline.
Orchestrates full attribution + 3×3 neighbourhood context + report_context assembly.
"""

import json
import logging
from datetime import datetime

import pandas as pd
from tqdm import tqdm

from config.settings import PROCESSED_DATA_DIR, OUTPUT_DIR
from causal.wind_transport import (
    get_upwind_grids,
    get_moore_neighbours,
    bearing_deg,
    label_direction,
)
from causal.rule_engine import (
    evaluate_aqi,
    evaluate_ndvi,
    evaluate_lst,
    evaluate_drought,
    nlg_summary,
)

log = logging.getLogger(__name__)


# ────────────────────────────────────────────────────────────────────────────
# Per-grid attribution
# ────────────────────────────────────────────────────────────────────────────

def run_grid(grid_id: str, obs: dict, all_grids_obs_df: pd.DataFrame) -> dict:
    """Full causal attribution for a single grid."""
    lat, lng = obs["centroid_lat"], obs["centroid_lng"]
    wind = obs.get("wind_dir_deg")

    # Upwind source grids (if wind direction available)
    upwind = (
        get_upwind_grids(lat, lng, wind, all_grids_obs_df)
        if wind is not None and pd.notna(wind)
        else pd.DataFrame()
    )

    # Moore (3×3) neighbours
    neighbours = get_moore_neighbours(lat, lng, all_grids_obs_df)

    # LULC fractions for the current grid
    lulc = {
        k: obs.get(k)
        for k in ["built_pct", "trees_pct", "crops_pct", "bare_pct", "rangeland_pct"]
    }

    # Merge relevant metric columns into upwind / neighbour frames
    if not upwind.empty:
        merge_cols = [c for c in ["grid_id", "so2_ugm3", "no2_ugm3"] if c in all_grids_obs_df.columns]
        if len(merge_cols) > 1:
            upwind = upwind.merge(all_grids_obs_df[merge_cols], on="grid_id", how="left")

    if not neighbours.empty:
        merge_cols = [c for c in ["grid_id", "lst_celsius", "ndvi", "vhi"] if c in all_grids_obs_df.columns]
        if len(merge_cols) > 1:
            neighbours = neighbours.merge(all_grids_obs_df[merge_cols], on="grid_id", how="left")

    # Evaluate causal factors per domain
    aqi_f = evaluate_aqi(obs, upwind, lulc) if obs.get("aqi_proxy") else []
    ndvi_f = evaluate_ndvi(obs, neighbours, lulc) if obs.get("ndvi") else []
    lst_f = evaluate_lst(obs, neighbours, lulc) if obs.get("lst_celsius") else []
    drt_f = evaluate_drought(obs, neighbours) if obs.get("drought_risk") else []

    # Human-readable NLG summaries
    summaries = {
        "aqi": nlg_summary(grid_id, "AQI", obs.get("aqi_proxy", 0), "", aqi_f),
        "ndvi": nlg_summary(grid_id, "NDVI", obs.get("ndvi", 0), "", ndvi_f),
        "lst": nlg_summary(grid_id, "LST", obs.get("lst_celsius", 0), "°C", lst_f),
        "drought": nlg_summary(grid_id, "Drought Risk", obs.get("drought_risk", 0), "", drt_f),
    }

    neighbourhood = build_3x3(grid_id, lat, lng, all_grids_obs_df)

    return {
        "grid_id": grid_id,
        "centroid_lat": lat,
        "centroid_lng": lng,
        "factors": {"aqi": aqi_f, "ndvi": ndvi_f, "lst": lst_f, "drought": drt_f},
        "human_summary": summaries,
        "neighbourhood_3x3": neighbourhood,
    }


# ────────────────────────────────────────────────────────────────────────────
# 3×3 neighbourhood context
# ────────────────────────────────────────────────────────────────────────────

def build_3x3(
    grid_id: str,
    lat: float,
    lng: float,
    all_grids_obs_df: pd.DataFrame,
) -> list[dict]:
    """Build a 3×3 neighbourhood context around *grid_id*."""
    neighbours = get_moore_neighbours(lat, lng, all_grids_obs_df, radius_km=4.5)

    # Center cell
    metric_keys = ["composite_risk", "aqi_proxy", "ndvi", "lst_celsius"]
    center: dict = {
        "grid_id": grid_id,
        "position": "CENTER",
        "centroid_lat": lat,
        "centroid_lng": lng,
    }
    center_rows = all_grids_obs_df.loc[all_grids_obs_df.grid_id == grid_id]
    for k in metric_keys:
        if k in all_grids_obs_df.columns and not center_rows.empty:
            center[k] = center_rows[k].values[0]

    result = [center]

    for _, n in neighbours.iterrows():
        pos = label_direction(bearing_deg(lat, lng, n.centroid_lat, n.centroid_lng))
        row: dict = {
            "grid_id": n.grid_id,
            "position": pos,
            "centroid_lat": n.centroid_lat,
            "centroid_lng": n.centroid_lng,
        }
        for k in metric_keys:
            row[k] = n.get(k)
        result.append(row)

    return result


# ────────────────────────────────────────────────────────────────────────────
# Build report context
# ────────────────────────────────────────────────────────────────────────────

def build_report_context(attributions: list[dict], latest_obs_df: pd.DataFrame) -> dict:
    """Assemble the full report context dict consumed by report generators."""
    # Top-15 risk grids
    risk_df = latest_obs_df.copy()
    if "composite_risk" in risk_df.columns:
        risk_df = risk_df.sort_values("composite_risk", ascending=False)
    top_risk = risk_df.head(15)[["grid_id"]].to_dict("records")

    # Prescription counts (if file already generated)
    presc_path = OUTPUT_DIR / "prescriptions_output.json"
    presc_counts: dict = {}
    if presc_path.exists():
        try:
            with open(presc_path, "r") as f:
                presc_data = json.load(f)
            for p in presc_data.get("prescriptions", []):
                ptype = p.get("type", "unknown")
                presc_counts[ptype] = presc_counts.get(ptype, 0) + 1
        except Exception:
            log.warning("Could not load prescriptions_output.json for report context")

    # City-level summary counts
    total_grids = len(latest_obs_df)
    high_aqi = int((latest_obs_df.get("aqi_proxy", pd.Series(dtype=float)) > 150).sum())
    low_ndvi = int((latest_obs_df.get("ndvi", pd.Series(dtype=float)) < 0.15).sum())
    high_lst = int((latest_obs_df.get("lst_celsius", pd.Series(dtype=float)) > 42).sum())
    high_drought = int((latest_obs_df.get("drought_risk", pd.Series(dtype=float)) > 0.7).sum())

    city_summary = {
        "total_grids": total_grids,
        "high_aqi_grids": high_aqi,
        "low_ndvi_grids": low_ndvi,
        "high_lst_grids": high_lst,
        "high_drought_grids": high_drought,
    }

    return {
        "generated_at": datetime.now().isoformat(),
        "city_id": "GJ_AHM",
        "city_summary": city_summary,
        "top_risk_grids": top_risk,
        "prescription_counts": presc_counts,
        "attributions": attributions,
    }


# ────────────────────────────────────────────────────────────────────────────
# Entrypoint
# ────────────────────────────────────────────────────────────────────────────

def run_all() -> dict:
    """Run causal attribution for every grid and save report context."""
    merged_df = pd.read_csv(
        PROCESSED_DATA_DIR / "merged_features.csv", parse_dates=["captured_at"]
    )
    latest = merged_df.sort_values("captured_at").groupby("grid_id").last().reset_index()
    all_grids_obs = latest.copy()

    attributions: list[dict] = []
    for _, row in tqdm(latest.iterrows(), total=len(latest), desc="Causal attribution"):
        attributions.append(run_grid(row.grid_id, row.to_dict(), all_grids_obs))

    report_ctx = build_report_context(attributions, latest)

    out_path = OUTPUT_DIR / "report_context.json"
    with open(out_path, "w") as f:
        json.dump(report_ctx, f, indent=2, default=str)
    log.info("Saved report context -> %s (%d grids)", out_path, len(attributions))

    return report_ctx


if __name__ == "__main__":
    run_all()
