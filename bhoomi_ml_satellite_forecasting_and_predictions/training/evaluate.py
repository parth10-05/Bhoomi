# BHOOMI — evaluate.py

import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

log = logging.getLogger(__name__)


# ── 1. Core metrics ────────────────────────────────────────────────────────────

def compute_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    weights: np.ndarray | None = None,
) -> dict:
    """MAE, RMSE, MAPE, R² — all rounded to 4 dp."""
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)

    if len(y_true) == 0 or len(y_pred) == 0:
        return {"mae": 0.0, "rmse": 0.0, "mape": 0.0, "r2": 0.0}

    mae = round(float(mean_absolute_error(y_true, y_pred, sample_weight=weights)), 4)
    rmse = round(float(np.sqrt(mean_squared_error(y_true, y_pred, sample_weight=weights))), 4)
    mape = round(
        float(np.mean(np.abs((y_true - y_pred) / (y_true + 1e-8))) * 100), 4
    )

    if np.allclose(y_true, y_pred):
        r2 = 1.0
    else:
        r2 = round(float(r2_score(y_true, y_pred, sample_weight=weights)), 4)

    return {"mae": mae, "rmse": rmse, "mape": mape, "r2": r2}


# ── 2. Per-horizon evaluation ──────────────────────────────────────────────────

def evaluate_by_horizon(
    model,
    test_series: pd.Series,
    horizons: list[int] | None = None,
) -> dict:
    """Evaluate a model at multiple forecast horizons.

    For each horizon *h*, take the last *h* values of *test_series* as actuals,
    predict *h* steps from the day before, and compute metrics.
    """
    if horizons is None:
        horizons = [1, 7, 10, 30]

    results: dict[int, dict] = {}
    for h in horizons:
        if h > len(test_series):
            log.warning("Horizon %d exceeds test length %d — skipping", h, len(test_series))
            continue
        actual = test_series.iloc[-h:].values
        pred = model.predict(h)
        y_pred = np.array(pred["val"])
        n = min(len(actual), len(y_pred))
        results[h] = compute_metrics(actual[:n], y_pred[:n])

    return results


# ── 3. Persist evaluation results ─────────────────────────────────────────────

def save_eval_results(new_results: dict, output_path: str, key: str) -> None:
    """Merge *new_results* under *key* into an existing JSON file."""
    path = Path(output_path)
    try:
        existing = json.loads(path.read_text()) if path.exists() else {}
    except Exception:
        existing = {}

    existing[key] = new_results

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(existing, indent=2))
    log.info("Eval results saved -> %s [%s]", output_path, key)


# ── 4. Summary printer ────────────────────────────────────────────────────────

def print_summary(path: str) -> None:
    """Load eval_metrics.json and print a compact table."""
    data = json.loads(Path(path).read_text())

    rows: list[dict] = []
    for key, horizons in data.items():
        parts = key.split("_", 1)
        model_type = parts[0] if parts else key
        metric_name = parts[1] if len(parts) > 1 else ""
        r2_vals, rmse_vals = [], []
        for _h, m in horizons.items():
            r2_vals.append(m.get("r2", 0.0))
            rmse_vals.append(m.get("rmse", 0.0))
        rows.append({
            "model_type": model_type,
            "metric": metric_name,
            "mean_r2": round(float(np.mean(r2_vals)), 4) if r2_vals else 0.0,
            "std_r2": round(float(np.std(r2_vals)), 4) if r2_vals else 0.0,
            "mean_rmse": round(float(np.mean(rmse_vals)), 4) if rmse_vals else 0.0,
        })

    header = f"{'model_type':<14} {'metric':<20} {'mean_r2':>8} {'std_r2':>8} {'mean_rmse':>10}"
    print(header)
    print("-" * len(header))
    for r in rows:
        print(
            f"{r['model_type']:<14} {r['metric']:<20} "
            f"{r['mean_r2']:>8.4f} {r['std_r2']:>8.4f} {r['mean_rmse']:>10.4f}"
        )
