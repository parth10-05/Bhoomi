# BHOOMI — output_schema.py

import datetime
from dataclasses import dataclass, field
from typing import Optional

from config.constants import DEG_PER_KM_LAT, DEG_PER_KM_LNG


def diagonal_from_centroid(lat: float, lng: float, size_km: float = 3.0) -> dict:
    """Return SW / NE corners of the grid cell."""
    half_lat = (size_km / 2) * DEG_PER_KM_LAT
    half_lng = (size_km / 2) * DEG_PER_KM_LNG
    return {
        "sw": {"lat": round(lat - half_lat, 6), "lng": round(lng - half_lng, 6)},
        "ne": {"lat": round(lat + half_lat, 6), "lng": round(lng + half_lng, 6)},
    }


def _serialise(obj):
    """Make a value JSON-friendly."""
    if isinstance(obj, (datetime.datetime, datetime.date)):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _serialise(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialise(v) for v in obj]
    return obj


# ── Forecast horizon ───────────────────────────────────────────────────────────

@dataclass
class HorizonForecast:
    val: float
    lo: float
    hi: float
    model: str = "ensemble"

    def to_dict(self) -> dict:
        return {"val": self.val, "lo": self.lo, "hi": self.hi, "model": self.model}


# ── Grid prediction ───────────────────────────────────────────────────────────

@dataclass
class GridPrediction:
    grid_id: str
    centroid_lat: float
    centroid_lng: float
    predictions: dict  # {metric: {horizon_label: HorizonForecast}}
    confidence: float = 0.5

    def to_dict(self) -> dict:
        preds = {}
        for metric, horizons in self.predictions.items():
            preds[metric] = {
                h: (v.to_dict() if hasattr(v, "to_dict") else v)
                for h, v in horizons.items()
            }
        return {
            "grid_id": self.grid_id,
            "centroid_lat": self.centroid_lat,
            "centroid_lng": self.centroid_lng,
            "bounds": diagonal_from_centroid(self.centroid_lat, self.centroid_lng),
            "predictions": _serialise(preds),
            "confidence": self.confidence,
        }


# ── Anomaly result ─────────────────────────────────────────────────────────────

@dataclass
class AnomalyResult:
    grid_id: str
    centroid_lat: float
    centroid_lng: float
    has_anomaly: bool
    anomaly_score: float
    anomaly_severity: str
    anomaly_metrics: list
    metric_scores: dict
    description: str = ""

    def to_dict(self) -> dict:
        return {
            "grid_id": self.grid_id,
            "centroid_lat": self.centroid_lat,
            "centroid_lng": self.centroid_lng,
            "bounds": diagonal_from_centroid(self.centroid_lat, self.centroid_lng),
            "has_anomaly": self.has_anomaly,
            "anomaly_score": self.anomaly_score,
            "anomaly_severity": self.anomaly_severity,
            "anomaly_metrics": self.anomaly_metrics,
            "metric_scores": _serialise(self.metric_scores),
            "description": self.description,
        }


# ── Carbon result ──────────────────────────────────────────────────────────────

@dataclass
class CarbonResult:
    grid_id: str
    centroid_lat: float
    centroid_lng: float
    carbon_balance: float
    is_carbon_positive: bool
    label: str
    contributing_factors: dict
    forecast_180d: dict

    def to_dict(self) -> dict:
        return {
            "grid_id": self.grid_id,
            "centroid_lat": self.centroid_lat,
            "centroid_lng": self.centroid_lng,
            "bounds": diagonal_from_centroid(self.centroid_lat, self.centroid_lng),
            "carbon_balance": self.carbon_balance,
            "is_carbon_positive": self.is_carbon_positive,
            "label": self.label,
            "contributing_factors": _serialise(self.contributing_factors),
            "forecast_180d": _serialise(self.forecast_180d),
        }


# ── Prescription zone ─────────────────────────────────────────────────────────

@dataclass
class PrescriptionZone:
    grid_id: str
    centroid_lat: float
    centroid_lng: float
    role: str
    description: str = ""

    def to_dict(self) -> dict:
        return {
            "grid_id": self.grid_id,
            "centroid_lat": self.centroid_lat,
            "centroid_lng": self.centroid_lng,
            "bounds": diagonal_from_centroid(self.centroid_lat, self.centroid_lng),
            "role": self.role,
            "description": self.description,
        }


# ── Prescription ───────────────────────────────────────────────────────────────

@dataclass
class Prescription:
    prescription_id: str
    type: str
    priority: int
    title: str
    source_grid: Optional[PrescriptionZone]
    receiver_grid: Optional[PrescriptionZone]
    intervention_zone: PrescriptionZone
    triggered_by: list
    evidence: dict
    impact: dict
    rationale: str = ""

    def to_dict(self) -> dict:
        return {
            "prescription_id": self.prescription_id,
            "type": self.type,
            "priority": self.priority,
            "title": self.title,
            "source_grid": self.source_grid.to_dict() if self.source_grid else None,
            "receiver_grid": self.receiver_grid.to_dict() if self.receiver_grid else None,
            "intervention_zone": self.intervention_zone.to_dict(),
            "triggered_by": _serialise(self.triggered_by),
            "evidence": _serialise(self.evidence),
            "impact": _serialise(self.impact),
            "rationale": self.rationale,
        }
