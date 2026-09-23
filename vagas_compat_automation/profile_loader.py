"""
Compact English profile used both as context for the MiniMax scorer and as
the source of truth for filling application forms.

Loaded from henrique_master_profile.json (curated profile in this repo).
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

ROOT = Path(__file__).resolve().parent.parent
PROFILE_PATH = ROOT / "henrique_master_profile.json"


def load_profile() -> Dict[str, Any]:
    if not PROFILE_PATH.exists():
        raise FileNotFoundError(f"Profile not found at {PROFILE_PATH}")
    return json.loads(PROFILE_PATH.read_text(encoding="utf-8"))


def profile_for_scoring() -> str:
    """Returns a single, dense text block describing the candidate in English."""
    p = load_profile()
    cand = p["candidate"]
    summary = p["personal_summary"]["text"]
    skills = ", ".join(p["skills_list"])
    target_roles = ", ".join(p.get("job_preferences", {}).get(
        "classification_of_interest", ["Engineering", "QA"]))
    return (
        f"Name: {cand['full_name']}\n"
        f"Location: {cand['location_current']} (relocation: "
        f"{cand.get('relocation_readiness', '')})\n"
        f"Work models: {', '.join(cand.get('work_models', []))}\n"
        f"Target roles: {target_roles}\n"
        f"Years of experience: 10+ (5+ QA, 3 Python, 2 n8n, 4 automation)\n"
        f"Summary:\n{summary}\n"
        f"Key skills:\n{skills}\n"
    )