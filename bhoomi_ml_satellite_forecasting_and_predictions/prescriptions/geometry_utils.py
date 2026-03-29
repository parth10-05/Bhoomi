# BHOOMI — geometry_utils.py
"""
Pure-math geometry helpers for prescription placement.
"""

import math

import pandas as pd

from config.constants import DEG_PER_KM_LAT, DEG_PER_KM_LNG
from causal.wind_transport import haversine_km


def diagonal_coords(lat: float, lng: float, size_km: float = 3.0) -> dict:
    """Return SW / NE corners of a square cell centred on (lat, lng)."""
    half_lat = (size_km / 2) * DEG_PER_KM_LAT
    half_lng = (size_km / 2) * DEG_PER_KM_LNG
    return {
        "sw": {"lat": lat - half_lat, "lng": lng - half_lng},
        "ne": {"lat": lat + half_lat, "lng": lng + half_lng},
    }


def grids_between(
    a_lat: float,
    a_lng: float,
    b_lat: float,
    b_lng: float,
    all_grids_df: pd.DataFrame,
    expand: float = 0.1,
) -> pd.DataFrame:
    """Return grids inside the bounding box of two points (expanded by *expand* fraction)."""
    min_lat, max_lat = min(a_lat, b_lat), max(a_lat, b_lat)
    min_lng, max_lng = min(a_lng, b_lng), max(a_lng, b_lng)

    lat_margin = (max_lat - min_lat) * expand
    lng_margin = (max_lng - min_lng) * expand

    min_lat -= lat_margin
    max_lat += lat_margin
    min_lng -= lng_margin
    max_lng += lng_margin

    mask = (
        (all_grids_df["centroid_lat"] >= min_lat)
        & (all_grids_df["centroid_lat"] <= max_lat)
        & (all_grids_df["centroid_lng"] >= min_lng)
        & (all_grids_df["centroid_lng"] <= max_lng)
    )
    result = all_grids_df.loc[mask].copy()

    # Exclude the two anchor grids themselves
    tol = 0.001
    result = result[
        ~(
            (result["centroid_lat"].between(a_lat - tol, a_lat + tol))
            & (result["centroid_lng"].between(a_lng - tol, a_lng + tol))
        )
        & ~(
            (result["centroid_lat"].between(b_lat - tol, b_lat + tol))
            & (result["centroid_lng"].between(b_lng - tol, b_lng + tol))
        )
    ]

    mid_lat, mid_lng = midpoint(a_lat, a_lng, b_lat, b_lng)
    result["mid_dist"] = result.apply(
        lambda r: haversine_km(mid_lat, mid_lng, r.centroid_lat, r.centroid_lng),
        axis=1,
    )
    return result.sort_values("mid_dist").reset_index(drop=True)


def midpoint(
    lat1: float, lng1: float, lat2: float, lng2: float
) -> tuple[float, float]:
    """Geographic midpoint of two points (simple average for short distances)."""
    lat1_r, lng1_r = math.radians(lat1), math.radians(lng1)
    lat2_r, lng2_r = math.radians(lat2), math.radians(lng2)

    bx = math.cos(lat2_r) * math.cos(lng2_r - lng1_r)
    by = math.cos(lat2_r) * math.sin(lng2_r - lng1_r)

    mid_lat = math.atan2(
        math.sin(lat1_r) + math.sin(lat2_r),
        math.sqrt((math.cos(lat1_r) + bx) ** 2 + by ** 2),
    )
    mid_lng = lng1_r + math.atan2(by, math.cos(lat1_r) + bx)

    return math.degrees(mid_lat), math.degrees(mid_lng)


def perpendicular_bearing(wind_dir_deg: float) -> float:
    """Return bearing perpendicular to *wind_dir_deg* (clockwise)."""
    return (wind_dir_deg + 90) % 360
