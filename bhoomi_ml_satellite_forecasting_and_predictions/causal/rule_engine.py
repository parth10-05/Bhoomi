# BHOOMI — rule_engine.py

import logging

import numpy as np
import pandas as pd

from config.constants import CAUSAL_THRESHOLDS
from causal.wind_transport import label_direction

log = logging.getLogger(__name__)


def _f(factor: str, direction: str, weight: float, evidence: str) -> dict:
    return {"factor": factor, "direction": direction, "weight": weight, "evidence": evidence}


# ── AQI causal factors ─────────────────────────────────────────────────────

def evaluate_aqi(obs: dict, upwind_grids: pd.DataFrame, lulc: dict | None = None) -> list[dict]:
    factors: list[dict] = []
    wind = obs.get("wind_speed_ms", 0)
    wind_dir = obs.get("wind_dir_deg", 0)

    # R1: wind transport from industrial upwind grid
    if wind > CAUSAL_THRESHOLDS["wind_min_ms"] and not upwind_grids.empty:
        for _, src in upwind_grids.iterrows():
            so2 = src.get("so2_ugm3", 0)
            no2 = src.get("no2_ugm3", 0)
            if so2 > CAUSAL_THRESHOLDS["so2_high"] or no2 > CAUSAL_THRESHOLDS["no2_high"]:
                d = label_direction(wind_dir)
                dist = src.get("distance_km", 0)
                factors.append(_f(
                    "wind_transport_industrial", "sus_negative", 0.45,
                    f"{d} wind {wind:.1f}m/s from {src.grid_id} ({dist:.1f}km), "
                    f"SO2 {so2:.0f}µg/m³",
                ))
                break  # top source only

    # R2: rainfall washout
    if obs.get("rainfall_mm", 0) > 15:
        factors.append(_f(
            "rainfall_washout", "sus_positive", 0.35,
            f"Rainfall {obs['rainfall_mm']:.1f}mm washes out particulate matter",
        ))

    # R3: dense urban emissions
    if lulc and lulc.get("built_pct", 0) > 50 and obs.get("aqi_proxy", 0) > CAUSAL_THRESHOLDS["aqi_high"]:
        factors.append(_f(
            "dense_urban_emissions", "sus_negative", 0.28,
            f"Built-up {lulc['built_pct']:.0f}% with AQI {obs.get('aqi_proxy', 0):.0f}",
        ))

    # R4: vehicular combustion
    if obs.get("co_ugm3", 0) > 3000:
        factors.append(_f(
            "vehicular_combustion", "sus_negative", 0.25,
            f"CO at {obs['co_ugm3']:.0f}µg/m³ indicates vehicle/industrial combustion",
        ))

    # R5: monsoon suppression
    if obs.get("is_monsoon", 0) == 1:
        factors.append(_f(
            "monsoon_suppression", "sus_positive", 0.20,
            "Monsoon season reduces airborne pollutants via wet deposition",
        ))

    # R6: dust resuspension
    if lulc and lulc.get("bare_pct", 0) > 30 and wind > 4:
        factors.append(_f(
            "dust_resuspension", "sus_negative", 0.22,
            f"Bare land {lulc['bare_pct']:.0f}% + wind {wind:.1f}m/s causing dust uplift",
        ))

    return sorted(factors, key=lambda f: f["weight"], reverse=True)


# ── NDVI causal factors ────────────────────────────────────────────────────

def evaluate_ndvi(obs: dict, neighbours: pd.DataFrame, lulc: dict | None = None) -> list[dict]:
    factors: list[dict] = []

    # R1: drought stress
    if obs.get("vhi", 1) < CAUSAL_THRESHOLDS["vhi_drought"]:
        factors.append(_f(
            "drought_stress", "sus_negative", 0.50,
            f"VHI at {obs.get('vhi', 0):.2f} indicates drought stress on vegetation",
        ))

    # R2: heat stress
    if obs.get("lst_celsius", 0) > CAUSAL_THRESHOLDS["lst_high"] and obs.get("ndvi", 1) < CAUSAL_THRESHOLDS["ndvi_critical"]:
        factors.append(_f(
            "heat_stress", "sus_negative", 0.38,
            f"LST {obs.get('lst_celsius', 0):.1f}°C with critically low NDVI {obs.get('ndvi', 0):.2f}",
        ))

    # R3: adjacent vegetation support
    if not neighbours.empty and any(neighbours.get("ndvi", pd.Series()) > 0.4):
        factors.append(_f(
            "adjacent_vegetation_support", "sus_positive", 0.25,
            "Neighbouring grids show healthy vegetation (NDVI>0.4)",
        ))

    # R4: post-monsoon recovery
    if obs.get("is_post_monsoon", 0) == 1 and obs.get("ndvi_delta7", 0) > 0:
        factors.append(_f(
            "post_monsoon_recovery", "sus_positive", 0.20,
            f"Post-monsoon NDVI rising (+{obs.get('ndvi_delta7', 0):.3f} over 7d)",
        ))

    # R5: urban displacement
    if lulc and lulc.get("built_pct", 0) > 60:
        factors.append(_f(
            "urban_displacement", "sus_negative", 0.30,
            f"Built-up area {lulc['built_pct']:.0f}% displaces vegetation",
        ))

    return sorted(factors, key=lambda f: f["weight"], reverse=True)


# ── LST causal factors ─────────────────────────────────────────────────────

def evaluate_lst(obs: dict, neighbours: pd.DataFrame, lulc: dict | None = None) -> list[dict]:
    factors: list[dict] = []

    # R1: urban heat island
    if lulc and lulc.get("built_pct", 0) > 60 and obs.get("ndvi", 1) < CAUSAL_THRESHOLDS["ndvi_critical"]:
        factors.append(_f(
            "urban_heat_island", "sus_negative", 0.55,
            f"Built-up {lulc['built_pct']:.0f}% with NDVI {obs.get('ndvi', 0):.2f} — UHI effect",
        ))

    # R2: thermal spillover
    if not neighbours.empty and any(neighbours.get("lst_celsius", pd.Series()) > CAUSAL_THRESHOLDS["lst_high"]):
        factors.append(_f(
            "thermal_spillover_from_neighbour", "sus_negative", 0.35,
            "Adjacent grid(s) exceed 42°C — thermal conduction / radiation",
        ))

    # R3: adjacent tree cooling
    if not neighbours.empty and any(neighbours.get("ndvi", pd.Series()) > 0.35):
        factors.append(_f(
            "adjacent_tree_cooling", "sus_positive", 0.30,
            "Nearby vegetation (NDVI>0.35) provides evapotranspiration cooling",
        ))

    # R4: local canopy cooling
    if lulc and lulc.get("trees_pct", 0) > 25:
        factors.append(_f(
            "local_canopy_cooling", "sus_positive", 0.40,
            f"Tree cover {lulc['trees_pct']:.0f}% provides canopy shade and cooling",
        ))

    # R5: seasonal peak heat
    if obs.get("is_summer", 0) == 1:
        factors.append(_f(
            "seasonal_peak_heat", "sus_negative", 0.20,
            "Summer season contributes to elevated surface temperatures",
        ))

    return sorted(factors, key=lambda f: f["weight"], reverse=True)


# ── Drought causal factors ─────────────────────────────────────────────────

def evaluate_drought(obs: dict, neighbours: pd.DataFrame) -> list[dict]:
    factors: list[dict] = []

    # R1: severe rainfall deficit
    if obs.get("spi_30d", 0) < -1.5:
        factors.append(_f(
            "severe_rainfall_deficit", "sus_negative", 0.55,
            f"SPI-30d at {obs.get('spi_30d', 0):.2f} indicates severe rainfall deficit",
        ))

    # R2: extreme soil dryness
    if obs.get("soil_moisture", 1) < 0.05:
        factors.append(_f(
            "extreme_soil_dryness", "sus_negative", 0.50,
            f"Soil moisture at {obs.get('soil_moisture', 0):.3f} — critically dry",
        ))

    # R3: recent rainfall relief
    if obs.get("rainfall_mm", 0) > 20:
        factors.append(_f(
            "recent_rainfall_relief", "sus_positive", 0.40,
            f"Rainfall {obs.get('rainfall_mm', 0):.1f}mm providing drought relief",
        ))

    # R4: regional drought spread
    if not neighbours.empty:
        n_drought = sum(1 for _, n in neighbours.iterrows() if n.get("vhi", 1) < CAUSAL_THRESHOLDS["vhi_drought"])
        frac = n_drought / len(neighbours)
        if frac >= 0.5:
            factors.append(_f(
                "regional_drought_spread", "sus_negative", 0.35,
                f"{n_drought}/{len(neighbours)} neighbours show VHI<0.25 — regional drought",
            ))

    return sorted(factors, key=lambda f: f["weight"], reverse=True)


# ── NLG summary ───────────────────────────────────────────────────────────

def nlg_summary(
    grid_id: str,
    label: str,
    value: float,
    unit: str,
    factors: list[dict],
) -> str:
    """Generate a natural-language summary from causal factors."""
    top_neg = [f for f in factors if f["direction"] == "sus_negative"]
    top_pos = [f for f in factors if f["direction"] == "sus_positive"]

    s = f"Grid {grid_id} shows {label} at {value:.2f}{unit}."
    if top_neg:
        s += f" Primary cause: {top_neg[0]['evidence']}."
    if len(top_neg) > 1:
        s += f" Contributing: {top_neg[1]['evidence']}."
    if top_pos:
        s += f" Mitigant: {top_pos[0]['evidence']}."
    return s
