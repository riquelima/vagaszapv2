"""
Vagas Compatibility Automation - Configuration loader.

Loads environment variables from .env (or process env) and exposes them as
typed constants used throughout the project.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import List


PROJECT_ROOT = Path(__file__).resolve().parent
ENV_FILE = PROJECT_ROOT / ".env"


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv(ENV_FILE)


def _bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    try:
        return int(raw) if raw not in (None, "") else default
    except ValueError:
        return default


def _list(name: str, default: List[str]) -> List[str]:
    raw = os.environ.get(name, "")
    if not raw:
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


# --- Browser ----------------------------------------------------------------
BROWSER_NAME: str = os.environ.get("BROWSER_NAME", "Brave Browser").strip() \
    or "Brave Browser"

# --- API / Models -----------------------------------------------------------
MINIMAX_API_KEY: str = os.environ.get("MINIMAX_API_KEY", "")
MINIMAX_MODEL: str = os.environ.get("MINIMAX_MODEL", "MiniMax-M3")
MINIMAX_API_URL: str = os.environ.get(
    "MINIMAX_API_URL",
    "https://api.minimax.io/v1/chat/completions",
)

# --- Supabase ---------------------------------------------------------------
SUPABASE_URL: str = os.environ.get(
    "SUPABASE_URL",
    "https://ffxpsothavxbrdhshtoj.supabase.co",
)
SUPABASE_ANON_KEY: str = os.environ.get(
    "SUPABASE_ANON_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJl"
    "ZiI6ImZmeHBzb3RoYXZ4YnJkaHNodG9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAw"
    "ODMxNzUsImV4cCI6MjEwNTY1OTE3NX0.kSHFcIGN8l0GZz4lHrNHJHo87_3gAvXKto"
    "bneTrQ43A",
)

# --- Job selection ----------------------------------------------------------
COMPAT_THRESHOLD: int = _int("COMPAT_THRESHOLD", 90)
MAX_APPLIES: int = _int("MAX_APPLIES", 10)
JOB_CATEGORIES: List[str] = _list("JOB_CATEGORIES", ["tech", "operations"])
FETCH_LIMIT: int = _int("FETCH_LIMIT", 80)
LIVE_SUBMIT: bool = _bool("LIVE_SUBMIT", False)

# --- Loop -------------------------------------------------------------------
LOOP_CONTINUOUS: bool = _bool("LOOP_CONTINUOUS", True)
LOOP_INTERVAL_IDLE: int = _int("LOOP_INTERVAL_IDLE", 120)
LOOP_INTERVAL_AFTER_APPLY: int = _int("LOOP_INTERVAL_AFTER_APPLY", 60)

# --- Local persistence ------------------------------------------------------
APPLIED_HISTORY_FILE: Path = PROJECT_ROOT / "applied_jobs.json"
MATCH_RESULTS_FILE: Path = PROJECT_ROOT / "match_results.json"

# --- Resume -----------------------------------------------------------------
RESUME_PDF_PATH: Path = Path(
    os.environ.get(
        "RESUME_PDF_PATH",
        str(PROJECT_ROOT.parent / "Henrique_Lima_Resume_EN.pdf"),
    )
)