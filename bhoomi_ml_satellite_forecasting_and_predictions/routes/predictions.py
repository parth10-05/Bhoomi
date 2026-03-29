# BHOOMI — predictions.py
"""
Blueprint: predictions.
Forecast FeatureCollections with DB + JSON file fallback.
"""

import json
import logging

from flask import Blueprint, jsonify, request

from config.constants import CITY_CONFIGS, METRIC_RANGES, HORIZON_LABELS, GRID_SIZE_KM
from config.settings import OUTPUT_DIR

log = logging.getLogger(__name__)

predictions_bp = Blueprint("predictions", __name__)


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

def _feature(lng: float, lat: float, properties: dict) -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lng, lat]},
        "properties": properties,
    }


def _load_predictions_json() -> dict:
    path = OUTPUT_DIR / "predictions_output.json"
    if not path.exists():
        return {}
    with open(path, "r") as f:
        return json.load(f)


def _fallback_single_metric(city_id: str, metric: str, horizon: str) -> list[dict]:
    """Fall back to predictions_output.json for a single metric."""
    data = _load_predictions_json()
    features: list[dict] = []
    for g in data.get("grids", []):
        preds = g.get("predictions", {}).get(metric, {})
        hf = preds.get(horizon)
        if not hf or hf.get("val") is None:
            continue
        features.append(_feature(
            g["centroid_lng"], g["centroid_lat"],
            {
                "grid_id": g["grid_id"], "value": hf["val"],
                "lo": hf.get("lo"), "hi": hf.get("hi"),
                "horizon": horizon, "confidence": g.get("confidence", 0.5),
                "is_prediction": True, "metric": metric,
            },
        ))
    return features


def _fallback_all_metrics(city_id: str, horizon: str) -> list[dict]:
    """Fall back to predictions_output.json for all metrics."""
    data = _load_predictions_json()
    features: list[dict] = []
    for g in data.get("grids", []):
        props: dict = {
            "grid_id": g["grid_id"],
            "is_prediction": True,
            "horizon": horizon,
            "confidence": g.get("confidence", 0.5),
        }
        has_any = False
        for metric, horizon_dict in g.get("predictions", {}).items():
            hf = horizon_dict.get(horizon)
            if hf and hf.get("val") is not None:
                props[f"{metric}_val"] = hf["val"]
                props[f"{metric}_lo"] = hf.get("lo")
                props[f"{metric}_hi"] = hf.get("hi")
                has_any = True
        if has_any:
            features.append(_feature(g["centroid_lng"], g["centroid_lat"], props))
    return features


# ────────────────────────────────────────────────────────────────────────────
# 1. GET /api/predict/<city_id>/<metric>/<date>
# ────────────────────────────────────────────────────────────────────────────

@predictions_bp.route("/predict/<city_id>/<metric>/<date>")
def get_prediction(city_id: str, metric: str, date: str):
    if city_id not in CITY_CONFIGS:
        return jsonify({"error": f"Unknown city_id '{city_id}'"}), 400
    if metric not in METRIC_RANGES:
        return jsonify({"error": f"Unknown metric '{metric}'"}), 400

    horizon = request.args.get("horizon", "7d")

    # Try DB first
    try:
        from db.queries import fetch_predictions
        rows = fetch_predictions(city_id, date, horizon)
        if rows:
            features = [
                _feature(
                    r["centroid_lng"], r["centroid_lat"],
                    {
                        "grid_id": r["grid_id"],
                        "value": r.get("values", {}).get("val"),
                        "lo": r.get("values", {}).get("lo"),
                        "hi": r.get("values", {}).get("hi"),
                        "horizon": horizon,
                        "confidence": r.get("confidence", 0.5),
                        "is_prediction": True,
                        "metric": metric,
                    },
                )
                for r in rows
            ]
            resp = jsonify({"type": "FeatureCollection", "features": features})
            resp.headers["Cache-Control"] = "public, max-age=3600"
            return resp
    except (RuntimeError, Exception):
        pass

    # Fallback to JSON file
    features = _fallback_single_metric(city_id, metric, horizon)
    resp = jsonify({"type": "FeatureCollection", "features": features, "source": "file"})
    resp.headers["Cache-Control"] = "public, max-age=3600"
    return resp


# ────────────────────────────────────────────────────────────────────────────
# 2. GET /api/predict/<city_id>/<date>/all
# ────────────────────────────────────────────────────────────────────────────

@predictions_bp.route("/predict/<city_id>/<date>/all")
def get_all_predictions(city_id: str, date: str):
    if city_id not in CITY_CONFIGS:
        return jsonify({"error": f"Unknown city_id '{city_id}'"}), 400

    horizon = request.args.get("horizon", "7d")
    features = _fallback_all_metrics(city_id, horizon)

    resp = jsonify({"type": "FeatureCollection", "features": features})
    resp.headers["Cache-Control"] = "public, max-age=3600"
    return resp


# ────────────────────────────────────────────────────────────────────────────
# 3. GET /api/horizons
# ────────────────────────────────────────────────────────────────────────────

@predictions_bp.route("/horizons")
def get_horizons():
    return jsonify({
        "horizons": list(HORIZON_LABELS.values()),
        "grid_size_km": GRID_SIZE_KM,
    })
