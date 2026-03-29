# BHOOMI — base_model.py

import logging
from abc import ABC, abstractmethod

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

from config.constants import MIN_TRAIN_ROWS, MIN_TEST_ROWS

log = logging.getLogger(__name__)


def compute_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    """Compute MAE, RMSE, MAPE, R² between arrays."""
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)

    if len(y_true) == 0 or len(y_pred) == 0:
        return {"mae": 0.0, "rmse": 0.0, "mape": 0.0, "r2": 0.0}

    mae = round(float(mean_absolute_error(y_true, y_pred)), 4)
    rmse = round(float(np.sqrt(mean_squared_error(y_true, y_pred))), 4)
    mape = round(float(np.mean(np.abs((y_true - y_pred) / (y_true + 1e-8))) * 100), 4)

    if np.allclose(y_true, y_pred):
        r2 = 1.0
    else:
        r2 = round(float(r2_score(y_true, y_pred)), 4)

    return {"mae": mae, "rmse": rmse, "mape": mape, "r2": r2}


def split_time_series(
    series: pd.Series, ratio: float = 0.85
) -> tuple[pd.Series, pd.Series]:
    """Split a time-indexed series by position."""
    n = len(series)
    split_idx = int(n * ratio)
    train = series.iloc[:split_idx]
    test = series.iloc[split_idx:]

    if len(train) < MIN_TRAIN_ROWS:
        raise ValueError(
            f"Train set too small: {len(train)} rows (need {MIN_TRAIN_ROWS})"
        )
    if len(test) < MIN_TEST_ROWS:
        raise ValueError(
            f"Test set too small: {len(test)} rows (need {MIN_TEST_ROWS})"
        )
    return train, test


class BaseModel(ABC):
    """Abstract base for all BHOOMI forecasting models."""

    def __init__(self, metric: str, grid_id: str, horizon_days: int):
        self.metric = metric
        self.grid_id = grid_id
        self.horizon_days = horizon_days

    @abstractmethod
    def fit(self, train_series: pd.Series) -> None:
        ...

    @abstractmethod
    def predict(self, steps: int) -> dict:
        ...

    def save(self, path: str) -> None:
        joblib.dump(self, path)
        log.info("Model saved -> %s", path)

    @classmethod
    def load(cls, path: str) -> "BaseModel":
        return joblib.load(path)

    def evaluate(self, test_series: pd.Series) -> dict:
        y_true = test_series.values
        pred = self.predict(len(test_series))
        y_pred = np.array(pred["val"])
        n = min(len(y_true), len(y_pred))
        return compute_metrics(y_true[:n], y_pred[:n])
