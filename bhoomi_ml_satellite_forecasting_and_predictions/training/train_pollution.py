# BHOOMI — train_pollution.py

import logging
from collections import defaultdict

import numpy as np
import pandas as pd
from tqdm import tqdm

from config.constants import MIN_TRAIN_ROWS, MIN_TEST_ROWS
from config.settings import PROCESSED_DATA_DIR, MODEL_SAVE_DIR, OUTPUT_DIR
from models.arima_model import SARIMAModel
from models.base_model import split_time_series
from training.evaluate import evaluate_by_horizon, save_eval_results

log = logging.getLogger(__name__)

METRICS = ["aqi_proxy", "no2_ugm3", "so2_ugm3", "co_ugm3"]


def _train_grid(grid_id: str, df: pd.DataFrame) -> list[dict]:
    """Train SARIMA for all pollution metrics on one grid."""
    results: list[dict] = []
    grid_df = df[df.grid_id == grid_id].copy()

    for metric in METRICS:
        series = grid_df.set_index("captured_at")[metric].dropna()
        if len(series) < MIN_TRAIN_ROWS + MIN_TEST_ROWS:
            log.info("Skip %s / %s — only %d rows", grid_id, metric, len(series))
            continue

        try:
            train, test = split_time_series(series)
            model = SARIMAModel(metric, grid_id, 30)
            model.fit(train)
            eval_d = model.evaluate(test)
            horizon_eval = evaluate_by_horizon(model, test, [1, 7, 10, 30])
            model.save(str(MODEL_SAVE_DIR / f"arima_{metric}_{grid_id}.pkl"))
            results.append({
                "model_type": "sarima",
                "metric": metric,
                "grid_id": grid_id,
                **eval_d,
                "horizon_eval": horizon_eval,
            })
        except Exception as exc:
            log.warning("Error training %s / %s: %s", grid_id, metric, exc)

    return results


def main() -> None:
    df = pd.read_csv(
        PROCESSED_DATA_DIR / "pollution_clean.csv", parse_dates=["captured_at"]
    )
    # Limit to last 1 year of data for faster training
    cutoff = df["captured_at"].max() - pd.Timedelta(days=365)
    df = df[df["captured_at"] >= cutoff]
    grid_ids = df.grid_id.unique()
    log.info("Pollution training — %d grids, metrics: %s", len(grid_ids), METRICS)

    results: list[dict] = []
    skip_count = 0

    for grid_id in tqdm(grid_ids, desc="Training pollution models"):
        grid_results = _train_grid(grid_id, df)
        if grid_results:
            results.extend(grid_results)
        else:
            skip_count += 1

    # persist
    save_eval_results(
        {"pollution_sarima": results},
        str(OUTPUT_DIR / "eval_metrics.json"),
        "pollution_sarima",
    )

    # summary
    trained_count = len(results)
    print(f"\n=== Pollution SARIMA ===")
    print(f"Trained: {trained_count}  |  Skipped grids: {skip_count}")
    r2_by_metric: dict[str, list[float]] = defaultdict(list)
    for r in results:
        r2_by_metric[r["metric"]].append(r.get("r2", 0.0))
    for m, vals in r2_by_metric.items():
        print(f"  {m:>12s}  mean R² = {np.mean(vals):.4f}")


if __name__ == "__main__":
    main()
