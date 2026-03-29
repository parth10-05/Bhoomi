# BHOOMI — run_all_training.py
"""
Master pipeline script.
Run after all other files are implemented to execute the full pipeline.
"""

import argparse
import logging
import sys
import time

from config.settings import OUTPUT_DIR, validate_settings

log = logging.getLogger(__name__)


def parse_args():
    p = argparse.ArgumentParser(description="BHOOMI full pipeline")
    p.add_argument("--skip-preprocess", action="store_true",
                   help="Use existing processed CSVs")
    p.add_argument("--skip-training", action="store_true",
                   help="Use existing model files")
    p.add_argument("--skip-inference", action="store_true",
                   help="Skip batch predict + anomaly + carbon")
    p.add_argument("--skip-report", action="store_true",
                   help="Skip causal + prescriptions + report context")
    p.add_argument("--skip-db", action="store_true",
                   help="Skip PostgreSQL sync")
    return p.parse_args()


def main():
    args = parse_args()
    validate_settings()
    start = time.time()
    log.info("=== BHOOMI Pipeline Starting ===")

    # ── Stage 1: Preprocessing ───────────────────────────────────────────────
    if not args.skip_preprocess:
        log.info("Stage 1: Preprocessing 6 CSVs...")
        from data.preprocess_lst import main as p1
        from data.preprocess_pollution import main as p2
        from data.preprocess_vegetation import main as p3
        from data.preprocess_lulc import main as p4
        from data.preprocess_weather import main as p5
        from data.preprocess_drought import main as p6
        from data.merge_features import main as p7

        for fn, name in [
            (p1, "LST"), (p2, "Pollution"), (p3, "Vegetation"),
            (p4, "LULC"), (p5, "Weather"), (p6, "Drought"), (p7, "Merge"),
        ]:
            try:
                fn()
                log.info("  [OK] %s", name)
            except Exception as e:
                log.error("  [FAIL] %s: %s", name, e)
                sys.exit(1)
    else:
        log.info("Stage 1: Skipped (--skip-preprocess)")

    # ── Stage 2: Training ────────────────────────────────────────────────────
    if not args.skip_training:
        log.info("Stage 2: Training models...")
        from training.train_pollution import main as t1
        from training.train_vegetation import main as t2
        from training.train_lst import main as t3
        from training.train_drought import main as t4

        for fn, name in [
            (t1, "Pollution"), (t2, "Vegetation"),
            (t3, "LST"), (t4, "Drought+Carbon+Anomaly"),
        ]:
            try:
                fn()
                log.info("  [OK] %s", name)
            except Exception as e:
                log.error("  [FAIL] %s: %s", name, e)
    else:
        log.info("Stage 2: Skipped (--skip-training)")

    # ── Stage 3: Batch inference ─────────────────────────────────────────────
    if not args.skip_inference:
        log.info("Stage 3: Batch inference...")
        from inference.batch_predict import main as i1
        from inference.anomaly_detector import run_all as i2
        from inference.carbon_estimator import run_all as i3

        for fn, name in [
            (i1, "Predictions"), (i2, "Anomalies"), (i3, "Carbon"),
        ]:
            try:
                fn()
                log.info("  [OK] %s", name)
            except Exception as e:
                log.error("  [FAIL] %s: %s", name, e)
    else:
        log.info("Stage 3: Skipped (--skip-inference)")

    # ── Stage 4: Causal attribution + Prescriptions ──────────────────────────
    if not args.skip_report:
        log.info("Stage 4: Causal attribution + Prescriptions...")
        from causal.attribution import run_all as r1
        from prescriptions.spatial_prescriber import run_all as r2

        try:
            r1()
            log.info("  [OK] Attribution + report_context")
        except Exception as e:
            log.error("  [FAIL] Attribution: %s", e)

        try:
            r2()
            log.info("  [OK] Prescriptions")
        except Exception as e:
            log.error("  [FAIL] Prescriptions: %s", e)
    else:
        log.info("Stage 4: Skipped (--skip-report)")

    # ── Stage 5: DB Sync ─────────────────────────────────────────────────────
    if not args.skip_db:
        log.info("Stage 5: DB Sync...")
        from db.sync import sync_all

        try:
            sync_all()
            log.info("  [OK] DB sync")
        except Exception as e:
            log.warning("  ! DB sync skipped: %s", e)
    else:
        log.info("Stage 5: Skipped (--skip-db)")

    # ── Summary ──────────────────────────────────────────────────────────────
    elapsed = round(time.time() - start, 1)
    log.info("=== Pipeline complete in %ss ===", elapsed)

    output_names = [
        "predictions_output.json",
        "prescriptions_output.json",
        "anomalies_output.json",
        "carbon_output.json",
        "report_context.json",
        "eval_metrics.json",
    ]
    for fname in output_names:
        path = OUTPUT_DIR / fname
        if path.exists():
            size = f"{path.stat().st_size / 1024:.0f}KB"
        else:
            size = "MISSING"
        log.info("  %s: %s", fname, size)

    log.info("Start API: python app.py")


if __name__ == "__main__":
    main()
