# BHOOMI — sync.py
"""
Push all output JSONs into PostgreSQL.
"""

import json
import logging
from datetime import date, datetime, timedelta

from config.settings import OUTPUT_DIR
from config.constants import FORECAST_HORIZONS, HORIZON_LABELS
from db.queries import insert_predictions, insert_prescriptions, insert_anomalies, insert_carbon

log = logging.getLogger(__name__)


def _load_json(name: str) -> dict | list:
    path = OUTPUT_DIR / name
    with open(path, "r") as f:
        return json.load(f)


# ────────────────────────────────────────────────────────────────────────────

def sync_predictions() -> int:
    """Flatten predictions_output.json into rows and upsert."""
    data = _load_json("predictions_output.json")
    today = date.today()
    rows: list[dict] = []

    for grid in data.get("grids", []):
        grid_id = grid["grid_id"]
        confidence = grid.get("confidence", 0.5)
        for metric, horizon_dict in grid.get("predictions", {}).items():
            for h_days in FORECAST_HORIZONS:
                h_label = HORIZON_LABELS.get(h_days)
                if h_label and h_label in horizon_dict:
                    hf = horizon_dict[h_label]
                    rows.append({
                        "grid_id": grid_id,
                        "target_date": (today + timedelta(days=h_days)).isoformat(),
                        "horizon": h_label,
                        "model_id": hf.get("model", "ensemble"),
                        "values": {"val": hf.get("val"), "lo": hf.get("lo"), "hi": hf.get("hi"), "metric": metric},
                        "confidence": confidence,
                    })

    count = insert_predictions(rows)
    log.info("Synced %d prediction rows", count)
    return count


def sync_prescriptions() -> int:
    """Load prescriptions_output.json and upsert."""
    data = _load_json("prescriptions_output.json")
    rows = data.get("prescriptions", [])
    count = insert_prescriptions(rows)
    log.info("Synced %d prescription rows", count)
    return count


def sync_anomalies() -> int:
    """Load anomalies_output.json and upsert."""
    data = _load_json("anomalies_output.json")
    rows = data.get("grids", [])
    # Ensure detected_at is set
    now_iso = datetime.now().isoformat()
    for r in rows:
        r.setdefault("detected_at", now_iso)
    count = insert_anomalies(rows)
    log.info("Synced %d anomaly rows", count)
    return count


def sync_carbon() -> int:
    """Load carbon_output.json and upsert."""
    data = _load_json("carbon_output.json")
    rows = data.get("grids", [])
    now_iso = datetime.now().isoformat()
    for r in rows:
        r.setdefault("computed_at", now_iso)
    count = insert_carbon(rows)
    log.info("Synced %d carbon rows", count)
    return count


# ────────────────────────────────────────────────────────────────────────────

def sync_all():
    """Run all sync functions. Log errors but do not abort."""
    summary: dict[str, int | str] = {}
    for name, func in [
        ("predictions", sync_predictions),
        ("prescriptions", sync_prescriptions),
        ("anomalies", sync_anomalies),
        ("carbon", sync_carbon),
    ]:
        try:
            summary[name] = func()
        except Exception as exc:
            log.error("sync_%s failed: %s", name, exc)
            summary[name] = f"ERROR: {exc}"

    print("\n\u2713 DB sync complete")
    for table, result in summary.items():
        print(f"  {table}: {result}")


if __name__ == "__main__":
    sync_all()
