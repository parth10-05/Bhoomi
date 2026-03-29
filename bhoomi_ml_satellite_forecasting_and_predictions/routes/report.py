# BHOOMI — report.py
"""
Blueprint: report.
City & grid report generation with optional LLM narrative (Gemini / NVIDIA NIM).
"""

import json
import logging
from datetime import datetime

import requests as http_requests
from flask import Blueprint, jsonify, request

from config.settings import (
    OUTPUT_DIR,
    PROCESSED_DATA_DIR,
    GEMINI_API_KEY,
    NVIDIA_NIM_API_KEY,
    LLM_PROVIDER,
)
from report.report_assembler import (
    assemble_grid_report,
    assemble_city_report,
    build_llm_prompt_context,
)
from report.historical_summary import compute_historical_summary
from report.forecast_summary import compute_forecast_summary
from report.cause_builder import build_causes
from report.solution_builder import build_solutions

log = logging.getLogger(__name__)

report_bp = Blueprint("report", __name__)

_SYSTEM_PROMPT = (
    "You are BHOOMI, an AI environmental analyst for Gujarat municipal commissioners. "
    "Given structured environmental data for a city grid, produce a concise city briefing. "
    "Respond ONLY in valid JSON (no markdown fences) with keys: "
    "executive_summary (2-3 sentences), "
    "top_issues (list of {grid_id,issue,severity,action}), "
    "causes_summary (paragraph), "
    "prescription_highlights (top 3 as list of strings), "
    "outlook_1yr (brief outlook), "
    "recommendations (list of 3 actionable items for municipal commissioners). "
    "Be specific: include grid IDs, metric values, estimated populations affected."
)


# ────────────────────────────────────────────────────────────────────────────
# LLM caller
# ────────────────────────────────────────────────────────────────────────────

def call_llm(prompt_context: str) -> dict | None:
    """Call Gemini or NVIDIA NIM and return parsed JSON sections."""
    raw: str | None = None

    if LLM_PROVIDER == "gemini" and GEMINI_API_KEY:
        import google.generativeai as genai

        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel(
            "gemini-1.5-flash", system_instruction=_SYSTEM_PROMPT
        )
        response = model.generate_content(prompt_context)
        raw = response.text

    elif LLM_PROVIDER == "nvidia" and NVIDIA_NIM_API_KEY:
        r = http_requests.post(
            "https://integrate.api.nvidia.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {NVIDIA_NIM_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "meta/llama-3.1-8b-instruct",
                "messages": [
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": prompt_context},
                ],
                "max_tokens": 1500,
                "temperature": 0.3,
            },
            timeout=30,
        )
        r.raise_for_status()
        raw = r.json()["choices"][0]["message"]["content"]

    else:
        return None

    raw = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {
            "executive_summary": raw,
            "top_issues": [],
            "causes_summary": "",
            "prescription_highlights": [],
            "outlook_1yr": "",
            "recommendations": [],
        }


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

def _load_json(filename: str) -> dict:
    path = OUTPUT_DIR / filename
    if not path.exists():
        return {}
    with open(path, "r") as f:
        return json.load(f)


# ────────────────────────────────────────────────────────────────────────────
# 1. POST /api/report
# ────────────────────────────────────────────────────────────────────────────

@report_bp.route("/report", methods=["POST"])
def generate_report():
    body = request.get_json(silent=True) or {}
    city_id = body.get("city_id", "GJ_AHM")

    report_context = _load_json("report_context.json")
    prescriptions = _load_json("prescriptions_output.json")

    # Build the city report structure for LLM context
    city_report = {
        "city_name": report_context.get("city_name", city_id),
        "report_date": datetime.now().date().isoformat(),
        "city_summary": report_context.get("city_summary", {}),
        "top_risk_grids": report_context.get("top_risk_grids", []),
        "prescriptions_summary": prescriptions.get("summary", {}),
    }
    prompt_context = build_llm_prompt_context(city_report)

    llm_sections = None
    llm_error = None

    try:
        llm_sections = call_llm(prompt_context)
    except http_requests.exceptions.Timeout:
        return jsonify({
            "report_context": report_context,
            "llm_sections": None,
            "llm_used": False,
            "llm_timeout": True,
            "provider": LLM_PROVIDER,
            "generated_at": datetime.now().isoformat(),
        }), 504
    except Exception as exc:
        log.exception("LLM call failed")
        llm_error = str(exc)

    result = {
        "report_context": report_context,
        "llm_sections": llm_sections,
        "llm_used": llm_sections is not None,
        "provider": LLM_PROVIDER,
        "generated_at": datetime.now().isoformat(),
    }
    if llm_error:
        result["llm_error"] = llm_error

    return jsonify(result)


# ────────────────────────────────────────────────────────────────────────────
# 2. GET /api/report/context/<city_id>
# ────────────────────────────────────────────────────────────────────────────

@report_bp.route("/report/context/<city_id>")
def get_report_context(city_id: str):
    ctx = _load_json("report_context.json")
    if not ctx:
        return jsonify({"error": "report_context.json not found"}), 404
    return jsonify(ctx)


# ────────────────────────────────────────────────────────────────────────────
# 3. GET /api/report/grid/<grid_id>
# ────────────────────────────────────────────────────────────────────────────

@report_bp.route("/report/grid/<grid_id>")
def get_grid_report(grid_id: str):
    import pandas as pd

    # Load merged features for historical data
    merged_path = PROCESSED_DATA_DIR / "merged_features.csv"
    if not merged_path.exists():
        return jsonify({"error": "merged_features.csv not found"}), 404

    df = pd.read_csv(merged_path)
    grid_df = df[df["grid_id"] == grid_id]
    if grid_df.empty:
        return jsonify({"error": f"No data for grid '{grid_id}'"}), 404

    # Latest observation row
    latest = grid_df.sort_values("date", ascending=False).iloc[0].to_dict()

    # Historical summary
    historical = compute_historical_summary(grid_df)

    # Forecast summary
    predictions = _load_json("predictions_output.json")
    grid_preds = predictions.get("grids", {}).get(grid_id, {})
    forecast = compute_forecast_summary(grid_preds)

    # Causes
    report_ctx = _load_json("report_context.json")
    attribution = {}
    for g in report_ctx.get("top_risk_grids", []):
        if isinstance(g, dict) and g.get("grid_id") == grid_id:
            attribution = g.get("attribution", {})
            break
    causes = build_causes(historical, forecast, attribution)

    # Solutions
    prescriptions_data = _load_json("prescriptions_output.json")
    grid_prescriptions = [
        p for p in prescriptions_data.get("prescriptions", [])
        if grid_id in (
            p.get("source_grid_id"),
            p.get("receiver_grid_id"),
            p.get("intervention_grid_id"),
        )
    ]
    solutions = build_solutions(causes, grid_prescriptions)

    report = assemble_grid_report(
        grid_id=grid_id,
        historical=historical,
        forecast=forecast,
        causes=causes,
        solutions=solutions,
        attribution=attribution,
        latest_obs=latest,
    )
    return jsonify(report)
