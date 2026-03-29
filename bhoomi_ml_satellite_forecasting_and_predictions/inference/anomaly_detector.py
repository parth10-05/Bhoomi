# BHOOMI — anomaly_detector.py

import json
import logging
from collections import Counter
from datetime import datetime

import pandas as pd
from tqdm import tqdm

from config.settings import PROCESSED_DATA_DIR, MODEL_SAVE_DIR, OUTPUT_DIR
from inference.output_schema import diagonal_from_centroid
from models.isolation_forest_model import IsolationForestModel

log = logging.getLogger(__name__)


def run_all() -> None:
    merged_df = pd.read_csv(
        PROCESSED_DATA_DIR / "merged_features.csv", parse_dates=["captured_at"]
    )
    latest = (
        merged_df.sort_values("captured_at")
        .groupby("grid_id")
        .last()
        .reset_index()
    )
    log.info("Anomaly detection — %d grids", len(latest))

    results: list[dict] = []
    for _, row in tqdm(latest.iterrows(), total=len(latest), desc="Anomaly detection"):
        model_path = MODEL_SAVE_DIR / f"iforest_{row.grid_id}.pkl"
        diag = diagonal_from_centroid(row.centroid_lat, row.centroid_lng)

        if not model_path.exists():
            results.append({
                "grid_id": row.grid_id,
                "centroid_lat": row.centroid_lat,
                "centroid_lng": row.centroid_lng,
                "has_anomaly": False,
                "reason": "no_model",
                "diagonal": diag,
            })
            continue

        model = IsolationForestModel.load(str(model_path))
        result = model.score(row.to_dict())
        result["centroid_lat"] = row.centroid_lat
        result["centroid_lng"] = row.centroid_lng
        result["diagonal"] = diag

        if result["has_anomaly"]:
            worst = min(result["metric_scores"], key=result["metric_scores"].get)
            result["description"] = (
                f"Anomalous {worst} detected in grid {row.grid_id}. "
                f"Severity: {result['anomaly_severity']}. "
                f"Score: {result['anomaly_score']:.3f}. "
                f"Affected metrics: {', '.join(result['anomaly_metrics'])}."
            )

        results.append(result)

    anomalous = [r for r in results if r.get("has_anomaly")]
    by_severity = dict(Counter(r.get("anomaly_severity", "none") for r in anomalous))

    output = {
        "generated_at": datetime.now().isoformat(),
        "city_id": "GJ_AHM",
        "total_anomalies": len(anomalous),
        "by_severity": by_severity,
        "grids": results,
    }

    out_path = OUTPUT_DIR / "anomalies_output.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output, indent=2, default=str))

    print(f"\n=== Anomaly Detection ===")
    print(f"Total anomalies: {len(anomalous)} / {len(results)} grids")
    for sev, cnt in by_severity.items():
        print(f"  {sev}: {cnt}")


if __name__ == "__main__":
    run_all()
