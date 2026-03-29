# BHOOMI — queries.py
"""
All SQL operations for BHOOMI.
Column/metric names are validated against KEEP_COLUMNS before interpolation.
"""

import json
import logging

import pandas as pd

from db.connection import execute_query, execute_many, get_connection
from config.constants import KEEP_COLUMNS

log = logging.getLogger(__name__)

# Flatten KEEP_COLUMNS into a single whitelist set
_VALID_COLUMNS: set[str] = set()
for _cols in KEEP_COLUMNS.values():
    _VALID_COLUMNS.update(_cols)
# Add derived/composite columns that are valid for queries
_VALID_COLUMNS.update([
    "composite_risk", "aqi_norm", "lst_norm", "ndvi_norm", "drought_norm",
    "carbon_source", "carbon_sink", "carbon_balance",
    "built_pct", "trees_pct", "crops_pct", "bare_pct", "rangeland_pct",
    "dominant_class", "dominant_class_pct",
])


def _validate_column(name: str) -> str:
    """Raise ValueError if *name* is not in the column whitelist."""
    if name not in _VALID_COLUMNS:
        raise ValueError(f"Column '{name}' not in KEEP_COLUMNS whitelist")
    return name


# ────────────────────────────────────────────────────────────────────────────
# Inserts / upserts
# ────────────────────────────────────────────────────────────────────────────

_BATCH_SIZE = 500


def insert_predictions(rows: list[dict]) -> int:
    """Upsert prediction rows into grid_predictions."""
    sql = """
        INSERT INTO grid_predictions
            (grid_id, target_date, horizon, model_id, values, confidence, predicted_at)
        VALUES
            (%s, %s, %s, %s, %s::jsonb, %s, NOW())
        ON CONFLICT (grid_id, target_date, horizon)
        DO UPDATE SET values = EXCLUDED.values, predicted_at = NOW()
    """
    total = 0
    for i in range(0, len(rows), _BATCH_SIZE):
        batch = rows[i : i + _BATCH_SIZE]
        params = [
            (
                r["grid_id"], r["target_date"], r["horizon"],
                r.get("model_id"), json.dumps(r.get("values", {})),
                r.get("confidence", 0.5),
            )
            for r in batch
        ]
        total += execute_many(sql, params)
    log.info("Upserted %d prediction rows", total)
    return total


def insert_prescriptions(rows: list[dict]) -> int:
    """Upsert prescription rows."""
    sql = """
        INSERT INTO grid_prescriptions
            (prescription_id, grid_id, type, priority, title, payload, created_at)
        VALUES
            (%s, %s, %s, %s, %s, %s::jsonb, NOW())
        ON CONFLICT (prescription_id)
        DO UPDATE SET payload = EXCLUDED.payload, priority = EXCLUDED.priority
    """
    total = 0
    for i in range(0, len(rows), _BATCH_SIZE):
        batch = rows[i : i + _BATCH_SIZE]
        params = [
            (
                r["prescription_id"], r.get("intervention_grid_id") or r.get("receiver_grid_id"),
                r["type"], r.get("priority", 3), r.get("title", ""),
                json.dumps(r),
            )
            for r in batch
        ]
        total += execute_many(sql, params)
    log.info("Upserted %d prescription rows", total)
    return total


def insert_anomalies(rows: list[dict]) -> int:
    """Upsert anomaly detection results."""
    sql = """
        INSERT INTO grid_anomalies
            (grid_id, detected_at, has_anomaly, anomaly_score, severity, payload)
        VALUES
            (%s, %s, %s, %s, %s, %s::jsonb)
        ON CONFLICT (grid_id, (detected_at::date))
        DO UPDATE SET has_anomaly = EXCLUDED.has_anomaly,
                      anomaly_score = EXCLUDED.anomaly_score,
                      severity = EXCLUDED.severity,
                      payload = EXCLUDED.payload
    """
    total = 0
    for i in range(0, len(rows), _BATCH_SIZE):
        batch = rows[i : i + _BATCH_SIZE]
        params = [
            (
                r["grid_id"], r.get("detected_at"),
                r.get("has_anomaly", False), r.get("anomaly_score"),
                r.get("anomaly_severity"), json.dumps(r),
            )
            for r in batch
        ]
        total += execute_many(sql, params)
    log.info("Upserted %d anomaly rows", total)
    return total


def insert_carbon(rows: list[dict]) -> int:
    """Upsert carbon estimation results."""
    sql = """
        INSERT INTO grid_carbon
            (grid_id, computed_at, carbon_balance, label, payload)
        VALUES
            (%s, %s, %s, %s, %s::jsonb)
        ON CONFLICT (grid_id, (computed_at::date))
        DO UPDATE SET carbon_balance = EXCLUDED.carbon_balance,
                      label = EXCLUDED.label,
                      payload = EXCLUDED.payload
    """
    total = 0
    for i in range(0, len(rows), _BATCH_SIZE):
        batch = rows[i : i + _BATCH_SIZE]
        params = [
            (
                r["grid_id"], r.get("computed_at"),
                r.get("carbon_balance", 0), r.get("label", "neutral"),
                json.dumps(r),
            )
            for r in batch
        ]
        total += execute_many(sql, params)
    log.info("Upserted %d carbon rows", total)
    return total


# ────────────────────────────────────────────────────────────────────────────
# Fetches
# ────────────────────────────────────────────────────────────────────────────

def fetch_layer(city_id: str, date: str, metric: str) -> list[dict]:
    """Fetch a single metric layer for all grids on a given date."""
    col = _validate_column(metric)
    sql = f"""
        SELECT g.grid_id, g.centroid_lat, g.centroid_lng, o.{col}
        FROM grid_obs o
        JOIN grids g ON o.grid_id = g.grid_id
        WHERE g.city_id = %s AND o.captured_at = %s AND o.{col} IS NOT NULL
    """
    return execute_query(sql, (city_id, date))


def fetch_predictions(city_id: str, date: str, horizon: str) -> list[dict]:
    """Fetch predictions for a city/date/horizon."""
    sql = """
        SELECT p.grid_id, g.centroid_lat, g.centroid_lng,
               p.horizon, p.model_id, p.values, p.confidence
        FROM grid_predictions p
        JOIN grids g ON p.grid_id = g.grid_id
        WHERE g.city_id = %s AND p.target_date = %s AND p.horizon = %s
    """
    return execute_query(sql, (city_id, date, horizon))


def fetch_grid_detail(grid_id: str) -> dict:
    """Fetch latest observation + active prescriptions for a single grid."""
    obs_sql = """
        SELECT * FROM grid_obs
        WHERE grid_id = %s
        ORDER BY captured_at DESC LIMIT 1
    """
    obs_rows = execute_query(obs_sql, (grid_id,))

    presc_sql = """
        SELECT * FROM grid_prescriptions
        WHERE grid_id = %s
        ORDER BY priority
    """
    presc_rows = execute_query(presc_sql, (grid_id,))

    return {
        "grid_id": grid_id,
        "latest_obs": obs_rows[0] if obs_rows else None,
        "prescriptions": presc_rows,
    }


def fetch_prescriptions(
    city_id: str,
    type_filter: str | None = None,
    priority_filter: int | None = None,
) -> list[dict]:
    """Fetch prescriptions for a city, optionally filtered."""
    sql = """
        SELECT p.* FROM grid_prescriptions p
        JOIN grids g ON p.grid_id = g.grid_id
        WHERE g.city_id = %s
    """
    params: list = [city_id]

    if type_filter:
        sql += " AND p.type = %s"
        params.append(type_filter)
    if priority_filter is not None:
        sql += " AND p.priority = %s"
        params.append(priority_filter)

    sql += " ORDER BY p.priority"
    return execute_query(sql, params)


def fetch_anomalies(city_id: str, date: str) -> list[dict]:
    """Fetch anomalies for a city on a given date."""
    sql = """
        SELECT a.* FROM grid_anomalies a
        JOIN grids g ON a.grid_id = g.grid_id
        WHERE g.city_id = %s AND a.detected_at::date = %s
    """
    return execute_query(sql, (city_id, date))


def fetch_carbon(city_id: str, date: str) -> list[dict]:
    """Fetch carbon results for a city on a given date."""
    sql = """
        SELECT c.* FROM grid_carbon c
        JOIN grids g ON c.grid_id = g.grid_id
        WHERE g.city_id = %s AND c.computed_at::date = %s
    """
    return execute_query(sql, (city_id, date))


def fetch_all_grids(city_id: str) -> pd.DataFrame:
    """Return all grids for a city as a DataFrame."""
    sql = """
        SELECT grid_id, centroid_lat, centroid_lng
        FROM grids
        WHERE city_id = %s
        ORDER BY grid_id
    """
    rows = execute_query(sql, (city_id,))
    return pd.DataFrame(rows) if rows else pd.DataFrame(
        columns=["grid_id", "centroid_lat", "centroid_lng"]
    )
