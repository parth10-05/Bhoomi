# BHOOMI — prophet_model.py

import contextlib
import logging
import os

import numpy as np
import pandas as pd
from prophet import Prophet

from config.constants import METRIC_RANGES
from models.base_model import BaseModel

log = logging.getLogger(__name__)


class ProphetModel(BaseModel):
    """Facebook Prophet with Indian seasonal regressors."""

    def __init__(
        self,
        metric: str,
        grid_id: str,
        horizon_days: int,
        add_regressors: bool = True,
    ):
        super().__init__(metric, grid_id, horizon_days)
        self.add_regressors = add_regressors
        self.model = None

    @staticmethod
    def _build_regressors(df: pd.DataFrame) -> pd.DataFrame:
        ds = pd.to_datetime(df["ds"])
        df["is_diwali"] = ((ds.dt.month == 10) | ((ds.dt.month == 11) & (ds.dt.day <= 15))).astype(int)
        df["is_holi"] = ((ds.dt.month == 3) & (ds.dt.day >= 10) & (ds.dt.day <= 30)).astype(int)
        df["is_harvest"] = ds.dt.month.isin([10, 11]).astype(int)
        df["is_monsoon"] = ds.dt.month.isin([6, 7, 8, 9]).astype(int)
        return df

    def fit(self, train_series: pd.Series) -> None:
        df = pd.DataFrame({"ds": train_series.index, "y": train_series.values})
        vmin, vmax = METRIC_RANGES[self.metric]
        df["y"] = df["y"].clip(vmin, vmax)

        with open(os.devnull, "w") as devnull, contextlib.redirect_stdout(devnull):
            m = Prophet(
                yearly_seasonality=True,
                # OLD: weekly_seasonality=True, no uncertainty_samples
                weekly_seasonality=False,
                daily_seasonality=False,
                changepoint_prior_scale=0.05,
                uncertainty_samples=0,
            )
            if self.add_regressors:
                # OLD: ["is_diwali", "is_holi", "is_harvest", "is_monsoon"]
                for col in ["is_monsoon"]:
                    m.add_regressor(col)
            df = self._build_regressors(df)
            m.fit(df)

        self.model = m
        log.info("Prophet fitted for %s / %s", self.grid_id, self.metric)

    def predict(self, steps: int) -> dict:
        future = self.model.make_future_dataframe(periods=steps, freq="D")
        future = self._build_regressors(future)
        fc = self.model.predict(future).tail(steps)

        vmin, vmax = METRIC_RANGES[self.metric]
        val = fc["yhat"].clip(vmin, vmax).tolist()
        lo = fc["yhat_lower"].clip(vmin, vmax).tolist()
        hi = fc["yhat_upper"].clip(vmin, vmax).tolist()
        return {"val": val, "lo": lo, "hi": hi}
