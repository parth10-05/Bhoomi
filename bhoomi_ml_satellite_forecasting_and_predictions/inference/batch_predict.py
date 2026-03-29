# BHOOMI — batch_predict.py

import json
import logging
import time
from datetime import datetime
from pathlib import Path

import pandas as pd
from tqdm import tqdm

from config.constants import FORECAST_HORIZONS, HORIZON_LABELS
from config.settings import PROCESSED_DATA_DIR, MODEL_SAVE_DIR, OUTPUT_DIR
from inference.output_schema import GridPrediction, HorizonForecast
from models.arima_model import SARIMAModel
from models.ensemble import EnsembleModel
from models.lstm_model import BiLSTMModel
from models.prophet_model import ProphetModel
from models.xgboost_model import XGBoostModel

log = logging.getLogger(__name__)

METRICS_MODEL_MAP = {
    "aqi_proxy": "ensemble",
    "no2_ugm3": "sarima",
    "so2_ugm3": "sarima",
    "co_ugm3": "sarima",
    "lst_celsius": "ensemble",
    "ndvi": "lstm",
    "vhi": "prophet",
    "soil_moisture": "lstm",
    "drought_risk": "xgboost",
    "rainfall_mm": "prophet",
    "carbon_balance": "xgboost",
}

# cache global LSTM models so they're loaded only once
_lstm_cache: dict[str, BiLSTMModel] = {}


def load_model(metric: str, grid_id: str, model_type: str, model_dir: str):
    """Load a trained model; return None if unavailable."""
    d = Path(model_dir)
    try:
        if model_type == "ensemble":
            m = EnsembleModel(metric, grid_id)
            m.load_components(str(d))
            return m
        if model_type == "sarima":
            return SARIMAModel.load(str(d / f"arima_{metric}_{grid_id}.pkl"))
        if model_type == "prophet":
            return ProphetModel.load(str(d / f"prophet_{metric}_{grid_id}.pkl"))
        if model_type == "lstm":
            if metric not in _lstm_cache:
                _lstm_cache[metric] = BiLSTMModel.load(str(d / f"lstm_{metric}.pt"))
            return _lstm_cache[metric]
        if model_type == "xgboost":
            return XGBoostModel.load(str(d / f"xgb_{metric}_{grid_id}.pkl"))
    except Exception as exc:
        log.debug("Model not found: %s/%s/%s — %s", model_type, metric, grid_id, exc)
        return None
    return None


def _get_grid_confidence(grid_id: str) -> float:
    """Mean R² for this grid from eval_metrics.json, default 0.5."""
    eval_path = OUTPUT_DIR / "eval_metrics.json"
    if not eval_path.exists():
        return 0.5
    try:
        data = json.loads(eval_path.read_text())
        r2_vals = []
        for _key, entries in data.items():
            if isinstance(entries, list):
                for e in entries:
                    if e.get("grid_id") == grid_id and "r2" in e:
                        r2_vals.append(e["r2"])
        return round(sum(r2_vals) / len(r2_vals), 4) if r2_vals else 0.5
    except Exception:
        return 0.5


def predict_grid(
    grid_id: str,
    lat: float,
    lng: float,
    merged_df: pd.DataFrame,
    model_dir: str,
) -> GridPrediction:
    """Generate predictions for one grid across all metrics and horizons."""
    predictions: dict = {}
    grid_series = merged_df[merged_df.grid_id == grid_id].copy()

    for metric, model_type in METRICS_MODEL_MAP.items():
        model = load_model(metric, grid_id, model_type, model_dir)

        if model is None:
            predictions[metric] = {
                label: HorizonForecast(None, None, None, model_type)
                for label in HORIZON_LABELS.values()
            }
            continue

        try:
            if model_type == "lstm":
                pred = model.predict(grid_series, steps=180)
            else:
                pred = model.predict(steps=180)
        except Exception as exc:
            log.warning("Predict failed %s/%s/%s: %s", model_type, metric, grid_id, exc)
            predictions[metric] = {
                label: HorizonForecast(None, None, None, model_type)
                for label in HORIZON_LABELS.values()
            }
            continue

        metric_preds: dict = {}
        for h in FORECAST_HORIZONS:
            idx = h - 1
            val = pred["val"][idx] if idx < len(pred["val"]) else None
            lo = pred["lo"][idx] if idx < len(pred["lo"]) else None
            hi = pred["hi"][idx] if idx < len(pred["hi"]) else None
            metric_preds[HORIZON_LABELS[h]] = HorizonForecast(val, lo, hi, model_type)
        predictions[metric] = metric_preds

    confidence = _get_grid_confidence(grid_id)
    return GridPrediction(grid_id, lat, lng, predictions, confidence)


def main() -> None:
    t0 = time.time()
    merged_df = pd.read_csv(
        PROCESSED_DATA_DIR / "merged_features.csv", parse_dates=["captured_at"]
    )
    grids = merged_df[["grid_id", "centroid_lat", "centroid_lng"]].drop_duplicates()
    log.info("Batch predict — %d grids", len(grids))

    results = []
    skipped = 0
    for _, row in tqdm(grids.iterrows(), total=len(grids), desc="Predicting all grids"):
        try:
            gp = predict_grid(
                row.grid_id, row.centroid_lat, row.centroid_lng,
                merged_df, str(MODEL_SAVE_DIR),
            )
            results.append(gp.to_dict())
        except Exception as exc:
            log.warning("Grid %s skipped: %s", row.grid_id, exc)
            skipped += 1

    output = {
        "generated_at": datetime.now().isoformat(),
        "city_id": "GJ_AHM",
        "grid_size_km": 3.0,
        "horizons": list(HORIZON_LABELS.values()),
        "total_grids": len(results),
        "grids": results,
    }

    out_path = OUTPUT_DIR / "predictions_output.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output, indent=2, default=str))

    elapsed = time.time() - t0
    print(f"\n=== Batch Prediction ===")
    print(f"Total grids: {len(results)}  |  Skipped: {skipped}  |  Runtime: {elapsed:.1f}s")


if __name__ == "__main__":
    main()
