# BHOOMI — spatial_prescriber.py
"""
Spatial prescription pipeline.
Runs rule_prescriber for every grid, resolves cross-grid intervention zones,
deduplicates, and writes prescriptions_output.json.
"""

import json
import logging
from collections import Counter
from datetime import datetime

import pandas as pd
from tqdm import tqdm

from config.settings import PROCESSED_DATA_DIR, OUTPUT_DIR
from causal.wind_transport import get_upwind_grids, get_moore_neighbours
from prescriptions.geometry_utils import diagonal_coords, grids_between
from prescriptions.rule_prescriber import prescribe

log = logging.getLogger(__name__)


# ────────────────────────────────────────────────────────────────────────────
# Intervention-zone resolution
# ────────────────────────────────────────────────────────────────────────────

def resolve_intervention(presc: dict, all_grids_obs: pd.DataFrame) -> dict:
    """Resolve the intervention grid for cross-grid prescriptions."""
    if presc["type"] == "green_buffer":
        boundary = grids_between(
            presc["source_lat"], presc["source_lng"],
            presc["receiver_lat"], presc["receiver_lng"],
            all_grids_obs,
        )
        if len(boundary) > 0:
            b = boundary.iloc[0]
            presc["intervention_grid_id"] = b.grid_id
            presc["intervention_lat"] = b.centroid_lat
            presc["intervention_lng"] = b.centroid_lng
        else:
            presc["intervention_grid_id"] = presc["receiver_grid_id"]
            presc["intervention_lat"] = presc["receiver_lat"]
            presc["intervention_lng"] = presc["receiver_lng"]

    presc["diagonal"] = diagonal_coords(
        presc["intervention_lat"], presc["intervention_lng"]
    )
    return presc


# ────────────────────────────────────────────────────────────────────────────
# Main pipeline
# ────────────────────────────────────────────────────────────────────────────

def run_all():
    """Generate prescriptions for every grid and save to JSON."""
    merged_df = pd.read_csv(
        PROCESSED_DATA_DIR / "merged_features.csv", parse_dates=["captured_at"]
    )
    latest = (
        merged_df.sort_values("captured_at")
        .groupby("grid_id")
        .last()
        .reset_index()
    )
    all_grids_obs = latest.copy()
    all_prescriptions: list[dict] = []

    for _, row in tqdm(latest.iterrows(), total=len(latest), desc="Prescriptions"):
        obs = row.to_dict()
        wind = obs.get("wind_dir_deg")

        # Upwind grids
        upwind = (
            get_upwind_grids(
                row.centroid_lat, row.centroid_lng, wind, all_grids_obs
            )
            if wind is not None and pd.notna(wind)
            else pd.DataFrame()
        )

        # Moore neighbours
        neighbours = get_moore_neighbours(
            row.centroid_lat, row.centroid_lng, all_grids_obs
        )

        # LULC
        lulc = {
            k: obs.get(k)
            for k in ["built_pct", "trees_pct", "crops_pct", "bare_pct", "rangeland_pct"]
        }

        # Merge metric columns into upwind / neighbours
        if not upwind.empty:
            merge_cols = [c for c in ["grid_id", "so2_ugm3", "no2_ugm3"] if c in all_grids_obs.columns]
            if len(merge_cols) > 1:
                upwind = upwind.merge(all_grids_obs[merge_cols], on="grid_id", how="left")

        if not neighbours.empty:
            merge_cols = [c for c in ["grid_id", "lst_celsius", "ndvi", "vhi"] if c in all_grids_obs.columns]
            if len(merge_cols) > 1:
                neighbours = neighbours.merge(all_grids_obs[merge_cols], on="grid_id", how="left")

        # Generate raw prescriptions
        raw = prescribe(
            row.grid_id, row.centroid_lat, row.centroid_lng,
            obs, upwind, neighbours, lulc,
        )

        for p in raw:
            p = resolve_intervention(p, all_grids_obs)
            all_prescriptions.append(p)

    # ── Deduplicate: same (type, intervention_grid_id) -> keep min priority ──
    seen: dict = {}
    for p in all_prescriptions:
        key = (p["type"], p.get("intervention_grid_id"))
        if key not in seen or p["priority"] < seen[key]["priority"]:
            seen[key] = p
    unique = list(seen.values())

    # ── Assign IDs ──
    for i, p in enumerate(unique):
        p["prescription_id"] = f"PRESC_GJ_AHM_{i + 1:04d}"

    # ── Output ──
    by_type = dict(Counter(p["type"] for p in unique))
    output = {
        "generated_at": datetime.now().isoformat(),
        "city_id": "GJ_AHM",
        "total": len(unique),
        "by_type": by_type,
        "prescriptions": unique,
    }

    out_path = OUTPUT_DIR / "prescriptions_output.json"
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2, default=str)

    log.info("Saved %d prescriptions -> %s", len(unique), out_path)
    print(f"\n[OK] {len(unique)} prescriptions generated")
    for ptype, count in sorted(by_type.items()):
        print(f"  {ptype}: {count}")


if __name__ == "__main__":
    run_all()
