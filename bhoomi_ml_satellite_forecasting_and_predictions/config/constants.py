# BHOOMI — constants.py

# ── 1. Grid and geography ──────────────────────────────────────────────────────
GRID_SIZE_KM = 3.0
DEG_PER_KM_LAT = 1 / 111.0
DEG_PER_KM_LNG = 1 / 102.1  # at ~23°N (Ahmedabad latitude)
HALF_GRID_LAT = (GRID_SIZE_KM / 2) * DEG_PER_KM_LAT
HALF_GRID_LNG = (GRID_SIZE_KM / 2) * DEG_PER_KM_LNG

# ── 2. City configurations ─────────────────────────────────────────────────────
CITY_CONFIGS = {
    "GJ_AHM": {
        "name": "Ahmedabad",
        "state": "Gujarat",
        "bbox": {"north": 23.15, "south": 22.90, "east": 72.75, "west": 72.45},
    }
}

# ── 3. Metric ranges — (min, max) for valid physical values ────────────────────
METRIC_RANGES = {
    "lst_celsius": (10, 65),
    "data_quality": (0, 1),
    "no2_ugm3": (0, 500),
    "so2_ugm3": (0, 400),
    "co_ugm3": (0, 15000),
    "aqi_proxy": (0, 500),
    "ndvi": (-0.1, 0.9),
    "vci": (0, 1),
    "tci": (0, 1),
    "vhi": (0, 1),
    "wind_speed_ms": (0, 35),
    "wind_dir_deg": (0, 360),
    "temp_celsius": (5, 55),
    "u_ms": (-30, 30),
    "v_ms": (-30, 30),
    "soil_moisture": (0, 0.6),
    "soil_moisture_deficit": (-0.5, 0.5),
    "spi_30d": (-3, 3),
    "rainfall_mm": (0, 300),
    "drought_risk": (0, 1),
    "dominant_class_pct": (0, 100),
    "water_pct": (0, 100),
    "trees_pct": (0, 100),
    "built_pct": (0, 100),
    "bare_pct": (0, 100),
    "crops_pct": (0, 100),
    "rangeland_pct": (0, 100),
    "flooded_pct": (0, 100),
    "carbon_balance": (-1, 1),
    "composite_risk": (0, 10),
}

# ── 4. Columns to retain per raw CSV ──────────────────────────────────────────
KEEP_COLUMNS = {
    "LST": [
        "grid_id", "centroid_lat", "centroid_lng", "captured_at",
        "lst_celsius", "data_quality",
    ],
    "Pollution": [
        "grid_id", "centroid_lat", "centroid_lng", "captured_at",
        "no2_ugm3", "so2_ugm3", "co_ugm3", "aqi_proxy",
    ],
    "Vegetation": [
        "grid_id", "centroid_lat", "centroid_lng", "captured_at",
        "ndvi", "vci", "tci", "vhi",
    ],
    "LULC": [
        "grid_id", "centroid_lat", "centroid_lng", "snapshot_date",
        "dominant_class", "dominant_class_pct", "water_pct", "trees_pct",
        "flooded_pct", "crops_pct", "built_pct", "bare_pct", "rangeland_pct",
    ],
    "Weather": [
        "grid_id", "centroid_lat", "centroid_lng", "captured_at",
        "wind_speed_ms", "wind_dir_deg", "temp_celsius", "u_ms", "v_ms",
    ],
    "Drought": [
        "grid_id", "centroid_lat", "centroid_lng", "captured_at",
        "soil_moisture", "soil_moisture_deficit", "spi_30d",
        "rainfall_mm", "drought_risk",
    ],
}

# ── 5. Forecast horizons ──────────────────────────────────────────────────────
FORECAST_HORIZONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 30, 90, 180]
HORIZON_LABELS = {
    1: "1d", 2: "2d", 3: "3d", 4: "4d", 5: "5d",
    6: "6d", 7: "7d", 8: "8d", 9: "9d", 10: "10d",
    30: "30d", 90: "90d", 180: "180d",
}

# ── 6. Training parameters ────────────────────────────────────────────────────
TRAINING_SPLIT_RATIO = 0.85
# OLD: MIN_TRAIN_ROWS=90, MIN_TEST_ROWS=30
MIN_TRAIN_ROWS = 30
MIN_TEST_ROWS = 10
IMPUTATION_MAX_GAP_DAYS = 7

# ── 7. Causal thresholds ──────────────────────────────────────────────────────
CAUSAL_THRESHOLDS = {
    "aqi_high": 150,
    "aqi_critical": 250,
    "no2_high": 80,
    "so2_high": 60,
    "co_high": 5000,
    "ndvi_critical": 0.15,
    "vhi_drought": 0.25,
    "lst_high": 42.0,
    "lst_anomaly_high": 2.0,
    "wind_min_ms": 2.5,
    "upwind_radius_km": 15.0,
    "upwind_cone_deg": 30.0,
    "neighbour_radius_km": 4.5,
    "composite_risk_high": 4.0,
    "anomaly_threshold": -0.15,
    "carbon_source_threshold": 0.1,
}

# ── 8. Prescription types ─────────────────────────────────────────────────────
PRESCRIPTION_TYPES = [
    "green_buffer",
    "plantation_patch",
    "cooling_corridor",
    "drought_recharge",
    "windbreak",
    "agri_protection",
    "industrial_setback",
]

# ── 9. Anomaly features ───────────────────────────────────────────────────────
ANOMALY_FEATURES = [
    "aqi_proxy", "lst_celsius", "ndvi", "drought_risk", "soil_moisture",
]

# ── 10. Report parameters ─────────────────────────────────────────────────────
REPORT_LOOKBACK_YEARS = 2
REPORT_FORECAST_DAYS = 365
