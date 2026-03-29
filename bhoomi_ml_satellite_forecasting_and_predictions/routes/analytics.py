# BHOOMI — analytics.py
"""
Blueprint: analytics.
GeoJSON FeatureCollections for map layers, grid details, city list.
"""

import json
import logging
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request

from config.constants import CITY_CONFIGS, METRIC_RANGES
from prescriptions.geometry_utils import diagonal_coords

log = logging.getLogger(__name__)

analytics_bp = Blueprint("analytics", __name__)


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

def _feature(lng: float, lat: float, properties: dict) -> dict:
    """GeoJSON Feature with Point geometry."""
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lng, lat]},
        "properties": properties,
    }


def _feature_collection(features: list[dict], **extra) -> dict:
    out = {"type": "FeatureCollection", "features": features}
    out.update(extra)
    return out


def _validate_city(city_id: str):
    if city_id not in CITY_CONFIGS:
        return jsonify({"error": f"Unknown city_id '{city_id}'"}), 400
    return None


def _validate_metric(metric: str):
    if metric not in METRIC_RANGES:
        return jsonify({"error": f"Unknown metric '{metric}'"}), 400
    return None


# ────────────────────────────────────────────────────────────────────────────
# 1. GET /api/layer/<city_id>/<metric>/<date>
# ────────────────────────────────────────────────────────────────────────────

@analytics_bp.route("/layer/<city_id>/<metric>/<date>")
def get_layer(city_id: str, metric: str, date: str):
    err = _validate_city(city_id) or _validate_metric(metric)
    if err:
        return err

    try:
        from db.queries import fetch_layer

        # Try requested date, then date-1, date-2
        data_date = date
        rows = fetch_layer(city_id, date, metric)
        if not rows:
            for offset in (1, 2):
                fallback = (datetime.fromisoformat(date) - timedelta(days=offset)).date().isoformat()
                rows = fetch_layer(city_id, fallback, metric)
                if rows:
                    data_date = fallback
                    break

        features = [
            _feature(
                r["centroid_lng"], r["centroid_lat"],
                {"grid_id": r["grid_id"], "value": r.get(metric),
                 "metric_name": metric, "date": data_date, "is_prediction": False},
            )
            for r in rows
        ]

        resp = jsonify(_feature_collection(features, data_date=data_date, metric=metric))
        resp.headers["Cache-Control"] = "public, max-age=21600"
        return resp

    except RuntimeError:
        return jsonify({"error": "Database unavailable"}), 503
    except Exception as exc:
        log.error("layer error: %s", exc)
        return jsonify({"error": "Database error"}), 503


# ────────────────────────────────────────────────────────────────────────────
# 2. GET /api/grid/<grid_id>
# ────────────────────────────────────────────────────────────────────────────

@analytics_bp.route("/grid/<grid_id>")
def get_grid(grid_id: str):
    try:
        from db.queries import fetch_grid_detail

        detail = fetch_grid_detail(grid_id)
        obs = detail.get("latest_obs") or {}
        lat = obs.get("centroid_lat", 0)
        lng = obs.get("centroid_lng", 0)

        result = {
            "grid_id": grid_id,
            "centroid_lat": lat,
            "centroid_lng": lng,
            "diagonal": diagonal_coords(lat, lng),
            "latest_obs": obs,
            "active_prescriptions": detail.get("prescriptions", []),
        }

        # Attach causal summary if report_context.json exists
        try:
            from config.settings import OUTPUT_DIR
            ctx_path = OUTPUT_DIR / "report_context.json"
            if ctx_path.exists():
                with open(ctx_path, "r") as f:
                    ctx = json.load(f)
                for a in ctx.get("attributions", []):
                    if a.get("grid_id") == grid_id:
                        result["causal_summary"] = a.get("human_summary")
                        break
        except Exception:
            pass

        return jsonify(result)

    except RuntimeError:
        return jsonify({"error": "Database unavailable"}), 503
    except Exception as exc:
        log.error("grid detail error: %s", exc)
        return jsonify({"error": str(exc)}), 404


# ────────────────────────────────────────────────────────────────────────────
# 3. GET /api/cities
# ────────────────────────────────────────────────────────────────────────────

@analytics_bp.route("/cities")
def get_cities():
    cities = [
        {"city_id": cid, **cfg}
        for cid, cfg in CITY_CONFIGS.items()
    ]
    return jsonify({"cities": cities})


# ────────────────────────────────────────────────────────────────────────────
# 4. GET /api/layer_config
# ────────────────────────────────────────────────────────────────────────────

@analytics_bp.route("/layer_config")
def get_layer_config():
    config = {
        metric: {"min": lo, "max": hi}
        for metric, (lo, hi) in METRIC_RANGES.items()
    }
    return jsonify({"layers": config})
