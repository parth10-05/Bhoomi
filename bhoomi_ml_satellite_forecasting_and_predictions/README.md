# BHOOMI ML Pipeline

This directory contains the Python ML pipeline and Flask API used by BHOOMI.

## What it does

- Preprocesses satellite/environmental CSV datasets
- Merges features into a unified grid-level time series
- Trains forecasting and anomaly models
- Generates prediction, anomaly, carbon, prescription, and report-context JSON outputs
- Exposes Flask endpoints under `/api` for analytics, predictions, prescriptions, anomalies, carbon, and reports

## Tech stack

- Python
- Flask, flask-cors
- pandas, numpy
- statsmodels (SARIMA), Prophet
- torch (BiLSTM)
- scikit-learn (Isolation Forest)
- xgboost
- psycopg2-binary (PostgreSQL)

## Directory map

```text
bhoomi_ml_satellite_forecasting_and_predictions/
|-- app.py                        # Flask entrypoint (port 5001)
|-- requirements.txt              # Python dependencies
|-- config/
|   |-- settings.py               # Env loading, paths, logging, DB URL assembly
|   `-- constants.py              # Thresholds, horizons, ranges, training params
|-- data/
|   |-- preprocess_*.py           # Dataset-specific preprocessing
|   `-- merge_features.py         # Build merged_features.csv + composite signals
|-- models/
|   |-- base_model.py
|   |-- arima_model.py
|   |-- prophet_model.py
|   |-- lstm_model.py
|   |-- xgboost_model.py
|   |-- isolation_forest_model.py
|   `-- ensemble.py
|-- training/
|   |-- train_pollution.py
|   |-- train_lst.py
|   |-- train_vegetation.py
|   |-- train_drought.py
|   |-- evaluate.py
|   `-- run_all_training.py       # Master pipeline runner
|-- inference/
|   |-- batch_predict.py
|   |-- anomaly_detector.py
|   |-- carbon_estimator.py
|   `-- output_schema.py
|-- causal/
|   |-- rule_engine.py
|   |-- wind_transport.py
|   `-- attribution.py
|-- prescriptions/
|   |-- rule_prescriber.py
|   `-- spatial_prescriber.py
|-- db/
|   |-- connection.py
|   |-- queries.py
|   `-- sync.py
`-- routes/                       # Flask blueprints
```

## Prerequisites

- Python environment with packages from `requirements.txt`
- Input CSV files in this folder root:
- `BHOOMI_LST.csv`
- `BHOOMI_Pollution.csv`
- `BHOOMI_Vegetation.csv`
- `BHOOMI_LULC.csv`
- `BHOOMI_Weather.csv`
- `BHOOMI_Drought.csv`

## Environment variables

`config/settings.py` reads these values:

```dotenv
DO_DB_HOST=your_db_host
DO_DB_PORT=5432
DO_DB_NAME=your_db_name
DO_DB_USER=your_db_user
DO_DB_PASSWORD=your_db_password

GEMINI_API_KEY=optional
NVIDIA_NIM_API_KEY=optional
LLM_PROVIDER=gemini
LOG_LEVEL=INFO
FLASK_DEBUG=false
```

Notes:

- `DATABASE_URL` is built from `DO_DB_*` variables.
- If DB variables are incomplete, DB access is disabled in the Python layer.

## Install

```bash
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Run the full pipeline

From this directory:

```bash
python training/run_all_training.py
```

Available flags:

- `--skip-preprocess`
- `--skip-training`
- `--skip-inference`
- `--skip-report`
- `--skip-db`

## Run stages manually

Preprocessing and merge:

```bash
python data/preprocess_lst.py
python data/preprocess_pollution.py
python data/preprocess_vegetation.py
python data/preprocess_lulc.py
python data/preprocess_weather.py
python data/preprocess_drought.py
python data/merge_features.py
```

Training:

```bash
python training/train_pollution.py
python training/train_lst.py
python training/train_vegetation.py
python training/train_drought.py
```

Inference and downstream outputs:

```bash
python inference/batch_predict.py
python inference/anomaly_detector.py
python inference/carbon_estimator.py
python causal/attribution.py
python prescriptions/spatial_prescriber.py
```

## Model mapping used at inference

`inference/batch_predict.py` maps metrics to model families:

- `aqi_proxy` -> `ensemble`
- `no2_ugm3` -> `sarima`
- `so2_ugm3` -> `sarima`
- `co_ugm3` -> `sarima`
- `lst_celsius` -> `ensemble`
- `ndvi` -> `lstm`
- `vhi` -> `prophet`
- `soil_moisture` -> `lstm`
- `drought_risk` -> `xgboost`
- `rainfall_mm` -> `prophet`
- `carbon_balance` -> `xgboost`

Model artifact naming conventions:

- `models/saved/arima_<metric>_<grid_id>.pkl`
- `models/saved/prophet_<metric>_<grid_id>.pkl`
- `models/saved/lstm_<metric>.pt`
- `models/saved/xgb_<metric>_<grid_id>.pkl`
- `models/saved/iforest_<grid_id>.pkl`

## Generated outputs

Outputs are written to `output/`:

- `predictions_output.json`
- `anomalies_output.json`
- `carbon_output.json`
- `prescriptions_output.json`
- `report_context.json`
- `eval_metrics.json`

Processed datasets are written to `data/processed/`:

- `*_clean.csv`
- `merged_features.csv`
- `preprocessing_report.json`

## Run Flask API

```bash
python app.py
```

Default local URL:

- `http://localhost:5001`

Health endpoint:

- `GET /health`

Blueprints are mounted with `/api` prefix.

## Quick output check

```bash
python check_output.py
```
