"""
Compatibility scorer that calls the MiniMax API.

Each job (title + summary + tags) is sent together with the candidate's
English profile. The model returns a strict JSON object with:

    {"score": 0..100, "reason": "...", "matched_skills": [...], "missing": [...]}

Jobs with score >= COMPAT_THRESHOLD are flagged as eligible.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Any, Dict, List

from . import config
from .profile_loader import profile_for_scoring


SYSTEM_PROMPT = (
    "You are a strict technical recruiter evaluating how well a candidate's "
    "profile matches a remote job posting. You must reply with ONLY a JSON "
    "object — no prose, no markdown fences."
)

USER_TEMPLATE = """Candidate profile (English):
{profile}

Job posting:
- Title: {title}
- Company: {company}
- Category: {category}
- Location: {location}
- Employment: {employment_type}
- Salary: {salary}
- Tags: {tags}
- Description (Portuguese summary): {summary}

Score the match from 0 to 100 where:
  - 100 = perfect fit, candidate is overqualified and meets every requirement
  - 90-99 = excellent fit, all critical skills present
  - 70-89 = partial fit, some gaps but acceptable
  - <70 = poor fit, missing core competencies

Consider especially: years of relevant experience, primary tech stack overlap,
role family (QA / Automation / AI / Support-Ops / Customer Success), and
relocation or language requirements.

Reply with EXACTLY this JSON shape:
{{"score": <integer 0..100>, "reason": "<one short sentence>", "matched_skills": [<strings>], "missing": [<strings>]}}
"""


def _build_payload(job: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "model": config.MINIMAX_MODEL,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": USER_TEMPLATE.format(
                    profile=profile_for_scoring(),
                    title=job.get("title", ""),
                    company=job.get("company", ""),
                    category=job.get("category", ""),
                    location=job.get("location", ""),
                    employment_type=job.get("employment_type", ""),
                    salary=job.get("salary", ""),
                    tags=", ".join(job.get("tags") or []),
                    summary=(job.get("summary_pt") or "")[:1500],
                ),
            },
        ],
    }


_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


def _parse_score(raw_text: str) -> Dict[str, Any]:
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        m = _JSON_RE.search(raw_text)
        if not m:
            raise
        return json.loads(m.group(0))


def score_job(job: Dict[str, Any]) -> Dict[str, Any]:
    """Calls MiniMax API and returns the parsed scoring dict."""
    if not config.MINIMAX_API_KEY:
        raise RuntimeError(
            "MINIMAX_API_KEY is not set. Add it to .env before scoring jobs."
        )

    payload = _build_payload(job)
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        config.MINIMAX_API_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {config.MINIMAX_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            response = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"MiniMax API HTTP {exc.code}: {err_body}") from exc

    message = response["choices"][0]["message"]["content"]
    parsed = _parse_score(message)
    parsed["score"] = max(0, min(100, int(parsed.get("score", 0))))
    parsed.setdefault("reason", "")
    parsed.setdefault("matched_skills", [])
    parsed.setdefault("missing", [])
    return parsed


def batch_score(jobs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Scores each job sequentially and returns a list of dicts:
        {**job, "match": {score, reason, matched_skills, missing}}
    """
    results: List[Dict[str, Any]] = []
    for idx, job in enumerate(jobs, 1):
        try:
            match = score_job(job)
        except Exception as exc:  # noqa: BLE001
            print(f"[{idx}/{len(jobs)}] ERROR scoring {job.get('id')}: {exc}")
            continue
        merged = dict(job)
        merged["match"] = match
        results.append(merged)
        print(
            f"[{idx}/{len(jobs)}] score={match['score']:>3} "
            f"cat={job.get('category')} | {job.get('title', '')[:60]}"
        )
    return results