# BHOOMI — Report & LLM Module
## Teammate Handoff Document
**Your role: Report Engineer | Works independently from ML pipeline**

---

## What You Are Building

You receive 6 JSON files as inputs. You build:
1. A Flask API that reads these JSONs and serves structured data
2. A PDF report generator for municipal commissioners
3. LLM integration (Gemini free API) that writes the narrative sections

You do **not** touch the ML code, the database, or any CSV files.
Everything you need is in the JSON files described below.

---

## Your Folder Structure

```
bhoomi-report/
│
├── .env                         ← your keys go here
├── requirements.txt
├── app.py                       ← Flask entry point
│
├── inputs/                      ← DROP THE 6 JSON FILES HERE
│   ├── predictions_output.json
│   ├── prescriptions_output.json
│   ├── anomalies_output.json
│   ├── carbon_output.json
│   ├── report_context.json
│   └── eval_metrics.json
│
├── llm/
│   ├── __init__.py
│   ├── gemini_client.py         ← Gemini API wrapper
│   ├── prompt_builder.py        ← builds prompts from JSON data
│   └── response_parser.py       ← parses + validates LLM output
│
├── report/
│   ├── __init__.py
│   ├── data_loader.py           ← loads + indexes all 6 JSONs
│   ├── grid_report.py           ← per-grid report assembler
│   ├── city_report.py           ← city-level report assembler
│   ├── pdf_generator.py         ← ReportLab PDF builder
│   └── formatters.py            ← value → human label converters
│
├── routes/
│   ├── __init__.py
│   ├── report_routes.py         ← all Flask endpoints
│   └── health.py
│
└── output/
    └── .gitkeep                 ← generated PDFs saved here
```

---

## Setup

```
pip install flask flask-cors google-generativeai reportlab requests python-dotenv
```

`.env` file:
```
GEMINI_API_KEY=get_from_aistudio.google.com   ← free, no card needed
NVIDIA_NIM_API_KEY=optional_fallback
LLM_PROVIDER=gemini
INPUT_DIR=inputs
OUTPUT_DIR=output
```

How to get Gemini key:
1. Go to https://aistudio.google.com
2. Click "Get API Key" → Create API Key
3. Paste into .env
Free tier: 15 requests/minute, 1 million tokens/day. More than enough.

---

## The 6 Input JSON Files — Complete Field Reference

---

### FILE 1 — `predictions_output.json`

What it is: ML model forecasts for every grid cell, for every environmental metric,
at 13 future time horizons.

```json
{
  "generated_at": "2025-07-10T05:30:00",
  "city_id": "GJ_AHM",
  "grid_size_km": 3.0,
  "horizons": ["1d","2d","3d","4d","5d","6d","7d","8d","9d","10d","30d","90d","180d"],
  "total_grids": 1089,
  "grids": [
    {
      "grid_id": "GJ_AHM_R010_C010",
      "centroid_lat": 23.0412,
      "centroid_lng": 72.5812,
      "diagonal": {
        "sw": {"lat": 23.0277, "lng": 72.5677},
        "ne": {"lat": 23.0547, "lng": 72.5947}
      },
      "confidence": 0.76,
      "predictions": {
        "aqi_proxy": {
          "1d":  {"val": 145, "lo": 118, "hi": 172, "model": "sarima"},
          "7d":  {"val": 158, "lo": 125, "hi": 191, "model": "sarima"},
          "30d": {"val": 141, "lo": 105, "hi": 177, "model": "sarima"},
          "90d": {"val": 135, "lo": 98,  "hi": 172, "model": "prophet"},
          "180d":{"val": 128, "lo": 90,  "hi": 166, "model": "prophet"}
        },
        "no2_ugm3":      { same structure },
        "so2_ugm3":      { same structure },
        "co_ugm3":       { same structure },
        "lst_celsius":   { same structure },
        "ndvi":          { same structure },
        "vhi":           { same structure },
        "soil_moisture": { same structure },
        "drought_risk":  { same structure },
        "rainfall_mm":   { same structure },
        "carbon_balance":{ same structure }
      }
    }
  ]
}
```

**What each field means:**

| Field | Meaning | Use in report |
|---|---|---|
| `grid_id` | Unique ID of the 3km×3km cell. Format: `GJ_AHM_R{row}_{col}` | Identify location in report |
| `centroid_lat/lng` | Geographic centre of the cell | Map coordinates |
| `diagonal.sw/ne` | SW and NE corners of the 3km box | Draw rectangle on map |
| `confidence` | Model reliability 0–1. Below 0.5 = low confidence | Show confidence badge |
| `predictions.{metric}.{horizon}.val` | The predicted value at that future date | Main forecast number |
| `predictions.{metric}.{horizon}.lo` | Lower bound (90% confidence interval) | Uncertainty range |
| `predictions.{metric}.{horizon}.hi` | Upper bound | Uncertainty range |
| `predictions.{metric}.{horizon}.model` | Which model made this prediction | Optional: show model name |

**Metric value scales (what the numbers mean):**

| Metric | Unit | Good | Moderate | Bad | Critical |
|---|---|---|---|---|---|
| `aqi_proxy` | AQI index | 0–50 | 51–100 | 101–200 | >200 |
| `no2_ugm3` | µg/m³ | <40 | 40–80 | 80–150 | >150 |
| `so2_ugm3` | µg/m³ | <30 | 30–60 | 60–120 | >120 |
| `co_ugm3` | µg/m³ | <1000 | 1000–3000 | 3000–6000 | >6000 |
| `lst_celsius` | °C | <32 | 32–38 | 38–44 | >44 |
| `ndvi` | Index 0–1 | >0.5 | 0.3–0.5 | 0.15–0.3 | <0.15 |
| `vhi` | Index 0–1 | >0.5 | 0.35–0.5 | 0.2–0.35 | <0.2 |
| `soil_moisture` | m³/m³ | >0.25 | 0.15–0.25 | 0.08–0.15 | <0.08 |
| `drought_risk` | Index 0–1 | <0.2 | 0.2–0.4 | 0.4–0.7 | >0.7 |
| `rainfall_mm` | mm/day | context-dependent | | | |
| `carbon_balance` | -1 to +1 | < -0.05 (sink) | -0.05 to 0.1 | 0.1–0.5 | >0.5 |

---

### FILE 2 — `prescriptions_output.json`

What it is: Spatial intervention recommendations. Where to plant trees, build green
buffers, create cooling corridors etc. Each prescription says exactly where to act
and why.

```json
{
  "generated_at": "2025-07-10T05:30:00",
  "city_id": "GJ_AHM",
  "total": 87,
  "by_type": {
    "green_buffer": 12,
    "plantation_patch": 31,
    "cooling_corridor": 18,
    "drought_recharge": 15,
    "windbreak": 11
  },
  "prescriptions": [
    {
      "prescription_id": "PRESC_GJ_AHM_0001",
      "type": "green_buffer",
      "priority": 1,
      "title": "Green buffer — GJ_AHM_R010_C010 downwind of GJ_AHM_R010_C008",
      "source_grid": {
        "grid_id": "GJ_AHM_R010_C008",
        "centroid_lat": 23.0412,
        "centroid_lng": 72.5512,
        "role": "emission_source"
      },
      "receiver_grid": {
        "grid_id": "GJ_AHM_R010_C010",
        "centroid_lat": 23.0412,
        "centroid_lng": 72.5812,
        "role": "pollution_receiver"
      },
      "intervention_zone": {
        "grid_id": "GJ_AHM_R010_C009",
        "centroid_lat": 23.0412,
        "centroid_lng": 72.5662,
        "role": "intervention",
        "description": "Plant green buffer HERE"
      },
      "diagonal": {
        "sw": {"lat": 23.0277, "lng": 72.5527},
        "ne": {"lat": 23.0547, "lng": 72.5797}
      },
      "triggered_by": ["aqi_proxy", "wind_dir_deg"],
      "evidence": {
        "source_so2": 142.0,
        "receiver_aqi": 198,
        "wind_dir": 225.0,
        "wind_speed": 4.2,
        "distance_km": 3.8
      },
      "impact": {
        "area_ha": 900,
        "expected_aqi_reduction_pct": 25,
        "timeline_months": 18,
        "species": ["Eucalyptus", "Neem", "Casuarina"]
      },
      "rationale": "Grid GJ_AHM_R010_C008 shows SO2 142µg/m³. SW wind 4.2m/s transports plume to R010_C010 (AQI 198). Green buffer in R010_C009 intercepts transport path."
    }
  ]
}
```

**What each field means:**

| Field | Meaning | Use in report |
|---|---|---|
| `type` | Category of intervention | Section heading |
| `priority` | 1=critical, 2=high, 3=medium, 4=low | Sort order, colour coding |
| `source_grid` | Grid that is causing the problem | "Source of pollution" |
| `receiver_grid` | Grid that is being harmed | "Affected area" |
| `intervention_zone` | Grid where you actually plant/build | Map overlay rectangle |
| `diagonal.sw/ne` | Two corners of the intervention rectangle | Draw on map |
| `evidence` | Numbers proving why this was triggered | Supporting data in report |
| `impact.expected_aqi_reduction_pct` | How much improvement is expected | Quantified benefit |
| `impact.timeline_months` | How long until improvement shows | Implementation timeline |
| `impact.species` | Recommended plant species | Practical guidance |
| `rationale` | Plain English explanation (pre-written) | Ready to use in report |

**Prescription types explained:**

| Type | What it means | Where action happens |
|---|---|---|
| `green_buffer` | Plant trees between pollution source and residential area | Boundary grid between source and receiver |
| `plantation_patch` | Grid has very low vegetation — needs trees | The grid itself |
| `cooling_corridor` | Hot urban grid nearby — plant trees here to cool it | This grid (to cool neighbour) |
| `drought_recharge` | Soil dangerously dry — build check dams / recharge pits | The grid itself |
| `windbreak` | Dust blowing from bare land — plant perpendicular barrier | The grid itself |
| `agri_protection` | Agricultural land being lost to construction | The grid itself |
| `industrial_setback` | Industry too close to residential | Buffer zone between them |

---

### FILE 3 — `anomalies_output.json`

What it is: Grids where something unusual happened — values outside the 4-year
normal range for that specific location.

```json
{
  "generated_at": "2025-07-10T05:30:00",
  "city_id": "GJ_AHM",
  "total_anomalies": 9,
  "by_severity": {"low": 3, "medium": 4, "high": 2},
  "grids": [
    {
      "grid_id": "GJ_AHM_R015_C020",
      "centroid_lat": 23.0812,
      "centroid_lng": 72.6312,
      "diagonal": {
        "sw": {"lat": 23.0677, "lng": 72.6177},
        "ne": {"lat": 23.0947, "lng": 72.6447}
      },
      "has_anomaly": true,
      "anomaly_score": -0.42,
      "anomaly_severity": "high",
      "anomaly_metrics": ["aqi_proxy", "lst_celsius"],
      "metric_scores": {
        "aqi_proxy":     -0.38,
        "lst_celsius":   -0.29,
        "ndvi":           0.12,
        "drought_risk":   0.05,
        "soil_moisture":  0.08
      },
      "description": "Anomalous aqi_proxy detected in grid GJ_AHM_R015_C020. Severity: high. Score: -0.420. Affected metrics: aqi_proxy, lst_celsius."
    },
    {
      "grid_id": "GJ_AHM_R020_C015",
      "has_anomaly": false,
      ...
    }
  ]
}
```

**What each field means:**

| Field | Meaning | Use in report |
|---|---|---|
| `has_anomaly` | True/False — is this grid behaving unusually | Alert flag |
| `anomaly_score` | More negative = more anomalous. Range roughly -1 to 0 | Severity indicator |
| `anomaly_severity` | low / medium / high | Colour-coded badge |
| `anomaly_metrics` | Which specific metrics are anomalous | What to highlight |
| `metric_scores` | Per-metric contribution. More negative = driving the anomaly | Explain which metric is the problem |
| `description` | Pre-written plain English summary | Ready to use directly |

**Important:** Most grids will have `has_anomaly: false`. Filter to `has_anomaly: true`
for the report. Only 2–5% of grids are expected to be anomalous on any given day.

---

### FILE 4 — `carbon_output.json`

What it is: Carbon balance estimate per grid. Negative = grid is absorbing more
carbon than it emits (good). Positive = grid emits more than it absorbs (bad).

```json
{
  "generated_at": "2025-07-10T05:30:00",
  "city_id": "GJ_AHM",
  "summary": {
    "source_grids": 423,
    "sink_grids": 566,
    "neutral_grids": 100,
    "mean_balance": 0.08
  },
  "grids": [
    {
      "grid_id": "GJ_AHM_R010_C010",
      "centroid_lat": 23.0412,
      "centroid_lng": 72.5812,
      "diagonal": {
        "sw": {"lat": 23.0277, "lng": 72.5677},
        "ne": {"lat": 23.0547, "lng": 72.5947}
      },
      "carbon_balance": 0.38,
      "is_carbon_positive": true,
      "label": "carbon_source",
      "contributing_factors": {
        "built_pct": 0.24,
        "co_ugm3":   0.18,
        "trees_pct": -0.12
      },
      "forecast_180d": {
        "carbon_balance": {"val": 0.41, "lo": 0.31, "hi": 0.51}
      }
    }
  ]
}
```

**What each field means:**

| Field | Meaning | Use in report |
|---|---|---|
| `carbon_balance` | -1 (best, strong sink) to +1 (worst, strong source) | Core metric |
| `is_carbon_positive` | True = NET EMITTER (bad). False = NET SINK (good) | Traffic light indicator |
| `label` | carbon_sink / carbon_neutral / carbon_source | Human label |
| `contributing_factors` | Which factors drive the score. Positive = pushing toward source. Negative = pushing toward sink | Explain causes |
| `forecast_180d.carbon_balance` | Predicted carbon balance 6 months ahead | Trend direction |
| `summary.source_grids` | How many grids are net emitters city-wide | City headline stat |

---

### FILE 5 — `report_context.json`

What it is: Pre-assembled intelligence for the top 15 highest-risk grids.
This is the most important file for the LLM prompt. It contains
causal attribution (why things are bad), neighbourhood context
(what the surrounding 8 grids look like), and city-wide summary stats.

```json
{
  "city": "Ahmedabad",
  "report_date": "2025-07-10",
  "top_risk_grids": [
    {
      "grid_id": "GJ_AHM_R010_C010",
      "centroid_lat": 23.0412,
      "centroid_lng": 72.5812,
      "composite_risk": 7.8,
      "current_values": {
        "aqi_proxy": 285,
        "no2_ugm3": 112,
        "so2_ugm3": 142,
        "co_ugm3": 4200,
        "lst_celsius": 44.2,
        "ndvi": 0.09,
        "vhi": 0.21,
        "soil_moisture": 0.06,
        "drought_risk": 0.74,
        "rainfall_mm": 0.0,
        "carbon_balance": 0.38,
        "composite_risk": 7.8
      },
      "factors": {
        "aqi": [
          {"factor":"wind_transport_industrial","direction":"sus_negative","weight":0.45,
           "evidence":"SW wind 4.2m/s from GJ_AHM_R010_C008 (3.8km), SO2 142µg/m³"},
          {"factor":"rainfall_washout","direction":"sus_positive","weight":0.35,
           "evidence":"38mm rainfall forecast in 18h, expected AQI reduction ~30%"}
        ],
        "ndvi": [ ... ],
        "lst":  [ ... ],
        "drought": [ ... ]
      },
      "human_summary": {
        "aqi":     "Grid GJ_AHM_R010_C010 shows AQI at 285.00. Primary cause: SW wind 4.2m/s from GJ_AHM_R010_C008 (3.8km), SO2 142µg/m³. Mitigant: 38mm rainfall forecast in 18h, expected AQI reduction ~30%.",
        "ndvi":    "Grid shows NDVI at 0.09. Primary cause: urban displacement (built_pct 68%). Contributing: heat stress (LST 44.2°C).",
        "lst":     "Grid shows LST at 44.2°C. Primary cause: urban heat island (built_pct 68%, NDVI 0.09).",
        "drought": "Grid shows Drought Risk at 0.74. Primary cause: severe rainfall deficit (SPI-30 -1.8). Contributing: extreme soil dryness (0.06 m³/m³)."
      },
      "neighbourhood_3x3": [
        {"grid_id":"GJ_AHM_R010_C010","position":"CENTER","centroid_lat":23.0412,"centroid_lng":72.5812,
         "composite_risk":7.8,"aqi_proxy":285,"ndvi":0.09,"lst_celsius":44.2},
        {"grid_id":"GJ_AHM_R009_C009","position":"NW","centroid_lat":23.0547,"centroid_lng":72.5647,
         "composite_risk":5.2,"aqi_proxy":190,"ndvi":0.18,"lst_celsius":41.1},
        {"grid_id":"GJ_AHM_R009_C010","position":"N", ...},
        {"grid_id":"GJ_AHM_R009_C011","position":"NE",...},
        {"grid_id":"GJ_AHM_R010_C009","position":"W", ...},
        {"grid_id":"GJ_AHM_R010_C011","position":"E", ...},
        {"grid_id":"GJ_AHM_R011_C009","position":"SW",...},
        {"grid_id":"GJ_AHM_R011_C010","position":"S", ...},
        {"grid_id":"GJ_AHM_R011_C011","position":"SE",...}
      ]
    }
  ],
  "city_summary": {
    "total_grids": 1089,
    "grids_aqi_critical": 14,
    "grids_drought_high": 7,
    "grids_ndvi_critical": 11,
    "grids_carbon_positive": 423,
    "grids_with_anomaly": 9
  },
  "prescriptions_summary": {
    "green_buffer": 12,
    "plantation_patch": 31,
    "cooling_corridor": 18,
    "drought_recharge": 15,
    "windbreak": 11
  }
}
```

**What each field means:**

| Field | Meaning | Use in report |
|---|---|---|
| `composite_risk` | 0–10 score. Above 4 = significant. Above 7 = critical | Priority ranking |
| `current_values` | All metric readings for today | Current state section |
| `factors.{metric}` | Ranked list of causes. `sus_negative` = things making it worse. `sus_positive` = things helping | Causes section |
| `factors.{metric}[].weight` | 0–1, how strong this factor is | Sort by this for top cause |
| `factors.{metric}[].evidence` | Ready-to-use sentence explaining the factor | Copy directly into report |
| `human_summary.{metric}` | Complete pre-written causal paragraph per metric | Inject directly into LLM |
| `neighbourhood_3x3` | The 9 grids (centre + 8 surrounding). Position labels: N/NE/E/SE/S/SW/W/NW/CENTER | Spatial context section |
| `city_summary` | City-wide headline numbers | Executive summary |

---

### FILE 6 — `eval_metrics.json`

What it is: How accurate the ML models are. Used for the confidence/reliability
section of the report. You do not need to understand the ML to use this.

```json
{
  "evaluated_at": "2025-07-10T04:00:00",
  "train_end_date": "2024-07-10",
  "test_start_date": "2024-07-11",
  "models": {
    "pollution_sarima": {
      "aggregate": {
        "aqi_proxy": {"mae": 18.4, "rmse": 24.7, "mape": 12.3, "r2": 0.74},
        "no2_ugm3":  {"mae": 11.2, "rmse": 15.8, "mape": 10.1, "r2": 0.71}
      }
    },
    "lstm_ndvi": {
      "aggregate": {"mae": 0.028, "rmse": 0.041, "mape": 9.8, "r2": 0.81}
    }
  }
}
```

**What each field means:**

| Field | Meaning | Use in report |
|---|---|---|
| `r2` | R-squared: 0–1. Above 0.7 = good model. Above 0.85 = very good | Model reliability statement |
| `mape` | Mean Absolute % Error. 12% means predictions are on average 12% off | Accuracy statement |
| `mae` | Mean Absolute Error in the metric's own units | Technical appendix |

**Simple rule for report:** If `r2 > 0.7` say "high confidence forecast". If `0.5–0.7` say "moderate confidence". Below 0.5 say "indicative estimate only".

---

## How to Build the LLM Prompt

You do **not** send raw numbers to the LLM. You send pre-interpreted text.
The `human_summary` fields in `report_context.json` are already written
plain-English sentences. Your job is to assemble them into a structured prompt.

**Recommended prompt structure:**

```python
def build_prompt(grid_report: dict) -> str:
    g = grid_report
    
    context = f"""
City: Ahmedabad, Gujarat
Grid ID: {g['grid_id']}
Report Date: {g['report_date']}

CURRENT CONDITIONS:
- Air Quality (AQI): {g['current_values']['aqi_proxy']} ({classify_aqi(g['current_values']['aqi_proxy'])})
- Land Surface Temperature: {g['current_values']['lst_celsius']}°C
- Vegetation Health (NDVI): {g['current_values']['ndvi']}
- Drought Risk: {g['current_values']['drought_risk']} / 1.0
- Carbon Balance: {g['current_values']['carbon_balance']} ({g['carbon_label']})
- Composite Risk Score: {g['current_values']['composite_risk']} / 10

CAUSAL ANALYSIS (pre-computed):
{g['human_summary']['aqi']}
{g['human_summary']['ndvi']}
{g['human_summary']['lst']}
{g['human_summary']['drought']}

SURROUNDING AREA (3km neighbourhood):
{format_neighbourhood(g['neighbourhood_3x3'])}

FORECAST (next 6 months):
- AQI in 30 days: {g['forecast_30d']['aqi_proxy']['val']} (range {g['forecast_30d']['aqi_proxy']['lo']}–{g['forecast_30d']['aqi_proxy']['hi']})
- Drought risk in 90 days: {g['forecast_90d']['drought_risk']['val']}
- NDVI in 180 days: {g['forecast_180d']['ndvi']['val']}

RECOMMENDED INTERVENTIONS:
{format_prescriptions(g['prescriptions'])}
"""
    return context
```

**System prompt for the LLM:**

```
You are BHOOMI, an environmental intelligence assistant for Gujarat municipal commissioners.
You are given pre-analysed satellite data for a specific 3km x 3km city grid.
Write a clear, professional report section for this grid.

The report must include these sections IN ORDER:
1. CURRENT STATE — how is this area performing right now, in plain language
2. HISTORICAL CONTEXT — note any trends mentioned in the data
3. FORECAST — what is expected over the next year, with specific numbers
4. ROOT CAUSES — explain why conditions are what they are, using the causal analysis provided
5. SPATIAL CONTEXT — describe how this grid relates to its neighbours (use the 3x3 data)
6. RECOMMENDED ACTIONS — practical steps, who should implement them, timeline

Rules:
- Use specific numbers from the data
- Mention grid IDs when referring to neighbouring areas
- Keep language accessible to a municipal official (not a scientist)
- Each section should be 2–4 sentences
- Do not invent data not provided
- Format: plain paragraphs with section headings, no bullet points in final output
```

---

## How to Call Gemini

```python
import google.generativeai as genai
import os

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

def call_gemini(system_prompt: str, user_content: str) -> str:
    model = genai.GenerativeModel(
        model_name="gemini-1.5-flash",
        system_instruction=system_prompt
    )
    response = model.generate_content(user_content)
    return response.text

# Usage
narrative = call_gemini(SYSTEM_PROMPT, build_prompt(grid_report))
```

**Rate limits (free tier):** 15 requests/minute, 1M tokens/day.
If you have 1089 grids, do NOT call LLM for every grid.
Call it only for top 15–20 risk grids (from `report_context.json` top_risk_grids).
For the remaining grids, use the pre-written `human_summary` text directly.

---

## What the PDF Report Should Contain

### Structure

```
Page 1 — Cover
  BHOOMI Environmental Intelligence Report
  City: Ahmedabad | Date: 10 July 2025
  Generated by BHOOMI Satellite Platform

Page 2 — Executive Summary
  City-wide headline stats (from report_context.json city_summary)
  Top 3 critical issues with grid IDs
  Overall carbon balance (from carbon_output.json summary)
  Number of anomalies detected (from anomalies_output.json)

Pages 3–N — Per-Grid Cards (one page per top-risk grid)
  Grid ID + coordinates
  Current state table (all metrics with colour-coded status)
  Causes section (from human_summary or LLM narrative)
  Spatial context: text description of 3x3 neighbourhood
  Forecast table: 30d / 90d / 180d predictions with ranges
  Recommended actions (from prescriptions for this grid)
  Anomaly flag if applicable

Page N+1 — Prescriptions Summary
  Table of all prescriptions sorted by priority
  For each: type, location, expected impact, timeline, implementer

Page N+2 — Carbon Balance Summary
  Count of source vs sink grids
  Top 5 worst (most carbon-positive) grids
  Top 5 best (most carbon-negative) grids

Appendix — Model Reliability
  R² scores per metric (from eval_metrics.json)
  Data quality statement
```

### PDF Library — ReportLab

```python
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer,
                                  Table, TableStyle, PageBreak)

def generate_pdf(city_report: dict, output_path: str):
    doc = SimpleDocTemplate(output_path, pagesize=A4,
                             leftMargin=50, rightMargin=50,
                             topMargin=60, bottomMargin=60)
    story = []
    styles = getSampleStyleSheet()
    
    # Cover page
    story.append(Paragraph("BHOOMI Environmental Intelligence Report", styles["Title"]))
    story.append(Paragraph(f"City: Ahmedabad | {city_report['report_date']}", styles["Normal"]))
    story.append(PageBreak())
    
    # Executive summary
    story.append(Paragraph("Executive Summary", styles["Heading1"]))
    # ... add stats table, LLM executive_summary text
    story.append(PageBreak())
    
    # Per-grid pages
    for grid in city_report["top_risk_grids"]:
        story += build_grid_page(grid, styles)
        story.append(PageBreak())
    
    doc.build(story)

def colour_for_metric(metric, value) -> colors.Color:
    # Return green/yellow/orange/red based on thresholds
    if metric == "aqi_proxy":
        if value < 50:   return colors.green
        if value < 100:  return colors.yellow
        if value < 200:  return colors.orange
        return colors.red
    # ... similar for all metrics
```

---

## Your Flask API Endpoints

These are the endpoints you expose. The frontend team calls these.

```
GET  /api/report/grid/<grid_id>
     Returns full per-grid report JSON
     Query params: ?include_llm=true|false (default false — use pre-written text)

POST /api/report/city
     Body: {"city_id": "GJ_AHM", "top_n": 10, "include_llm": true}
     Returns full city report JSON with LLM narrative sections

GET  /api/report/pdf/<city_id>
     Returns generated PDF as file download
     Creates PDF if not cached, else returns cached version

GET  /api/report/summary/<city_id>
     Returns just city_summary + prescriptions_summary (fast, no LLM)
     Used for dashboard header stats

GET  /api/report/grid/<grid_id>/causes
     Returns just the causes section for one grid (no PDF, no LLM)
     Used for map click popup

GET  /health
     {"status": "ok", "inputs_loaded": bool, "llm_available": bool}
```

---

## Your Complete Action Plan

```
Step 1 — Get your inputs
  Ask ML teammate for the 6 JSON files.
  Drop them in your inputs/ folder.
  Run: python -c "import json; print(json.load(open('inputs/predictions_output.json'))['total_grids'])"
  Should print ~1089. If it does, your inputs are good.

Step 2 — Set up environment
  cp .env.template .env
  Get Gemini API key from aistudio.google.com (free, 2 minutes)
  Add to .env
  pip install -r requirements.txt

Step 3 — Build data_loader.py first
  Load all 6 JSONs into memory at startup.
  Index predictions by grid_id for O(1) lookup.
  Index prescriptions by intervention_grid_id.
  Index anomalies by grid_id.
  Index carbon by grid_id.
  Test: can you look up any grid_id and get all its data in <1ms?

Step 4 — Build formatters.py
  classify_aqi(value) → "Good" / "Moderate" / "Unhealthy" / "Very Unhealthy" / "Hazardous"
  classify_ndvi(value) → "Healthy" / "Moderate" / "Low" / "Critical"
  classify_drought(value) → "Low" / "Moderate" / "High" / "Severe" / "Extreme"
  classify_carbon(value) → "Carbon Sink" / "Neutral" / "Carbon Source" / "Heavy Emitter"
  classify_r2(value) → "High Confidence" / "Moderate Confidence" / "Indicative"
  format_neighbourhood(list) → readable paragraph about surrounding grids

Step 5 — Build grid_report.py
  assemble_grid_report(grid_id) → structured dict pulling from all 6 JSONs
  Test this on 3–4 grid IDs before moving to LLM or PDF.

Step 6 — Wire up Gemini
  Build gemini_client.py with retry logic (rate limit = wait 4s, retry).
  Test with ONE grid first.
  Only call LLM for grids in report_context.json top_risk_grids.

Step 7 — Build PDF generator
  Start with a simple 2-page PDF (cover + one grid card).
  Get it looking right before scaling to full city report.

Step 8 — Build Flask routes
  Start with GET /api/report/grid/<grid_id> returning JSON.
  Add GET /api/report/pdf/<city_id> last.

Step 9 — Integration test
  Ask frontend teammate to call your endpoints.
  Your JSON shape must match what they expect.
  The key fields they need per grid:
    grid_id, centroid_lat, centroid_lng,
    current_values (all metrics),
    forecast (at 7d, 30d, 180d),
    causes (human_summary text),
    prescriptions (with diagonal coords),
    has_anomaly, carbon_label
```

---

## Important Notes

**Do not re-run the ML pipeline.** The 6 JSON files are your complete data source.
If a grid is missing from predictions_output.json, it means the ML model had
insufficient data for it — skip it gracefully.

**Do not call the LLM for every grid.** 1089 grids × LLM calls = hours of runtime
and API quota exhaustion. Use LLM only for the top 15–20 grids in
`report_context.json top_risk_grids`. For all other grids, the `human_summary`
fields in `report_context.json` are pre-written plain-English text — use them directly.

**The `rationale` field in prescriptions is ready to use.** It is already a complete
English sentence. You can paste it directly into the PDF without LLM processing.

**The `description` field in anomalies is ready to use.** Same — pre-written,
paste directly.

**The `human_summary` fields in report_context are ready to use.** These are
the most important pre-written texts. Use them as-is or pass them to the LLM
for polish — but do not discard them.

**Coordinate convention:** `centroid_lat/lng` is the centre point.
`diagonal.sw` and `diagonal.ne` are the two corners of the 3km box.
Frontend draws the rectangle from these two points.

---

*End of handoff document.*
*ML pipeline owner provides the 6 JSON files. Report module is fully self-contained after that.*
