# BHOOMI — carbon.py
"""
Blueprint: carbon.
Carbon balance GeoJSON FeatureCollections with DB + JSON fallback.
"""

import json
import logging
from datetime import datetime

from flask import Blueprint, jsonify

from config.constants import CITY_CONFIGS
from config.settings import OUTPUT_DIR
from prescriptions.geometry_utils import diagonal_coords

log = logging.getLogger(__name__)

carbon_bp = Blueprint("carbon", __name__)


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

def _load_carbon_json() -> list[dict]:
    path = OUTPUT_DIR / "carbon_output.json"
    if not path.exists():
        return []
    with open(path, "r") as f:
        data = json.load(f)
    return data.get("grids", [])


def _feature(row: dict) -> dict:
    lat = row.get("centroid_lat", 0)
    lng = row.get("centroid_lng", 0)
    diag = row.get("diagonal") or diagonal_coords(lat, lng)
    forecast_180d = row.get("forecast_180d", {})
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lng, lat]},
        "properties": {
            "grid_id": row.get("grid_id"),
            "carbon_balance": row.get("carbon_balance"),
            "is_carbon_positive": row.get("is_carbon_positive"),
            "label": row.get("label"),
            "forecast_val_180d": forecast_180d.get("val") if isinstance(forecast_180d, dict) else None,
            "diagonal_sw": diag.get("sw"),
            "diagonal_ne": diag.get("ne"),
        },
    }


# ────────────────────────────────────────────────────────────────────────────
# 1. GET /api/carbon/<city_id>/<date>
# ────────────────────────────────────────────────────────────────────────────

@carbon_bp.route("/carbon/<city_id>/<date>")
def get_carbon(city_id: str, date: str):
    if city_id not in CITY_CONFIGS:
        return jsonify({"error": f"Unknown city_id '{city_id}'"}), 400

    # Try DB
    try:
        from db.queries import fetch_carbon
        rows = fetch_carbon(city_id, date)
        if rows:
            features = [_feature(r) for r in rows]
            return jsonify({"type": "FeatureCollection", "features": features})
    except (RuntimeError, Exception):
        pass

    # Fallback to JSON
    rows = _load_carbon_json()
    features = [_feature(r) for r in rows]
    return jsonify({"type": "FeatureCollection", "features": features, "source": "file"})


# ────────────────────────────────────────────────────────────────────────────
# 2. GET /api/carbon/<city_id>/summary
# ────────────────────────────────────────────────────────────────────────────

@carbon_bp.route("/carbon/<city_id>/summary")
def get_carbon_summary(city_id: str):
    if city_id not in CITY_CONFIGS:
        return jsonify({"error": f"Unknown city_id '{city_id}'"}), 400

    rows = _load_carbon_json()
    total = len(rows)
    balances = [r.get("carbon_balance", 0) for r in rows]

    source_count = sum(1 for r in rows if r.get("is_carbon_positive", False))
    sink_count = sum(1 for r in rows if not r.get("is_carbon_positive", True))
    neutral_count = sum(1 for r in rows if r.get("label") == "neutral")
    mean_balance = round(sum(balances) / total, 4) if total else 0

    return jsonify({
        "total_grids": total,
        "source_count": source_count,
        "sink_count": sink_count,
        "neutral_count": neutral_count,
        "mean_balance": mean_balance,
        "date": datetime.now().date().isoformat(),
    })
