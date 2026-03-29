# BHOOMI — anomalies.py
"""
Blueprint: anomalies.
Anomaly detection GeoJSON FeatureCollections with DB + JSON fallback.
"""

import json
import logging

from flask import Blueprint, jsonify, request

from config.constants import CITY_CONFIGS
from config.settings import OUTPUT_DIR
from prescriptions.geometry_utils import diagonal_coords

log = logging.getLogger(__name__)

anomalies_bp = Blueprint("anomalies", __name__)


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

def _load_anomalies_json() -> list[dict]:
    path = OUTPUT_DIR / "anomalies_output.json"
    if not path.exists():
        return []
    with open(path, "r") as f:
        data = json.load(f)
    return data.get("grids", [])


def _feature(row: dict) -> dict:
    lat = row.get("centroid_lat", 0)
    lng = row.get("centroid_lng", 0)
    diag = row.get("diagonal") or diagonal_coords(lat, lng)
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lng, lat]},
        "properties": {
            "grid_id": row.get("grid_id"),
            "has_anomaly": row.get("has_anomaly", False),
            "anomaly_score": row.get("anomaly_score"),
            "anomaly_severity": row.get("anomaly_severity"),
            "anomaly_metrics": row.get("anomaly_metrics", []),
            "description": row.get("description", ""),
            "diagonal_sw": diag.get("sw"),
            "diagonal_ne": diag.get("ne"),
        },
    }


# ────────────────────────────────────────────────────────────────────────────
# 1. GET /api/anomalies/<city_id>/<date>
# ────────────────────────────────────────────────────────────────────────────

@anomalies_bp.route("/anomalies/<city_id>/<date>")
def get_anomalies(city_id: str, date: str):
    if city_id not in CITY_CONFIGS:
        return jsonify({"error": f"Unknown city_id '{city_id}'"}), 400

    severity = request.args.get("severity")

    # Try DB
    try:
        from db.queries import fetch_anomalies
        rows = fetch_anomalies(city_id, date)
        if rows:
            if severity:
                rows = [r for r in rows if r.get("severity") == severity]
            features = [_feature(r) for r in rows]
            return jsonify({"type": "FeatureCollection", "features": features})
    except (RuntimeError, Exception):
        pass

    # Fallback to JSON
    rows = _load_anomalies_json()
    if severity:
        rows = [r for r in rows if r.get("anomaly_severity") == severity]
    features = [_feature(r) for r in rows]
    return jsonify({"type": "FeatureCollection", "features": features, "source": "file"})


# ────────────────────────────────────────────────────────────────────────────
# 2. GET /api/anomalies/<city_id>/latest
# ────────────────────────────────────────────────────────────────────────────

@anomalies_bp.route("/anomalies/<city_id>/latest")
def get_latest_anomalies(city_id: str):
    if city_id not in CITY_CONFIGS:
        return jsonify({"error": f"Unknown city_id '{city_id}'"}), 400

    severity = request.args.get("severity")
    rows = _load_anomalies_json()
    if severity:
        rows = [r for r in rows if r.get("anomaly_severity") == severity]
    features = [_feature(r) for r in rows]
    return jsonify({"type": "FeatureCollection", "features": features})
