"""
End-to-end orchestrator.

Single-round pipeline:
  1. Fetch Operations + Technology jobs from VagasZap Supabase.
  2. Score each job with the MiniMax API.
  3. Keep only jobs with match.score >= COMPAT_THRESHOLD (default 90).
  4. For each eligible job:
       - Activate Chrome (already logged in).
       - Open the job application link in a new tab.
       - Fill common fields from the English resume profile.
       - Attach Henrique_Lima_Resume_EN.pdf.
       - Click Submit (only if LIVE_SUBMIT=true).
       - VERIFY submission by snapshotting the page and looking for thank-you
         keywords + taking a screenshot.
       - Persist a full evidence record via application_tracker.

Continuous mode (LOOP_CONTINUOUS=true) repeats the above forever, pausing
LOOP_INTERVAL_IDLE seconds when no eligible jobs are found.
"""
from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Dict, List

from . import application_tracker as tracker
from . import config
from . import chrome_applescript as chrome
from . import minimax_scorer
from . import supabase_jobs
from . import greenhouse_public


# ---------------------------------------------------------------------------
# Profile snapshot (English resume fields used to fill forms)
# ---------------------------------------------------------------------------
EN_PROFILE: Dict[str, str] = {
    "first_name": "Henrique",
    "last_name": "Lima",
    "full_name": "Henrique Lima",
    "email": "henrique.souza.lima@outlook.com",
    "phone": "+5571985431158",
    "phone_display": "+55 71 98543-1158",
    "location": "São Paulo, Brazil (open to worldwide relocation)",
    "linkedin": "https://www.linkedin.com/in/limahenrique",
    "website": "https://www.henriquelima.social",
    "headline": (
        "Senior QA Engineer & Application Support Specialist — 10+ yrs, "
        "AI/automation (Python, n8n, GCP, AI Agents). Founder @ Intelektus."
    ),
    "cover_letter": (
        "Dear Hiring Team,\n\n"
        "I am Henrique Lima, a Senior QA Engineer with 10+ years in "
        "technology, currently delivering tier-1 telecom support for "
        "TELUS (Canada) and Nuuday (Denmark) at Netcracker Technology. "
        "As founder of Intelektus, I also build AI-driven automations "
        "with Python, n8n, Supabase, and LLM agents.\n\n"
        "I am immediately available for remote, hybrid, or relocation "
        "roles worldwide. Thank you for your time — I would love to "
        "discuss how my background aligns with this position.\n\n"
        "Best regards,\nHenrique Lima"
    ),
}


# ---------------------------------------------------------------------------
# Form filling (best-effort heuristics, runs against any ATS)
# ---------------------------------------------------------------------------
FORM_FIELDS = [
    ("First name", EN_PROFILE["first_name"]),
    ("First Name", EN_PROFILE["first_name"]),
    ("Given name", EN_PROFILE["first_name"]),
    ("Last name", EN_PROFILE["last_name"]),
    ("Last Name", EN_PROFILE["last_name"]),
    ("Family name", EN_PROFILE["last_name"]),
    ("Full name", EN_PROFILE["full_name"]),
    ("Full Name", EN_PROFILE["full_name"]),
    ("Name", EN_PROFILE["full_name"]),
    ("Email", EN_PROFILE["email"]),
    ("E-mail", EN_PROFILE["email"]),
    ("Phone", EN_PROFILE["phone_display"]),
    ("Phone number", EN_PROFILE["phone_display"]),
    ("Mobile", EN_PROFILE["phone_display"]),
    ("Location", EN_PROFILE["location"]),
    ("City", "São Paulo"),
    ("Country", "Brazil"),
    ("LinkedIn", EN_PROFILE["linkedin"]),
    ("LinkedIn URL", EN_PROFILE["linkedin"]),
    ("Website", EN_PROFILE["website"]),
    ("Portfolio", EN_PROFILE["website"]),
    ("Headline", EN_PROFILE["headline"]),
    ("Summary", EN_PROFILE["headline"]),
    ("Cover letter", EN_PROFILE["cover_letter"]),
    ("Cover Letter", EN_PROFILE["cover_letter"]),
    ("Message to hiring team", EN_PROFILE["cover_letter"]),
]


def fill_application_form(record: Dict[str, Any]) -> List[str]:
    """
    Fills every recognised field on the active tab and appends a per-field log
    to `record["form_log"]`. Returns the human-readable lines for stdout.
    """
    results: List[str] = []
    for label, value in FORM_FIELDS:
        try:
            status = chrome.fill_by_label(label, value)
        except RuntimeError as exc:
            status = f"ERROR:{exc}"
        results.append(f"{label:>26} -> {status}")
        record["form_log"].append({"label": label, "status": status})
    try:
        attach_status = chrome.attach_resume(config.RESUME_PDF_PATH)
    except RuntimeError as exc:
        attach_status = f"ERROR:{exc}"
    results.append(f"{'RESUME_PDF_ATTACH':>26} -> {attach_status}")
    record["form_log"].append({"label": "RESUME_PDF_ATTACH", "status": attach_status})
    return results


# ---------------------------------------------------------------------------
# Post-submit verification
# ---------------------------------------------------------------------------
def verify_submission(record: Dict[str, Any], screenshots_dir: Path) -> Dict[str, Any]:
    """
    After clicking Submit, wait for navigation, snapshot the page, look for
    confirmation keywords, and capture a screenshot. Populates
    record["evidence"] in-place and returns a small summary dict.
    """
    summary = {"verified": False, "method": None, "keywords": []}

    pre_url = record["evidence"].get("post_submit_url")
    post_url = chrome.wait_for_navigation(timeout_s=15)
    record["evidence"]["post_submit_url"] = post_url or pre_url

    snap = chrome.snapshot_page()
    record["evidence"]["post_submit_title"] = snap.get("title")

    keywords = chrome.detect_thank_you(snap)
    record["evidence"]["confirmation_keywords_found"] = keywords
    summary["keywords"] = keywords

    # The URL changing away from the form page is itself a strong signal.
    url_changed = bool(pre_url and post_url and pre_url != post_url)
    has_keywords = bool(keywords)

    if url_changed or has_keywords:
        summary["verified"] = True
        summary["method"] = (
            "url_changed+keywords" if url_changed and has_keywords
            else "url_changed" if url_changed
            else "keywords_in_text"
        )
        record["evidence"]["thank_you_url"] = post_url

    # Screenshot (best-effort). Saved under screenshots/<job_id>.png
    try:
        safe_id = (record.get("job_id") or record.get("id") or "unknown").replace("/", "_")
        shot_path = screenshots_dir / f"{safe_id}.png"
        if chrome.take_screenshot(shot_path):
            record["evidence"]["screenshot_path"] = str(shot_path)
    except Exception as exc:  # noqa: BLE001
        record["errors"].append(f"screenshot_failed:{exc}")

    return summary


# ---------------------------------------------------------------------------
# One round
# ---------------------------------------------------------------------------
def run_once(records: List[Dict[str, Any]]) -> int:
    """
    Runs a single round. Returns the number of applications submitted this
    round so the caller can decide how long to sleep before the next round.
    """
    print(f"\n--- Round @ {time.strftime('%H:%M:%S')} ---")
    already = tracker.already_applied_ids(records)

    print("[1/4] Fetching jobs from Supabase + Greenhouse ...")
    jobs: List[Dict[str, Any]] = []
    try:
        jobs.extend(supabase_jobs.fetch_jobs())
    except Exception as exc:  # noqa: BLE001
        print(f"      supabase fetch error: {exc}")
    try:
        jobs.extend(greenhouse_public.fetch_jobs(limit=config.FETCH_LIMIT))
    except Exception as exc:  # noqa: BLE001
        print(f"      greenhouse fetch error: {exc}")
    if not jobs:
        print("      no jobs fetched from any source")
        return 0
    jobs = [j for j in jobs if j.get("id") not in already]
    print(f"      Got {len(jobs)} new jobs (filtered {len(already)} already applied)")
    if not jobs:
        return 0

    print("[2/4] Scoring compatibility via MiniMax ...")
    scored = minimax_scorer.batch_score(jobs)
    tracker.save_history(config.MATCH_RESULTS_FILE, scored)

    eligible = [j for j in scored if j["match"]["score"] >= config.COMPAT_THRESHOLD]
    eligible.sort(key=lambda x: x["match"]["score"], reverse=True)
    print(f"      {len(eligible)} jobs above threshold ({config.COMPAT_THRESHOLD}%)")
    if not eligible:
        return 0

    print("[3/4] Opening browser (already logged in) ...")
    try:
        chrome.activate_browser()
    except RuntimeError as exc:
        print(f"      Could not activate browser: {exc}")
        return 0

    screenshots_dir = config.PROJECT_ROOT / "screenshots"
    to_apply = eligible[: config.MAX_APPLIES]
    print(f"[4/4] Applying to {len(to_apply)} jobs ...")
    applied_this_round = 0
    for idx, job in enumerate(to_apply, 1):
        url = job.get("application_link")
        if not url:
            print(f"  [{idx}] SKIP (no link): {job.get('title')}")
            continue

        record = tracker.new_record(job)
        record["live_submit"] = config.LIVE_SUBMIT
        record["evidence"]["post_submit_url"] = url
        print(f"\n  [{idx}/{len(to_apply)}] score={job['match']['score']} "
              f"— {job.get('title')} @ {job.get('company')}")

        try:
            chrome.open_url(url, new_tab=True)
            if not chrome.wait_for_load(timeout_s=30):
                tracker.mark_failed(record, "page_did_not_load_in_30s")
                records.append(record)
                tracker.save_history(config.APPLIED_HISTORY_FILE, records)
                print("       page did not finish loading in 30s — skipping")
                continue
            time.sleep(2.0)
            log = fill_application_form(record)
            for line in log:
                print(f"       {line}")

            if config.LIVE_SUBMIT:
                record["submit_result"] = chrome.click_submit()
                print(f"       SUBMIT -> {record['submit_result']}")

                # ---- Verification (this is what gives us certainty) ----
                verification = verify_submission(record, screenshots_dir)
                if verification["verified"]:
                    tracker.mark_submitted(record)
                    print(f"       VERIFIED ({verification['method']}): "
                          f"{record['evidence'].get('post_submit_url')}")
                    if verification["keywords"]:
                        print(f"       keywords: {', '.join(verification['keywords'][:3])}")
                else:
                    tracker.mark_needs_review(
                        record,
                        "submit_clicked_but_no_confirmation_detected",
                    )
                    print("       UNVERIFIED — no thank-you page detected. "
                          "Flagged for manual review.")
            else:
                tracker.mark_dry_run(record)
                print("       DRY-RUN (LIVE_SUBMIT=false) — not clicking Submit")

            records.append(record)
            tracker.save_history(config.APPLIED_HISTORY_FILE, records)
            applied_this_round += 1
            time.sleep(3.0)
        except RuntimeError as exc:
            tracker.mark_failed(record, f"runtime_error:{exc}")
            records.append(record)
            tracker.save_history(config.APPLIED_HISTORY_FILE, records)
            print(f"       ERROR: {exc}")
            continue
    return applied_this_round


def run() -> None:
    print("=== Vagas Compatibility Automation ===")
    print(f"Threshold: {config.COMPAT_THRESHOLD}% | "
          f"Categories: {config.JOB_CATEGORIES} | "
          f"Live submit: {config.LIVE_SUBMIT} | "
          f"Loop: {config.LOOP_CONTINUOUS}")
    records = tracker.load_history(config.APPLIED_HISTORY_FILE)
    print(f"Already applied: {len(records)} jobs")
    print(f"Status breakdown: {tracker.summary(records)}")

    if not config.LOOP_CONTINUOUS:
        run_once(records)
        _print_final_summary(records)
        print("\n=== Single run complete. ===")
        return

    round_idx = 0
    try:
        while True:
            round_idx += 1
            print(f"\n========== ROUND {round_idx} ==========")
            count = run_once(records)
            wait = config.LOOP_INTERVAL_AFTER_APPLY if count > 0 \
                else config.LOOP_INTERVAL_IDLE
            print(f"\nRound {round_idx}: {count} applied. "
                  f"Sleeping {wait}s until next round ...")
            time.sleep(wait)
    except KeyboardInterrupt:
        print("\n=== Stopped by user. ===")
        tracker.save_history(config.APPLIED_HISTORY_FILE, records)
        _print_final_summary(records)


def _print_final_summary(records: List[Dict[str, Any]]) -> None:
    print("\n=== Final summary ===")
    for status, count in tracker.summary(records).items():
        print(f"  {status:>22}: {count}")
    needs_review = [r for r in records if r.get("status") == "needs_manual_review"]
    if needs_review:
        print("\nNeeds manual review:")
        for r in needs_review:
            print(f"  - {r.get('company')} | {r.get('title')} | {r.get('url')}")


if __name__ == "__main__":
    run()
