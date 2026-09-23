"""
Fetches jobs from the VagasZap Supabase project filtered by category.

The Supabase table `jobs` exposes a REST endpoint via PostgREST. We use the
anon key for read-only access (table has RLS enabled but the SELECT policy
allows anon reads from the public jobs catalog).
"""
from __future__ import annotations

from typing import Any, Dict, List

import urllib.parse
import urllib.request
import json

from . import config


def _postgrest_headers() -> Dict[str, str]:
    return {
        "apikey": config.SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {config.SUPABASE_ANON_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def fetch_jobs(limit: int | None = None) -> List[Dict[str, Any]]:
    """
    Returns the most recent jobs whose `category` is one of JOB_CATEGORIES.

    Selects only the columns we need for scoring and form filling.
    """
    select_cols = (
        "id,title,company,location,salary,employment_type,"
        "application_link,summary_pt,tags,category,pub_date,pub_timestamp"
    )
    categories = ",".join(f'"{c}"' for c in config.JOB_CATEGORIES)
    params = {
        "select": select_cols,
        "category": f"in.({','.join(config.JOB_CATEGORIES)})",
        "order": "pub_timestamp.desc",
        "limit": str(limit or config.FETCH_LIMIT),
    }
    url = f"{config.SUPABASE_URL}/rest/v1/jobs?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers=_postgrest_headers(), method="GET")
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if not isinstance(data, list):
        raise RuntimeError(f"Unexpected Supabase response: {data!r}")
    return data


if __name__ == "__main__":
    jobs = fetch_jobs()
    print(f"Fetched {len(jobs)} jobs")
    for j in jobs[:5]:
        print(f"- [{j.get('category')}] {j.get('title')} @ {j.get('company')}")