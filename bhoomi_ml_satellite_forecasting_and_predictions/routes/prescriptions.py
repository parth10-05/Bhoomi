# BHOOMI — prescriptions.py
"""
Blueprint: prescriptions_bp.
Prescription CRUD with DB + JSON file fallback.
"""

import json
import logging

from flask import Blueprint, jsonify, request

from config.constants import CITY_CONFIGS
from config.settings import OUTPUT_DIR
from prescriptions.geometry_utils import diagonal_coords

log = logging.getLogger(__name__)

prescriptions_bp = Blueprint("prescriptions_bp", __name__)


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

def _load_prescriptions_json() -> list[dict]:
    path = OUTPUT_DIR / "prescriptions_output.json"
    if not path.exists():
        return []
    with open(path, "r") as f:
        data = json.load(f)
    return data.get("prescriptions", [])


def _enrich(p: dict) -> dict:
    """Ensure diagonal_sw / diagonal_ne keys exist for the frontend."""
    diag = p.get("diagonal")
    if diag:
        p["diagonal_sw"] = diag.get("sw")
        p["diagonal_ne"] = diag.get("ne")
    elif p.get("intervention_lat") is not None:
        d = diagonal_coords(p["intervention_lat"], p["intervention_lng"])
        p["diagonal_sw"] = d["sw"]
        p["diagonal_ne"] = d["ne"]
    return p


# ────────────────────────────────────────────────────────────────────────────
# 1. GET /api/prescriptions/<city_id>
# ────────────────────────────────────────────────────────────────────────────

@prescriptions_bp.route("/prescriptions/<city_id>")
def get_prescriptions(city_id: str):
    if city_id not in CITY_CONFIGS:
        return jsonify({"error": f"Unknown city_id '{city_id}'"}), 400

    type_filter = request.args.get("type")
    priority_filter = request.args.get("priority", type=int)
    status_filter = request.args.get("status")

    # Try DB
    try:
        from db.queries import fetch_prescriptions
        rows = fetch_prescriptions(city_id, type_filter=type_filter, priority_filter=priority_filter)
        if status_filter:
            rows = [r for r in rows if r.get("status") == status_filter]
        return jsonify({"prescriptions": [_enrich(r) for r in rows]})
    except (RuntimeError, Exception):
        pass

    # Fallback to JSON
    rows = _load_prescriptions_json()
    if type_filter:
        rows = [r for r in rows if r.get("type") == type_filter]
    if priority_filter is not None:
        rows = [r for r in rows if r.get("priority") == priority_filter]
    if status_filter:
        rows = [r for r in rows if r.get("status") == status_filter]
    return jsonify({"prescriptions": [_enrich(r) for r in rows]})


# ────────────────────────────────────────────────────────────────────────────
# 2. GET /api/prescriptions/grid/<grid_id>
# ────────────────────────────────────────────────────────────────────────────

@prescriptions_bp.route("/prescriptions/grid/<grid_id>")
def get_prescriptions_for_grid(grid_id: str):
    """Prescriptions where source OR receiver OR intervention = grid_id."""
    rows = _load_prescriptions_json()
    matched = [
        _enrich(r) for r in rows
        if grid_id in (
            r.get("source_grid_id"),
            r.get("receiver_grid_id"),
            r.get("intervention_grid_id"),
        )
    ]
    return jsonify({"grid_id": grid_id, "prescriptions": matched})


# ────────────────────────────────────────────────────────────────────────────
# 3. POST /api/prescriptions/<prescription_id>/approve
# ────────────────────────────────────────────────────────────────────────────

@prescriptions_bp.route("/prescriptions/<prescription_id>/approve", methods=["POST"])
def approve_prescription(prescription_id: str):
    try:
        from db.connection import execute_query
        execute_query(
            "UPDATE grid_prescriptions SET status = %s WHERE prescription_id = %s",
            ("approved", prescription_id),
            fetch=False,
        )
        rows = execute_query(
            "SELECT * FROM grid_prescriptions WHERE prescription_id = %s",
            (prescription_id,),
        )
        if not rows:
            return jsonify({"error": "Not found"}), 404
        return jsonify(_enrich(rows[0]))
    except RuntimeError:
        return jsonify({"error": "Database unavailable"}), 503


# ────────────────────────────────────────────────────────────────────────────
# 4. POST /api/prescriptions/<prescription_id>/complete
# ────────────────────────────────────────────────────────────────────────────

@prescriptions_bp.route("/prescriptions/<prescription_id>/complete", methods=["POST"])
def complete_prescription(prescription_id: str):
    try:
        from db.connection import execute_query
        execute_query(
            "UPDATE grid_prescriptions SET status = %s WHERE prescription_id = %s",
            ("done", prescription_id),
            fetch=False,
        )
        rows = execute_query(
            "SELECT * FROM grid_prescriptions WHERE prescription_id = %s",
            (prescription_id,),
        )
        if not rows:
            return jsonify({"error": "Not found"}), 404
        return jsonify(_enrich(rows[0]))
    except RuntimeError:
        return jsonify({"error": "Database unavailable"}), 503
