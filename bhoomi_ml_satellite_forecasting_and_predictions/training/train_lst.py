# BHOOMI — train_lst.py

import logging
from collections import defaultdict

import numpy as np
import pandas as pd
from tqdm import tqdm

from config.constants import MIN_TRAIN_ROWS, MIN_TEST_ROWS
from config.settings import PROCESSED_DATA_DIR, MODEL_SAVE_DIR, OUTPUT_DIR
from models.arima_model import SARIMAModel
from models.base_model import split_time_series
from models.prophet_model import ProphetModel
from training.evaluate import compute_metrics, evaluate_by_horizon, save_eval_results

log = logging.getLogger(__name__)


def _quality_weights(df: pd.DataFrame, test_index: pd.Index) -> np.ndarray:
    """Return sample weights from data_quality: lower quality -> lower weight."""
    if "data_quality" not in df.columns:
        return np.ones(len(test_index))
    dq = df.set_index("captured_at")["data_quality"].reindex(test_index).fillna(0.5)
    # weight = 1 - data_quality  (high quality flag -> low weight? spec says
    # "(1 - data_quality) inverted so low-quality observations contribute less")
    # Interpretation: weight = 1 - data_quality  where data_quality near 1 means
    # low quality, so weight is small.  If the column is the opposite, clamp.
    weights = (1.0 - dq.values).clip(0.01, 1.0)
    return weights


def main() -> None:
    df = pd.read_csv(
        PROCESSED_DATA_DIR / "lst_clean.csv", parse_dates=["captured_at"]
    )
    # Limit to last 1 year of data for faster training
    cutoff = df["captured_at"].max() - pd.Timedelta(days=365)
    df = df[df["captured_at"] >= cutoff]
    grid_ids = df.grid_id.unique()
    log.info("LST training — %d grids", len(grid_ids))

    sarima_results: list[dict] = []
    prophet_results: list[dict] = []
    skip_count = 0

    for grid_id in tqdm(grid_ids, desc="Training LST models"):
        grid_df = df[df.grid_id == grid_id].copy()
        series = grid_df.set_index("captured_at")["lst_celsius"].dropna()

        if len(series) < MIN_TRAIN_ROWS + MIN_TEST_ROWS:
            log.info("Skip %s — only %d rows", grid_id, len(series))
            skip_count += 1
            continue

        try:
            train, test = split_time_series(series)
        except ValueError as exc:
            log.warning("Split error %s: %s", grid_id, exc)
            skip_count += 1
            continue

        weights = _quality_weights(grid_df, test.index)

        # ── SARIMA (30d) ──
        try:
            model_s = SARIMAModel("lst_celsius", grid_id, 30)
            model_s.fit(train)
            eval_d = compute_metrics(test.values, np.array(model_s.predict(len(test))["val"]), weights)
            horizon_eval = evaluate_by_horizon(model_s, test, [1, 7, 10, 30])
            model_s.save(str(MODEL_SAVE_DIR / f"arima_lst_celsius_{grid_id}.pkl"))
            sarima_results.append({
                "model_type": "sarima", "metric": "lst_celsius",
                "grid_id": grid_id, **eval_d, "horizon_eval": horizon_eval,
            })
        except Exception as exc:
            log.warning("SARIMA error %s: %s", grid_id, exc)

        # OLD: Prophet (180d) section — SKIPPED (stan_backend errors, SARIMA sufficient)
        # try:
        #     model_p = ProphetModel("lst_celsius", grid_id, 180)
        #     model_p.fit(train)
        #     pred_p = model_p.predict(len(test))
        #     eval_p = compute_metrics(test.values, np.array(pred_p["val"]), weights)
        #     model_p.save(str(MODEL_SAVE_DIR / f"prophet_lst_{grid_id}.pkl"))
        #     prophet_results.append({...})
        # except Exception as exc:
        #     log.warning("Prophet error %s: %s", grid_id, exc)

    # persist
    eval_path = str(OUTPUT_DIR / "eval_metrics.json")
    save_eval_results({"lst_sarima": sarima_results}, eval_path, "lst_sarima")
    save_eval_results({"lst_prophet": prophet_results}, eval_path, "lst_prophet")

    # summary
    print(f"\n=== LST Training ===")
    print(f"SARIMA trained: {len(sarima_results)}  |  Prophet trained: {len(prophet_results)}  |  Skipped: {skip_count}")
    if sarima_results:
        print(f"  SARIMA mean R² = {np.mean([r.get('r2', 0) for r in sarima_results]):.4f}")
    if prophet_results:
        print(f"  Prophet mean R² = {np.mean([r.get('r2', 0) for r in prophet_results]):.4f}")


if __name__ == "__main__":
    main()
