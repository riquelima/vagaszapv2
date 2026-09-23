"""
Standalone pipeline test: fetch + score + filter.

Runs the same data pipeline as runner.py but does NOT touch Chrome. Useful
for verifying that the scoring/threshold logic is working correctly.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from vagas_compat_automation import config, minimax_scorer, supabase_jobs


def main() -> None:
    print("=== Pipeline Test (no Chrome) ===")
    print(f"Threshold: {config.COMPAT_THRESHOLD}%")
    print(f"Categories: {config.JOB_CATEGORIES}")
    print(f"Fetch limit: {config.FETCH_LIMIT}")

    print("\n[1] Fetching jobs from Supabase ...")
    jobs = supabase_jobs.fetch_jobs()
    print(f"    Got {len(jobs)} jobs")
    if not jobs:
        return

    print("\n[2] Scoring with MiniMax ...")
    scored = minimax_scorer.batch_score(jobs)

    print("\n[3] Saving full results to match_results.json ...")
    Path(config.MATCH_RESULTS_FILE).write_text(
        json.dumps(scored, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    eligible = [j for j in scored if j["match"]["score"] >= config.COMPAT_THRESHOLD]
    eligible.sort(key=lambda x: x["match"]["score"], reverse=True)

    print(f"\n[4] Jobs above threshold ({config.COMPAT_THRESHOLD}%): {len(eligible)}")
    for j in eligible:
        m = j["match"]
        print(
            f"  - score={m['score']:>3} | {j.get('title', '')[:55]:<55} "
            f"@ {j.get('company', '')[:25]}"
        )
        print(f"      {m['reason']}")

    print("\n=== Done. ===")


if __name__ == "__main__":
    main()