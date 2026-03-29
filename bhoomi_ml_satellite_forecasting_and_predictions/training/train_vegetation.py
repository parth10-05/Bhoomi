# BHOOMI — train_vegetation.py

import logging

import numpy as np
import pandas as pd
from tqdm import tqdm

from config.constants import MIN_TRAIN_ROWS, MIN_TEST_ROWS, TRAINING_SPLIT_RATIO
from config.settings import PROCESSED_DATA_DIR, MODEL_SAVE_DIR, OUTPUT_DIR
from models.base_model import split_time_series
from models.lstm_model import BiLSTMModel
from models.prophet_model import ProphetModel
from training.evaluate import compute_metrics, save_eval_results

log = logging.getLogger(__name__)


# ── Part 1: Global BiLSTM ──────────────────────────────────────────────────────

def train_lstm(merged_df: pd.DataFrame, metric: str) -> None:
    """Train a global BiLSTM for *metric* and evaluate per grid."""
    log.info("Training BiLSTM for %s …", metric)
    model = BiLSTMModel(metric=metric, horizon_days=180)
    model.fit(merged_df)

    # OLD: per-grid LSTM eval loop — SKIPPED for speed (1139 grids too slow)
    # results: list[dict] = []
    # for grid_id in tqdm(...):
    #     ...evaluate per grid...
    log.info("LSTM %s -- training complete, per-grid eval skipped for speed", metric)


# ── Part 2: Prophet per grid ───────────────────────────────────────────────────

def train_prophet(df: pd.DataFrame, metric: str) -> None:
    """Train Prophet for *metric* on each grid independently."""
    results: list[dict] = []
    grid_ids = df.grid_id.unique()

    for grid_id in tqdm(grid_ids, desc=f"Prophet {metric}"):
        series = (
            df[df.grid_id == grid_id]
            .set_index("captured_at")[metric]
            .dropna()
        )
        if len(series) < MIN_TRAIN_ROWS + MIN_TEST_ROWS:
            continue
        try:
            train, test = split_time_series(series)
            model = ProphetModel(metric, grid_id, 180)
            model.fit(train)
            eval_d = model.evaluate(test)
            model.save(str(MODEL_SAVE_DIR / f"prophet_{metric}_{grid_id}.pkl"))
            results.append({"grid_id": grid_id, "metric": metric, **eval_d})
        except Exception as exc:
            log.warning("Prophet error %s / %s: %s", grid_id, metric, exc)

    save_eval_results(
        {f"prophet_{metric}": results},
        str(OUTPUT_DIR / "eval_metrics.json"),
        f"prophet_{metric}",
    )
    log.info("Prophet %s — trained %d grids", metric, len(results))


# ── main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    merged_df = pd.read_csv(
        PROCESSED_DATA_DIR / "merged_features.csv", parse_dates=["captured_at"]
    )
    veg_df = pd.read_csv(
        PROCESSED_DATA_DIR / "vegetation_clean.csv", parse_dates=["captured_at"]
    )
    drought_df = pd.read_csv(
        PROCESSED_DATA_DIR / "drought_clean.csv", parse_dates=["captured_at"]
    )
    # Limit to last 1 year of data for faster training
    cutoff_m = merged_df["captured_at"].max() - pd.Timedelta(days=365)
    merged_df = merged_df[merged_df["captured_at"] >= cutoff_m]
    cutoff_v = veg_df["captured_at"].max() - pd.Timedelta(days=365)
    veg_df = veg_df[veg_df["captured_at"] >= cutoff_v]
    cutoff_d = drought_df["captured_at"].max() - pd.Timedelta(days=365)
    drought_df = drought_df[drought_df["captured_at"] >= cutoff_d]

    train_lstm(merged_df, "ndvi")
    train_lstm(merged_df, "soil_moisture")
    train_prophet(veg_df, "vhi")
    train_prophet(drought_df, "rainfall_mm")


if __name__ == "__main__":
    main()
