# BHOOMI — rule_prescriber.py
"""
Rule-based prescription generator.
Evaluates each grid against five intervention rules and returns a list of
prescription dicts ready for spatial resolution.
"""

import logging

import pandas as pd

from prescriptions.geometry_utils import diagonal_coords

log = logging.getLogger(__name__)


def prescribe(
    grid_id: str,
    lat: float,
    lng: float,
    obs: dict,
    upwind: pd.DataFrame,
    neighbours: pd.DataFrame,
    lulc: dict | None = None,
) -> list[dict]:
    """Return a list of prescription dicts triggered by the grid's observations."""
    prescriptions: list[dict] = []

    ndvi = obs.get("ndvi")
    aqi = obs.get("aqi_proxy")
    vhi = obs.get("vhi")
    wind_speed = obs.get("wind_speed_ms", 0)
    lst = obs.get("lst_celsius", 0)
    built_pct = lulc.get("built_pct") if lulc else None
    bare_pct = lulc.get("bare_pct") if lulc else None

    # ── P1 — Plantation patch (self) ──────────────────────────────────────
    if ndvi is not None and ndvi < 0.15 and (lulc is None or (built_pct or 0) < 50):
        priority = 1 if ndvi < 0.08 else 2
        prescriptions.append({
            "type": "plantation_patch",
            "priority": priority,
            "intervention_grid_id": grid_id,
            "intervention_lat": lat,
            "intervention_lng": lng,
            "diagonal": diagonal_coords(lat, lng),
            "triggered_by": ["ndvi"],
            "evidence": {
                "ndvi": ndvi,
                "built_pct": built_pct,
            },
            "impact": {
                "area_ha": 900,
                "species": ["Neem", "Peepal", "Banyan"],
                "expected_ndvi_gain": 0.12,
                "timeline_months": 24,
            },
            "title": f"Plantation required — {grid_id}",
        })

    # ── P2 — Green buffer (cross-grid) ────────────────────────────────────
    if (
        aqi is not None
        and aqi > 150
        and not upwind.empty
        and upwind.iloc[0].get("so2_ugm3", 0) > 60
    ):
        src = upwind.iloc[0]
        prescriptions.append({
            "type": "green_buffer",
            "priority": 1,
            "source_grid_id": src.grid_id,
            "source_lat": src.centroid_lat,
            "source_lng": src.centroid_lng,
            "receiver_grid_id": grid_id,
            "receiver_lat": lat,
            "receiver_lng": lng,
            "intervention_grid_id": None,  # resolved by spatial_prescriber
            "triggered_by": ["aqi_proxy", "wind_dir_deg"],
            "evidence": {
                "source_so2": src.get("so2_ugm3"),
                "receiver_aqi": aqi,
                "wind_dir": obs.get("wind_dir_deg"),
                "wind_speed": obs.get("wind_speed_ms"),
                "distance_km": src.get("distance_km"),
            },
            "impact": {
                "area_ha": 900,
                "expected_aqi_reduction_pct": 25,
                "timeline_months": 18,
                "species": ["Eucalyptus", "Neem", "Casuarina"],
            },
            "title": f"Green buffer — {grid_id} downwind of {src.grid_id}",
        })

    # ── P3 — Cooling corridor (self, triggered by hot neighbours) ─────────
    hot_neighbours = [
        n for n in neighbours.to_dict("records") if n.get("lst_celsius", 0) > 42
    ]
    if (
        hot_neighbours
        and ndvi is not None
        and ndvi < 0.20
        and (lulc is None or (built_pct or 0) < 55)
    ):
        prescriptions.append({
            "type": "cooling_corridor",
            "priority": 2,
            "intervention_grid_id": grid_id,
            "intervention_lat": lat,
            "intervention_lng": lng,
            "diagonal": diagonal_coords(lat, lng),
            "triggered_by": ["lst_celsius", "ndvi"],
            "evidence": {
                "local_ndvi": ndvi,
                "hot_neighbour_count": len(hot_neighbours),
                "max_neighbour_lst": max(n.get("lst_celsius", 0) for n in hot_neighbours),
                "built_pct": built_pct,
            },
            "impact": {
                "area_ha": 900,
                "expected_lst_reduction_c": 2.5,
                "timeline_months": 36,
                "species": ["Neem", "Gulmohar", "Peepal"],
            },
            "title": f"Cooling corridor — {grid_id}",
        })

    # ── P4 — Drought recharge (self) ──────────────────────────────────────
    n_drought = sum(
        1 for n in neighbours.to_dict("records") if n.get("vhi", 1) < 0.25
    )
    if (vhi is not None and vhi < 0.25) or n_drought >= 4:
        priority = 1 if (vhi is not None and vhi < 0.15) else 2
        prescriptions.append({
            "type": "drought_recharge",
            "priority": priority,
            "intervention_grid_id": grid_id,
            "intervention_lat": lat,
            "intervention_lng": lng,
            "diagonal": diagonal_coords(lat, lng),
            "triggered_by": ["vhi", "drought_risk"],
            "evidence": {
                "vhi": vhi,
                "drought_neighbour_count": n_drought,
                "soil_moisture": obs.get("soil_moisture"),
            },
            "impact": {
                "area_ha": 900,
                "expected_vhi_gain": 0.15,
                "recharge_structures": ["check_dam", "percolation_pit", "contour_bund"],
                "timeline_months": 12,
            },
            "title": f"Drought recharge — {grid_id}",
        })

    # ── P5 — Windbreak (self) ─────────────────────────────────────────────
    if (
        aqi is not None
        and aqi > 120
        and wind_speed > 4.0
        and (lulc is None or (bare_pct or 0) > 30)
    ):
        prescriptions.append({
            "type": "windbreak",
            "priority": 2,
            "intervention_grid_id": grid_id,
            "intervention_lat": lat,
            "intervention_lng": lng,
            "diagonal": diagonal_coords(lat, lng),
            "triggered_by": ["aqi_proxy", "wind_speed_ms"],
            "evidence": {
                "aqi": aqi,
                "wind_speed_ms": wind_speed,
                "bare_pct": bare_pct,
            },
            "impact": {
                "area_ha": 900,
                "expected_aqi_reduction_pct": 15,
                "timeline_months": 18,
                "species": ["Casuarina", "Prosopis", "Eucalyptus"],
            },
            "title": f"Windbreak — {grid_id}",
        })

    return prescriptions
