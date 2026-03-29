# BHOOMI — settings.py

import os
import logging
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# ── 2. Project root ───────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parent.parent

# ── 3. Raw data directory (CSVs live alongside app.py) ─────────────────────────
RAW_DATA_DIR = PROJECT_ROOT

# ── 4. Output directories (created automatically) ─────────────────────────────
PROCESSED_DATA_DIR = PROJECT_ROOT / "data" / "processed"
MODEL_SAVE_DIR = PROJECT_ROOT / "models" / "saved"
OUTPUT_DIR = PROJECT_ROOT / "output"

PROCESSED_DATA_DIR.mkdir(parents=True, exist_ok=True)
MODEL_SAVE_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ── 5. Database URL ───────────────────────────────────────────────────────────
_db_host = os.getenv("DO_DB_HOST")
_db_port = os.getenv("DO_DB_PORT")
_db_name = os.getenv("DO_DB_NAME")
_db_user = os.getenv("DO_DB_USER")
_db_pass = os.getenv("DO_DB_PASSWORD")

if all([_db_host, _db_port, _db_name, _db_user, _db_pass]):
    DATABASE_URL = (
        f"postgresql://{_db_user}:{_db_pass}@{_db_host}:{_db_port}/{_db_name}"
        "?sslmode=require"
    )
else:
    DATABASE_URL = None
    logging.warning("Database env vars incomplete — DATABASE_URL is None")

# ── 6. LLM configuration ─────────────────────────────────────────────────────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
NVIDIA_NIM_API_KEY = os.getenv("NVIDIA_NIM_API_KEY")
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "gemini")
LLM_AVAILABLE = bool(GEMINI_API_KEY or NVIDIA_NIM_API_KEY)

# ── 7. Logging ────────────────────────────────────────────────────────────────
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)


# ── 8. Validate settings ─────────────────────────────────────────────────────
def validate_settings() -> bool:
    logger = logging.getLogger(__name__)

    for name, path in [
        ("PROCESSED_DATA_DIR", PROCESSED_DATA_DIR),
        ("MODEL_SAVE_DIR", MODEL_SAVE_DIR),
        ("OUTPUT_DIR", OUTPUT_DIR),
    ]:
        if not path.exists():
            logger.warning("Directory missing: %s (%s)", name, path)

    logger.info("LLM available: %s via %s", LLM_AVAILABLE, LLM_PROVIDER)
    return True
