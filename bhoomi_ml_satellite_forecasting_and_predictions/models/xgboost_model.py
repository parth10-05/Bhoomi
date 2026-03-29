# BHOOMI — xgboost_model.py

import logging

import numpy as np
import pandas as pd
# OLD: import shap  # removed — triggers TensorFlow DLL crash
import xgboost as xgb

from config.constants import METRIC_RANGES
from models.base_model import BaseModel

log = logging.getLogger(__name__)

XGBOOST_FEATURES = {
    "drought_risk": [
        "soil_moisture", "soil_moisture_deficit", "spi_30d", "rainfall_mm",
        "ndvi", "vhi", "trees_pct", "crops_pct", "month", "is_monsoon",
        "soil_lag7", "rainfall_roll30", "drought_lag7",
    ],
    "carbon_balance": [
        "built_pct", "trees_pct", "crops_pct", "bare_pct", "ndvi",
        "aqi_proxy", "co_ugm3", "no2_ugm3", "aqi_norm", "month", "is_monsoon",
    ],
}


class XGBoostModel(BaseModel):
    """XGBoost regressor for drought_risk / carbon_balance."""

    def __init__(
        self,
        metric: str,
        grid_id: str,
        horizon_days: int,
        # OLD: n_estimators=300, lr=0.05
        n_estimators: int = 100,
        max_depth: int = 4,
        lr: float = 0.1,
    ):
        super().__init__(metric, grid_id, horizon_days)
        self.n_estimators = n_estimators
        self.max_depth = max_depth
        self.lr = lr
        self.feature_names = XGBOOST_FEATURES[metric]
        self.shap_values = None
        self.model = None
        self._last_X: pd.DataFrame | None = None

    def fit(self, train_df: pd.DataFrame) -> None:  # type: ignore[override]
        X = train_df[self.feature_names].fillna(
            train_df[self.feature_names].median()
        )
        y = train_df[self.metric].dropna()
        X = X.loc[y.index]

        self.model = xgb.XGBRegressor(
            n_estimators=self.n_estimators,
            max_depth=self.max_depth,
            learning_rate=self.lr,
            random_state=42,
        )
        self.model.fit(X, y)
        self._last_X = X

        # OLD: SHAP block removed — triggers TensorFlow DLL crash, skip entirely
        # try:
        #     explainer = shap.TreeExplainer(self.model)
        #     self.shap_values = explainer.shap_values(X.iloc[: min(500, len(X))])
        # except Exception:
        #     log.debug("SHAP unavailable ...")
        self.shap_values = None
        log.info("XGBoost fitted for %s / %s (%d rows)", self.grid_id, self.metric, len(X))

    def predict(self, steps: int) -> dict:
        if self.model is None or self._last_X is None:
            return {"val": [None] * steps, "lo": [None] * steps, "hi": [None] * steps}

        latest = self._last_X.iloc[[-1]]
        val = float(self.model.predict(latest)[0])
        vmin, vmax = METRIC_RANGES[self.metric]
        val = float(np.clip(val, vmin, vmax))

        return {
            "val": [val] * steps,
            "lo": [round(val * 0.85, 6)] * steps,
            "hi": [round(val * 1.15, 6)] * steps,
        }

    def get_feature_importance(self) -> dict:
        if self.shap_values is not None:
            mean_abs = np.mean(np.abs(self.shap_values), axis=0)
            imp = dict(zip(self.feature_names, mean_abs))
        elif self.model is not None:
            imp = dict(zip(self.feature_names, self.model.feature_importances_))
        else:
            return {}

        sorted_imp = dict(
            sorted(imp.items(), key=lambda kv: kv[1], reverse=True)[:5]
        )
        return sorted_imp
