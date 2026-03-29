# BHOOMI — ensemble.py

import logging
from pathlib import Path

import numpy as np
import pandas as pd

from config.constants import METRIC_RANGES
from models.arima_model import SARIMAModel
from models.prophet_model import ProphetModel

log = logging.getLogger(__name__)


class EnsembleModel:
    """Weighted ensemble of SARIMA + Prophet per metric per grid."""

    def __init__(self, metric: str, grid_id: str):
        self.metric = metric
        self.grid_id = grid_id
        self.sarima: SARIMAModel | None = None
        self.prophet: ProphetModel | None = None
        self.weights = {"sarima": 0.6, "prophet": 0.4}

    def load_components(self, model_dir: str) -> None:
        sarima_path = Path(model_dir) / f"arima_{self.metric}_{self.grid_id}.pkl"
        prophet_path = Path(model_dir) / f"prophet_{self.metric}_{self.grid_id}.pkl"

        has_sarima = sarima_path.exists()
        has_prophet = prophet_path.exists()

        if has_sarima:
            self.sarima = SARIMAModel.load(str(sarima_path))
            log.info("Loaded SARIMA from %s", sarima_path)
        if has_prophet:
            self.prophet = ProphetModel.load(str(prophet_path))
            log.info("Loaded Prophet from %s", prophet_path)

        if has_sarima and not has_prophet:
            self.weights = {"sarima": 1.0, "prophet": 0.0}
        elif has_prophet and not has_sarima:
            self.weights = {"sarima": 0.0, "prophet": 1.0}
        elif not has_sarima and not has_prophet:
            raise FileNotFoundError(
                f"No models found for {self.metric}/{self.grid_id} in {model_dir}"
            )

    def calibrate(self, test_series: pd.Series) -> None:
        if self.sarima is None or self.prophet is None:
            log.info("Only one model present — skipping calibration.")
            return

        metrics_s = self.sarima.evaluate(test_series)
        metrics_p = self.prophet.evaluate(test_series)
        rmse_s = metrics_s["rmse"]
        rmse_p = metrics_p["rmse"]

        if rmse_s == 0 and rmse_p == 0:
            self.weights = {"sarima": 0.5, "prophet": 0.5}
        else:
            inv_s = 1.0 / (rmse_s + 1e-8)
            inv_p = 1.0 / (rmse_p + 1e-8)
            w_sarima = inv_s / (inv_s + inv_p)
            self.weights = {"sarima": round(w_sarima, 4), "prophet": round(1 - w_sarima, 4)}

        log.info(
            "Calibrated weights %s/%s -> sarima=%.3f prophet=%.3f",
            self.grid_id,
            self.metric,
            self.weights["sarima"],
            self.weights["prophet"],
        )

    def predict(self, steps: int) -> dict:
        preds = []
        weights = []

        if self.sarima is not None and self.weights["sarima"] > 0:
            preds.append(self.sarima.predict(steps))
            weights.append(self.weights["sarima"])
        if self.prophet is not None and self.weights["prophet"] > 0:
            preds.append(self.prophet.predict(steps))
            weights.append(self.weights["prophet"])

        vmin, vmax = METRIC_RANGES[self.metric]
        val = np.zeros(steps)
        lo = np.zeros(steps)
        hi = np.zeros(steps)

        for p, w in zip(preds, weights):
            p_val = np.array([v if v is not None else 0 for v in p["val"]])
            p_lo = np.array([v if v is not None else 0 for v in p["lo"]])
            p_hi = np.array([v if v is not None else 0 for v in p["hi"]])
            val += w * p_val
            lo += w * p_lo
            hi += w * p_hi

        return {
            "val": np.clip(val, vmin, vmax).tolist(),
            "lo": np.clip(lo, vmin, vmax).tolist(),
            "hi": np.clip(hi, vmin, vmax).tolist(),
        }
