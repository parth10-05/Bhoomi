# BHOOMI — isolation_forest_model.py

import logging

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from config.constants import ANOMALY_FEATURES, CAUSAL_THRESHOLDS

log = logging.getLogger(__name__)

ANOMALY_THRESHOLD = CAUSAL_THRESHOLDS["anomaly_threshold"]


class IsolationForestModel:
    """Per-grid anomaly detection — does NOT inherit BaseModel."""

    def __init__(
        self,
        grid_id: str,
        contamination: float = 0.03,
        # OLD: n_estimators=200
        n_estimators: int = 100,
    ):
        self.grid_id = grid_id
        self.features = list(ANOMALY_FEATURES)
        self.model = IsolationForest(
            n_estimators=n_estimators,
            contamination=contamination,
            random_state=42,
        )
        self.feature_medians: dict = {}

    def fit(self, grid_df: pd.DataFrame) -> None:
        X = grid_df[self.features].copy()
        self.feature_medians = X.median().to_dict()
        X = X.fillna(self.feature_medians)
        if len(X) < 30:
            log.warning("Grid %s: too sparse (%d rows < 30), skipping fit", self.grid_id, len(X))
            self._fitted = False
            return
        self._fitted = True
        self.model.fit(X)
        log.info("IsolationForest fitted for grid %s (%d rows)", self.grid_id, len(X))

    def score(self, obs: dict) -> dict:
        if not getattr(self, "_fitted", False):
            return {
                "has_anomaly": False,
                "anomaly_score": None,
                "anomaly_severity": None,
                "anomaly_metrics": [],
                "description": "Insufficient data for anomaly detection",
            }
        row = {f: obs.get(f, self.feature_medians.get(f, 0)) for f in self.features}
        X = pd.DataFrame([row])[self.features]
        raw = float(self.model.score_samples(X)[0])
        is_anomaly = raw < ANOMALY_THRESHOLD

        # per-feature contribution
        feature_scores: dict[str, float] = {}
        for feat in self.features:
            X_mod = X.copy()
            X_mod[feat] = self.feature_medians.get(feat, 0)
            raw_mod = float(self.model.score_samples(X_mod)[0])
            feature_scores[feat] = round(raw_mod - raw, 6)

        if raw > -0.25:
            severity = "low"
        elif raw > -0.40:
            severity = "medium"
        else:
            severity = "high"

        anomaly_metrics = [f for f, s in feature_scores.items() if s < -0.02]

        return {
            "grid_id": self.grid_id,
            "centroid_lat": obs.get("centroid_lat"),
            "centroid_lng": obs.get("centroid_lng"),
            "has_anomaly": is_anomaly,
            "anomaly_score": round(raw, 6),
            "anomaly_severity": severity,
            "anomaly_metrics": anomaly_metrics,
            "metric_scores": feature_scores,
        }

    def save(self, path: str) -> None:
        joblib.dump(self, path)
        log.info("IsolationForest saved -> %s", path)

    @classmethod
    def load(cls, path: str) -> "IsolationForestModel":
        return joblib.load(path)
