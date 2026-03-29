## Project overview

BHOOMI is an urban environmental intelligence platform for grid-level monitoring, forecasting, and interventions.
It combines a React dashboard, a Node.js API, and a Python ML/API pipeline to analyze satellite-derived city metrics and produce prescriptions, anomalies, carbon estimates, and report context.

### Key features

- Interactive grid dashboard with map layers, timeline, and city metrics
- Node API that serves city/grid data from PostgreSQL plus ML JSON outputs
- Python pipeline for preprocessing, model training, batch forecasting, anomaly detection, and carbon estimation
- Rule-based and spatial prescription generation for interventions
- 3x3 neighborhood analysis and per-grid insight endpoints
- Optional LLM-assisted report sections (Gemini or NVIDIA NIM)

### Tech stack

- Languages: TypeScript, JavaScript, Python, SQL
- Frontend: React 18, Vite 5, Tailwind CSS, React Leaflet, Recharts
- Node API: Express 5, pg, dotenv, cors
- Python API/ML: Flask 3, pandas, numpy, scikit-learn, statsmodels, Prophet, PyTorch, XGBoost, SHAP
- Data store: PostgreSQL (SSL-enabled connections)

## Prerequisites

### Runtime versions required

- Node.js: >= 18 (declared in package.json)
- Python: required (requirements.txt provided; exact version not pinned in code)

### Required environment variables

Use placeholder values and set only what you need for your chosen run mode.

```dotenv
# Frontend / Node API
VITE_USE_API=true
VITE_API_BASE_URL=http://localhost:4000
VITE_GEMINI_API_KEY=your_frontend_gemini_key_optional
CONNECTION_STRING=postgresql://user:password@host:5432/dbname?sslmode=require
NEW_CONNECTION_STRING=postgresql://user:password@host:5432/dbname?sslmode=require
PORT=4000

# Python API / ML
DO_DB_HOST=your_db_host
DO_DB_PORT=5432
DO_DB_NAME=your_db_name
DO_DB_USER=your_db_user
DO_DB_PASSWORD=your_db_password
GEMINI_API_KEY=your_backend_gemini_key_optional
LLM_PROVIDER=gemini
LOG_LEVEL=INFO
FLASK_DEBUG=false
```

### External services or accounts needed

- PostgreSQL database with the expected BHOOMI tables
- Optional: Gemini API key or NVIDIA NIM API key for LLM report generation
- Internet access for map tile providers used by the UI (ArcGIS/Carto tile URLs)

## Getting started

### 1. Install frontend and Node API dependencies

```bash
npm install
```

### 2. Install Python dependencies

```bash
cd bhoomi_ml_satellite_forecasting_and_predictions
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 3. Run the services locally

Start the Node API (from repo root):

```bash
npm run start:server
```

Start the frontend (from repo root, new terminal):

```bash
npm run dev
```

Start the Flask API (from bhoomi_ml_satellite_forecasting_and_predictions, new terminal):

```bash
python app.py
```

### 4. (Optional) Run the full ML pipeline

```bash
cd bhoomi_ml_satellite_forecasting_and_predictions
python training/run_all_training.py
```

### 5. (Optional) Run output sanity check script

```bash
cd bhoomi_ml_satellite_forecasting_and_predictions
python check_output.py
```

## Project structure

```text
.
|-- src/                                    # React dashboard app
|   |-- components/                         # Map, panels, timeline, prescriptive analysis UI
|   |-- data/                               # API adapter, fallback adapter, metric/city config
|   |-- pages/                              # Dashboard page composition
|   |-- services/                           # Client-side report and prescription logic
|   |-- store/                              # Zustand-based dashboard state
|   `-- types/                              # Frontend domain models
|-- server.mjs                              # Express API for grid, observations, summaries, ML neighborhood, carbon
|-- inputs/                                 # JSON inputs consumed by Node API (including final_data/)
|-- bhoomi_ml_satellite_forecasting_and_predictions/
|   |-- app.py                              # Flask entrypoint; registers analytics/predictions/prescriptions/anomalies/carbon/report routes
|   |-- config/                             # Constants, paths, env loading, runtime settings
|   |-- data/                               # Preprocessing and feature merge scripts
|   |-- training/                           # Model training scripts and master pipeline runner
|   |-- inference/                          # Batch prediction, anomaly detector, carbon estimator
|   |-- causal/                             # Causal attribution and wind transport logic
|   |-- prescriptions/                      # Spatial/rule-based prescription generation
|   |-- db/                                 # PostgreSQL pool, SQL queries, sync helpers
|   `-- routes/                             # Flask blueprints for API endpoints
|-- db_inspect.mjs                          # Database inspection helper script
|-- package.json                            # Node scripts and dependencies
`-- vite.config.ts                          # Vite config (dev port 5173)
```

### Major module summary

- src/: Dashboard UX, map rendering, data fetching abstraction, and report-generation trigger flow
- server.mjs: Main API gateway used by the frontend; merges DB data and ML output JSON artifacts
- bhoomi_ml_satellite_forecasting_and_predictions/data: Data cleaning/validation and merged feature creation
- bhoomi_ml_satellite_forecasting_and_predictions/training: Per-domain model training and orchestration
- bhoomi_ml_satellite_forecasting_and_predictions/inference: Forecast and risk artifact generation
- bhoomi_ml_satellite_forecasting_and_predictions/causal: Causal rule engine and attribution context construction
- bhoomi_ml_satellite_forecasting_and_predictions/prescriptions: Intervention recommendation generation utilities
- bhoomi_ml_satellite_forecasting_and_predictions/routes: Flask REST surface for analytics, forecasts, prescriptions, anomalies, carbon, and reports
- bhoomi_ml_satellite_forecasting_and_predictions/db: DB connectivity, query layer, and artifact sync to PostgreSQL

## Configuration

### Configurable options

| Option | Default | Description |
|---|---|---|
| Vite dev server port | 5173 | Frontend dev server port in vite.config.ts |
| Node API PORT | 4000 | Express server listen port (overridable via PORT) |
| Flask API port | 5001 | Flask app listen port in app.py |
| LLM_PROVIDER | gemini | Backend LLM provider selector (gemini or nvidia path in code) |
| LOG_LEVEL | INFO | Python logging level |
| FLASK_DEBUG | false | Flask debug mode toggle |
| VITE_USE_API | true | Frontend data source switch; false uses static fallback adapter |
| VITE_API_BASE_URL | http://localhost:4000 | Frontend API base URL |

### Environment variable reference

| Variable | Required | Default | Used by | Description |
|---|---|---|---|---|
| CONNECTION_STRING | One of CONNECTION_STRING or NEW_CONNECTION_STRING is required for Node API | none | server.mjs | PostgreSQL connection string for Node API |
| NEW_CONNECTION_STRING | Fallback alternative | none | server.mjs | Alternate PostgreSQL connection string key |
| PORT | No | 4000 | server.mjs | Node API listen port |
| VITE_USE_API | No | true | src/data/dataSource.ts | Toggle API adapter vs static adapter |
| VITE_API_BASE_URL | No | http://localhost:4000 | src/data/apiAdapter.ts | Base URL for frontend API calls |
| VITE_GEMINI_API_KEY | No | empty string | src/components/RightPanel.tsx | Frontend key passed to report generator |
| DO_DB_HOST | Needed to build Python DATABASE_URL | none | config/settings.py | Python DB host |
| DO_DB_PORT | Needed to build Python DATABASE_URL | none | config/settings.py | Python DB port |
| DO_DB_NAME | Needed to build Python DATABASE_URL | none | config/settings.py | Python DB name |
| DO_DB_USER | Needed to build Python DATABASE_URL | none | config/settings.py | Python DB user |
| DO_DB_PASSWORD | Needed to build Python DATABASE_URL | none | config/settings.py | Python DB password |
| GEMINI_API_KEY | Optional | none | config/settings.py, routes/report.py | Backend Gemini key for report LLM calls |
| NVIDIA_NIM_API_KEY | Optional | none | config/settings.py, routes/report.py | Backend NVIDIA NIM key for report LLM calls |
| LLM_PROVIDER | No | gemini | config/settings.py, routes/report.py | Chooses backend LLM client path |
| LOG_LEVEL | No | INFO | config/settings.py | Python logging verbosity |
| FLASK_DEBUG | No | false | app.py | Flask debug mode |

### ML pipeline CLI flags (training/run_all_training.py)

| Flag | Default | Effect |
|---|---|---|
| --skip-preprocess | false | Skip preprocessing and merged feature generation |
| --skip-training | false | Skip model training stage |
| --skip-inference | false | Skip batch prediction, anomaly, and carbon generation |
| --skip-report | false | Skip attribution, prescriptions, and report-context generation |
| --skip-db | false | Skip PostgreSQL synchronization |
