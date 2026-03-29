# BHOOMI — app.py
"""
Flask entry point for the BHOOMI API.
"""

import logging
import os
import traceback

from flask import Flask, jsonify
from flask_cors import CORS

from config.settings import (
    MODEL_SAVE_DIR,
    OUTPUT_DIR,
    LLM_PROVIDER,
    DATABASE_URL,
    validate_settings,
)
from routes.analytics import analytics_bp
from routes.predictions import predictions_bp
from routes.prescriptions import prescriptions_bp
from routes.anomalies import anomalies_bp
from routes.carbon import carbon_bp
from routes.report import report_bp

log = logging.getLogger(__name__)

# ── Startup validation ────────────────────────────────────────────────────────
validate_settings()

_masked_db = "None"
if DATABASE_URL:
    parts = DATABASE_URL.split("@")
    _masked_db = f"***@{parts[-1][:40]}" if len(parts) > 1 else "***"

log.info("BHOOMI starting  |  DB=%s  |  models=%s  |  LLM=%s",
         _masked_db, MODEL_SAVE_DIR, LLM_PROVIDER)

# ── App factory ───────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app, origins="*")

# ── Register blueprints ──────────────────────────────────────────────────────
for bp in (analytics_bp, predictions_bp, prescriptions_bp,
           anomalies_bp, carbon_bp, report_bp):
    app.register_blueprint(bp, url_prefix="/api")


# ── Health check (no prefix) ─────────────────────────────────────────────────

_OUTPUT_FILES = [
    "predictions_output.json",
    "prescriptions_output.json",
    "anomalies_output.json",
    "carbon_output.json",
]


@app.route("/health")
def health():
    # DB check
    db_ok = False
    try:
        from db.connection import test_connection
        db_ok = test_connection()
    except Exception:
        pass

    # Model count
    model_count = 0
    if MODEL_SAVE_DIR.exists():
        model_count = sum(
            1 for f in MODEL_SAVE_DIR.iterdir()
            if f.suffix in (".pkl", ".pt")
        )

    # Output files
    output_files = {
        fname: (OUTPUT_DIR / fname).exists() for fname in _OUTPUT_FILES
    }

    return jsonify({
        "status": "ok",
        "db_connected": db_ok,
        "models_saved_count": model_count,
        "output_files": output_files,
        "version": "1.0.0",
    })


# ── Error handlers ───────────────────────────────────────────────────────────

@app.errorhandler(404)
def not_found(_e):
    return jsonify({"error": "not found"}), 404


@app.errorhandler(500)
def internal_error(_e):
    log.error("500 error:\n%s", traceback.format_exc())
    return jsonify({"error": "internal error"}), 500


# ── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5001,
        debug=os.getenv("FLASK_DEBUG", "false").lower() == "true",
    )
