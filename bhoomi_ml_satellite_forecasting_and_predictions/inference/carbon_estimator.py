# BHOOMI — carbon_estimator.py

import json
import logging
from datetime import datetime

import pandas as pd
from tqdm import tqdm

from config.settings import PROCESSED_DATA_DIR, MODEL_SAVE_DIR, OUTPUT_DIR
from inference.output_schema import diagonal_from_centroid
from models.xgboost_model import XGBoostModel

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
    log.info("Carbon estimation — %d grids", len(latest))

    results: list[dict] = []
    for _, row in tqdm(latest.iterrows(), total=len(latest), desc="Carbon estimation"):
        cb = row.get("carbon_balance")
        if pd.isna(cb):
            source = (
                min(row.get("aqi_proxy", 250), 500) / 500 * 0.4
                + row.get("built_pct", 50) / 100 * 0.35
                + row.get("co_ugm3", 5000) / 15000 * 0.25
            )
            sink = (
                row.get("trees_pct", 10) / 100 * 0.5
                + max(row.get("ndvi", 0.3) + 0.1, 0) * 0.3
                + row.get("crops_pct", 20) / 100 * 0.2
            )
            cb = round(max(-1.0, min(1.0, sink - source)), 4)

        if cb < -0.05:
            label = "carbon_sink"
        elif cb < 0.1:
            label = "carbon_neutral"
        else:
            label = "carbon_source"

        forecast_180d = None
        model_path = MODEL_SAVE_DIR / f"xgb_carbon_balance_{row.grid_id}.pkl"
        if model_path.exists():
            try:
                model = XGBoostModel.load(str(model_path))
                p = model.predict(180)
                forecast_180d = {
                    "carbon_balance": {
                        "val": round(p["val"][-1], 4),
                        "lo": round(p["lo"][-1], 4),
                        "hi": round(p["hi"][-1], 4),
                    }
                }
            except Exception as exc:
                log.warning("Carbon forecast error %s: %s", row.grid_id, exc)

        results.append({
            "grid_id": row.grid_id,
            "centroid_lat": row.centroid_lat,
            "centroid_lng": row.centroid_lng,
            "carbon_balance": cb,
            "is_carbon_positive": cb > 0.1,
            "label": label,
            "diagonal": diagonal_from_centroid(row.centroid_lat, row.centroid_lng),
            "forecast_180d": forecast_180d,
        })

    source_grids = sum(1 for r in results if r["is_carbon_positive"])
    sink_grids = sum(1 for r in results if not r["is_carbon_positive"])
    mean_balance = round(sum(r["carbon_balance"] for r in results) / max(len(results), 1), 4)

    output = {
        "generated_at": datetime.now().isoformat(),
        "city_id": "GJ_AHM",
        "summary": {
            "source_grids": source_grids,
            "sink_grids": sink_grids,
            "mean_balance": mean_balance,
        },
        "grids": results,
    }

    out_path = OUTPUT_DIR / "carbon_output.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output, indent=2, default=str))

    print(f"\n=== Carbon Estimation ===")
    print(f"Source grids: {source_grids}  |  Sink grids: {sink_grids}  |  Mean balance: {mean_balance}")


if __name__ == "__main__":
    run_all()
