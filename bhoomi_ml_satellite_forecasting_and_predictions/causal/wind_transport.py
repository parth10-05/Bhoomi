# BHOOMI — wind_transport.py

import math

import numpy as np
import pandas as pd


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in km between two points."""
    R = 6371.0
    rlat1, rlat2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def bearing_deg(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Forward azimuth from point1 to point2 in [0, 360)."""
    rlat1, rlat2 = math.radians(lat1), math.radians(lat2)
    dlng = math.radians(lng2 - lng1)
    x = math.sin(dlng) * math.cos(rlat2)
    y = math.cos(rlat1) * math.sin(rlat2) - math.sin(rlat1) * math.cos(rlat2) * math.cos(dlng)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def get_upwind_grids(
    target_lat: float,
    target_lng: float,
    wind_dir_deg: float,
    all_grids_df: pd.DataFrame,
    radius_km: float = 15.0,
    cone_deg: float = 30.0,
) -> pd.DataFrame:
    """Return grids upwind of the target within *radius_km* and *cone_deg*.

    *wind_dir_deg* is the meteorological direction the wind comes FROM.
    We look for source grids at bearing ≈ wind_dir_deg from the target.
    """
    rows = []
    for _, g in all_grids_df.iterrows():
        dist = haversine_km(target_lat, target_lng, g.centroid_lat, g.centroid_lng)
        if dist > radius_km or dist < 0.01:
            continue
        brg = bearing_deg(target_lat, target_lng, g.centroid_lat, g.centroid_lng)
        diff = abs((brg - wind_dir_deg + 180) % 360 - 180)
        if diff <= cone_deg:
            row = g.to_dict()
            row["distance_km"] = round(dist, 3)
            row["bearing_deg"] = round(brg, 2)
            rows.append(row)

    result = pd.DataFrame(rows)
    if not result.empty:
        result = result.sort_values("distance_km").reset_index(drop=True)
    return result


def label_direction(deg: float) -> str:
    """Map degree bearing to 8-sector compass label."""
    sectors = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    idx = int(((deg + 22.5) % 360) / 45)
    return sectors[idx]


def get_moore_neighbours(
    lat: float,
    lng: float,
    all_grids_df: pd.DataFrame,
    radius_km: float = 4.5,
) -> pd.DataFrame:
    """All grids within *radius_km*, excluding the target itself."""
    rows = []
    for _, g in all_grids_df.iterrows():
        if abs(g.centroid_lat - lat) < 0.001 and abs(g.centroid_lng - lng) < 0.001:
            continue
        dist = haversine_km(lat, lng, g.centroid_lat, g.centroid_lng)
        if dist <= radius_km:
            row = g.to_dict()
            row["distance_km"] = round(dist, 3)
            rows.append(row)

    result = pd.DataFrame(rows)
    if not result.empty:
        result = result.sort_values("distance_km").reset_index(drop=True)
    return result
