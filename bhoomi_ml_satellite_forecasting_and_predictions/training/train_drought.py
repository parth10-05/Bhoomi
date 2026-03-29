# BHOOMI — train_drought.py

import logging

import numpy as np
import pandas as pd
from tqdm import tqdm

from config.constants import MIN_TRAIN_ROWS, TRAINING_SPLIT_RATIO
from config.settings import PROCESSED_DATA_DIR, MODEL_SAVE_DIR, OUTPUT_DIR
from models.isolation_forest_model import IsolationForestModel
from models.xgboost_model import XGBoostModel
from training.evaluate import compute_metrics, save_eval_results

log = logging.getLogger(__name__)


def train_xgboost(merged_df: pd.DataFrame, metric: str) -> None:
    """Train XGBoost for *metric* on each grid."""
    results: list[dict] = []
    grid_ids = merged_df.grid_id.unique()

    for grid_id in tqdm(grid_ids, desc=f"XGBoost {metric}"):
        grid_df = merged_df[merged_df.grid_id == grid_id].copy()
        n = len(grid_df)
        split = int(n * TRAINING_SPLIT_RATIO)
        train_df = grid_df.iloc[:split]
        test_df = grid_df.iloc[split:]

        if len(train_df) < MIN_TRAIN_ROWS:
            continue

        try:
            model = XGBoostModel(metric, grid_id, 90)
            model.fit(train_df)
            y_true = test_df[metric].dropna().values
            y_pred = np.array(model.predict(len(test_df))["val"])[: len(y_true)]
            eval_d = compute_metrics(y_true, y_pred)
            model.save(str(MODEL_SAVE_DIR / f"xgb_{metric}_{grid_id}.pkl"))
            results.append({"grid_id": grid_id, "metric": metric, **eval_d})
        except Exception as exc:
            log.warning("XGBoost error %s / %s: %s", grid_id, metric, exc)

    save_eval_results(
        {f"xgb_{metric}": results},
        str(OUTPUT_DIR / "eval_metrics.json"),
        f"xgb_{metric}",
    )
    log.info("XGBoost %s — trained %d grids", metric, len(results))


def train_anomaly(merged_df: pd.DataFrame) -> None:
    """Train IsolationForest per grid."""
    grid_ids = merged_df.grid_id.unique()
    trained = 0

    for grid_id in tqdm(grid_ids, desc="Anomaly models"):
        grid_df = merged_df[merged_df.grid_id == grid_id]
        model = IsolationForestModel(grid_id)
        try:
            model.fit(grid_df)
        except ValueError as exc:
            log.warning("%s", exc)
            continue
        model.save(str(MODEL_SAVE_DIR / f"iforest_{grid_id}.pkl"))
        trained += 1

    log.info("IsolationForest — trained %d / %d grids", trained, len(grid_ids))


def main() -> None:
    merged_df = pd.read_csv(
        PROCESSED_DATA_DIR / "merged_features.csv", parse_dates=["captured_at"]
    )
    # Limit to last 1 year of data for faster training
    cutoff = merged_df["captured_at"].max() - pd.Timedelta(days=365)
    merged_df = merged_df[merged_df["captured_at"] >= cutoff]
    train_xgboost(merged_df, "drought_risk")
    train_xgboost(merged_df, "carbon_balance")
    train_anomaly(merged_df)


if __name__ == "__main__":
    main()
