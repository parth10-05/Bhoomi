# BHOOMI — arima_model.py

import logging
import signal

import numpy as np
import pandas as pd
from statsmodels.tsa.statespace.sarimax import SARIMAX

from config.constants import METRIC_RANGES
from models.base_model import BaseModel

log = logging.getLogger(__name__)

_LOG_METRICS = {"aqi_proxy", "no2_ugm3", "so2_ugm3", "co_ugm3", "rainfall_mm"}


class SARIMAModel(BaseModel):
    """SARIMA for short-horizon forecasting (1d – 30d)."""

    def __init__(
        self,
        metric: str,
        grid_id: str,
        horizon_days: int,
        order: tuple = (1, 1, 1),
        seasonal_order: tuple = (1, 1, 1, 7),
    ):
        super().__init__(metric, grid_id, horizon_days)
        self.order = order
        self.seasonal_order = seasonal_order
        self.log_transformed = metric in _LOG_METRICS
        self.fit_failed = False
        self.result = None

    def fit(self, train_series: pd.Series) -> None:
        series = train_series.copy()
        if not isinstance(series.index, pd.DatetimeIndex):
            series.index = pd.to_datetime(series.index)
        series = series.asfreq("D")
        series = series.ffill(limit=2)

        if self.log_transformed:
            series = np.log1p(series)

        try:
            model = SARIMAX(
                series,
                order=self.order,
                seasonal_order=self.seasonal_order,
                enforce_stationarity=False,
                enforce_invertibility=False,
            )
            self.result = model.fit(disp=False)
        except Exception as exc:
            self.fit_failed = True
            log.warning(
                "SARIMA fit failed for %s / %s: %s", self.grid_id, self.metric, exc
            )

    def predict(self, steps: int) -> dict:
        if self.fit_failed or self.result is None:
            return {
                "val": [None] * steps,
                "lo": [None] * steps,
                "hi": [None] * steps,
            }

        forecast = self.result.get_forecast(steps=steps)
        mean = forecast.predicted_mean.values
        ci = forecast.conf_int(alpha=0.05)
        lo = ci.iloc[:, 0].values
        hi = ci.iloc[:, 1].values

        if self.log_transformed:
            mean = np.expm1(mean)
            lo = np.expm1(lo)
            hi = np.expm1(hi)

        vmin, vmax = METRIC_RANGES[self.metric]
        mean = np.clip(mean, vmin, vmax)
        lo = np.clip(lo, vmin, vmax)
        hi = np.clip(hi, vmin, vmax)

        return {
            "val": mean.tolist(),
            "lo": lo.tolist(),
            "hi": hi.tolist(),
        }

    def auto_tune(self, train_series: pd.Series) -> None:
        """Grid-search (p,d,q)×(P,Q) to minimise AIC."""
        best_aic = np.inf
        best_order = self.order
        best_seasonal = self.seasonal_order

        series = train_series.copy()
        if not isinstance(series.index, pd.DatetimeIndex):
            series.index = pd.to_datetime(series.index)
        series = series.asfreq("D").ffill(limit=2)
        if self.log_transformed:
            series = np.log1p(series)

        for p in range(3):
            for d in range(2):
                for q in range(3):
                    for P in range(2):
                        for Q in range(2):
                            seasonal = (P, 1, Q, 7)
                            try:
                                model = SARIMAX(
                                    series,
                                    order=(p, d, q),
                                    seasonal_order=seasonal,
                                    enforce_stationarity=False,
                                    enforce_invertibility=False,
                                )
                                res = model.fit(disp=False, maxiter=50)
                                if res.aic < best_aic:
                                    best_aic = res.aic
                                    best_order = (p, d, q)
                                    best_seasonal = seasonal
                            except Exception:
                                continue

        self.order = best_order
        self.seasonal_order = best_seasonal
        log.info(
            "Auto-tune %s/%s -> order=%s seasonal=%s AIC=%.1f",
            self.grid_id,
            self.metric,
            best_order,
            best_seasonal,
            best_aic,
        )
