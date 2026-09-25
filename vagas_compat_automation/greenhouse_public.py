"""
Fetches jobs from Greenhouse's PUBLIC Job Board API.

Greenhouse exposes a read-only JSON endpoint per board:
    https://boards-api.greenhouse.io/v1/boards/<board_token>/jobs?content=true

This module merges those jobs into the same shape used by supabase_jobs.fetch_jobs()
so the scorer / runner can treat both sources uniformly.

Public API requires NO auth. `content=true` returns the full description.
"""
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from typing import Any, Dict, List

from . import config


# Well-known boards with strong Operations presence. You can extend this list
# (or set GREENHOUSE_BOARDS in .env to a comma-separated list).
DEFAULT_BOARDS = [
    "stripe",
    "airbnb",
    "cloudflare",
    "datadog",
    "discord",
    "doordash",
    "brex",
    "figma",
    "vercel",
    "scaleai",
    "openai",
    "anthropic",
    "ramp",
    "linear",
    "retool",
    "plaid",
    "snowflake",
    "netflix",
]


def _configured_boards() -> List[str]:
    raw = os.environ.get("GREENHOUSE_BOARDS", "")
    if raw.strip():
        return [b.strip() for b in raw.split(",") if b.strip()]
    return DEFAULT_BOARDS


def _fetch_board(board: str) -> List[Dict[str, Any]]:
    url = f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true"
    try:
        with urllib.request.urlopen(url, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(f"[greenhouse] {board}: fetch error: {exc}")
        return []
    return data.get("jobs", []) or []


def _normalize(job: Dict[str, Any], board: str) -> Dict[str, Any]:
    """Map a Greenhouse job object into the schema used by supabase_jobs."""
    title = job.get("title") or ""
    dept = (job.get("departments") or [{}])[0].get("name") or ""
    loc = (job.get("location") or {}).get("name") or ""
    offices = job.get("offices") or []
    if offices and not loc:
        loc = ", ".join(o.get("name", "") for o in offices if o.get("name"))

    # Convert HTML content to plain text snippet for the scorer.
    content = job.get("content") or ""
    plain = _strip_html(content)

    return {
        "id": f"gh:{board}:{job.get('id')}",
        "title": title,
        "company": board.capitalize(),
        "location": loc,
        "salary": None,
        "employment_type": None,
        "application_link": job.get("absolute_url"),
        "summary_pt": plain[:4000],
        "tags": [dept] if dept else [],
        "category": _guess_category(title, dept),
        "pub_date": job.get("updated_at"),
        "pub_timestamp": job.get("updated_at"),
        "source": "greenhouse",
        "board": board,
        "raw": {"departments": [d.get("name") for d in job.get("departments", [])]},
    }


def _guess_category(title: str, dept: str) -> str:
    """Heuristic mapping so Greenhouse jobs integrate with the existing pipeline."""
    haystack = f"{title} {dept}".lower()
    ops_terms = (
        "operations", "operations manager", "ops manager", "bizops",
        "business operations", "revenue operations", "revops",
        "sales operations", "salesops", "support operations",
        "customer operations", "people operations",
    )
    tech_terms = (
        "engineer", "developer", "software", "sre", "devops",
        "data", "ml", "ai ", "platform", "infrastructure",
        "security", "qa", "test ",
    )
    if any(t in haystack for t in ops_terms):
        return "operations"
    if any(t in haystack for t in tech_terms):
        return "tech"
    # Default bucket so they still appear (you can filter later).
    return "operations"


def _strip_html(html: str) -> str:
    import re
    text = re.sub(r"<[^>]+>", " ", html or "")
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def fetch_jobs(limit: int | None = None) -> List[Dict[str, Any]]:
    """Fetch from every configured board and return a normalised list."""
    all_jobs: List[Dict[str, Any]] = []
    for board in _configured_boards():
        for job in _fetch_board(board):
            all_jobs.append(_normalize(job, board))
    if limit:
        all_jobs = all_jobs[:limit]
    return all_jobs


if __name__ == "__main__":
    jobs = fetch_jobs(limit=5)
    print(f"Fetched {len(jobs)} Greenhouse jobs")
    for j in jobs:
        print(f"- [{j['category']}] {j['title']} @ {j['company']} | {j['location']}")