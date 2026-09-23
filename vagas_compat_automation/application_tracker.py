"""
Application tracker: persists every apply attempt with explicit evidence so we
can later verify, with certainty, whether a job was actually submitted.

Each record contains:
  - identity:        job_id, title, company, url
  - scoring:         score (0-100)
  - timing:          applied_at, finished_at, duration_s
  - status:          submitted | failed | needs_manual_review | dry_run
  - evidence:        thank_you_url, post_submit_title, screenshot_path,
                     http_status, response_snippet, network_evidence
  - form_log:        per-field fill results (which fields were OK / not found)
  - errors:          list of human-readable error strings

The file format is a JSON array of these records. Writes are atomic (write to
.tmp then rename) so a crash mid-write never corrupts history.
"""
from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Atomic JSON helpers
# ---------------------------------------------------------------------------
def load_history(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        # Corrupted file -> back it up and start fresh instead of crashing.
        backup = path.with_suffix(f".corrupted.{int(time.time())}.json")
        try:
            path.rename(backup)
            print(f"[tracker] WARN: corrupted history moved to {backup.name}")
        except OSError:
            pass
        return []


def save_history(path: Path, records: List[Dict[str, Any]]) -> None:
    """Atomic write: .tmp then rename, so a crash never leaves a half-file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(records, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    os.replace(tmp, path)


# ---------------------------------------------------------------------------
# Record factory
# ---------------------------------------------------------------------------
def new_record(job: Dict[str, Any]) -> Dict[str, Any]:
    """Create a blank application record seeded with job metadata."""
    return {
        "id": str(uuid.uuid4()),
        "job_id": job.get("id"),
        "title": job.get("title"),
        "company": job.get("company"),
        "url": job.get("application_link"),
        "category": job.get("category"),
        "score": (job.get("match") or {}).get("score"),
        "score_reason": (job.get("match") or {}).get("reason"),
        "status": "pending",          # pending | submitted | failed | needs_manual_review | dry_run
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "finished_at": None,
        "duration_s": None,
        "evidence": {
            "thank_you_url": None,
            "post_submit_url": None,
            "post_submit_title": None,
            "screenshot_path": None,
            "http_status": None,
            "response_snippet": None,
            "confirmation_keywords_found": [],
        },
        "form_log": [],
        "submit_result": None,        # raw string returned by chrome.click_submit()
        "errors": [],
        "live_submit": False,
    }


# ---------------------------------------------------------------------------
# Convenience mutators (keep runner.py readable)
# ---------------------------------------------------------------------------
def mark_submitted(record: Dict[str, Any]) -> None:
    record["status"] = "submitted"
    _finish(record)


def mark_failed(record: Dict[str, Any], reason: str) -> None:
    record["status"] = "failed"
    if reason:
        record["errors"].append(reason)
    _finish(record)


def mark_needs_review(record: Dict[str, Any], reason: str) -> None:
    record["status"] = "needs_manual_review"
    if reason:
        record["errors"].append(reason)
    _finish(record)


def mark_dry_run(record: Dict[str, Any]) -> None:
    record["status"] = "dry_run"
    _finish(record)


def _finish(record: Dict[str, Any]) -> None:
    record["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    try:
        started = time.mktime(time.strptime(record["started_at"], "%Y-%m-%dT%H:%M:%S"))
        record["duration_s"] = round(time.time() - started, 2)
    except (KeyError, ValueError):
        record["duration_s"] = None


# ---------------------------------------------------------------------------
# Stats / query helpers
# ---------------------------------------------------------------------------
def summary(records: List[Dict[str, Any]]) -> Dict[str, int]:
    """Aggregate counters grouped by status."""
    counts: Dict[str, int] = {}
    for r in records:
        s = r.get("status", "unknown")
        counts[s] = counts.get(s, 0) + 1
    return counts


def already_applied_ids(records: List[Dict[str, Any]]) -> set:
    """IDs of every job that reached a terminal state (submitted or failed)."""
    return {
        r["job_id"]
        for r in records
        if r.get("status") in {"submitted", "failed", "needs_manual_review", "dry_run"}
        and r.get("job_id")
    }
