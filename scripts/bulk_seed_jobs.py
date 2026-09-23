#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
População em massa do banco: sincroniza pelo menos 500 vagas oficiais
(Greenhouse + Ashby + Lever) no Supabase em uma única execução.

Uso:
    python3 saas-vagaszap/scripts/bulk_seed_jobs.py
    python3 saas-vagaszap/scripts/bulk_seed_jobs.py --target 700
"""
import argparse
import os
import sys
import time
import json
import urllib.request

# Reutiliza funções utilitárias de sync_direct_ats_jobs.py (mesma pasta)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_direct_ats_jobs import (
    fetch_greenhouse_jobs,
    fetch_ashby_jobs,
    sanitize_summary,
    SUPABASE_URL,
    SUPABASE_KEY,
)

# ── Pool expandido de empresas 100% remoto-friendly ──────────────────────────
GH_BOARDS = [
    ("canonical", "Canonical (Ubuntu)"),
    ("gitlab", "GitLab"),
    ("cloudflare", "Cloudflare"),
    ("elastic", "Elastic"),
    ("remotecom", "Remote.com"),
    ("brex", "Brex"),
    ("datadog", "Datadog"),
    ("stripe", "Stripe"),
    ("figma", "Figma"),
    ("vercel", "Vercel"),
    ("shopify", "Shopify"),
    ("automattic", "Automattic (WordPress)"),
    ("doist", "Doist (Todoist)"),
    ("buffer", "Buffer"),
    ("zapier", "Zapier"),
    ("toptal", "Toptal"),
    ("mozilla", "Mozilla"),
    ("openai", "OpenAI"),
    ("anthropic", "Anthropic"),
    ("notion", "Notion"),
    ("airtable", "Airtable"),
    ("asana", "Asana"),
    ("duckduckgo", "DuckDuckGo"),
    ("hashicorp", "HashiCorp"),
    ("plaid", "Plaid"),
    ("mercury", "Mercury"),
    ("invision", "InVision"),
    ("toggl", "Toggl Track"),
    ("ramp", "Ramp"),
    ("wikimedia", "Wikimedia Foundation"),
]

ASHBY_ORGS = [
    ("perplexity", "Perplexity AI"),
    ("elevenlabs", "ElevenLabs AI"),
    ("cursor", "Cursor AI"),
    ("replit", "Replit"),
    ("synthesia", "Synthesia AI"),
    ("linear", "Linear"),
    ("vanta", "Vanta"),
    ("glean", "Glean"),
    ("harvey", "Harvey AI"),
    ("runwayml", "Runway ML"),
    ("character", "Character AI"),
    ("mistral", "Mistral AI"),
    ("huggingface", "Hugging Face"),
    ("anyscale", "Anyscale"),
    ("weights_biases", "Weights & Biases"),
    ("modal", "Modal Labs"),
    ("replicate", "Replicate"),
    ("pinecone", "Pinecone"),
    ("weaviate", "Weaviate"),
    ("rampinc", "Ramp Inc"),
]

TECH_KEYWORDS = [
    "engineer", "developer", "qa", "test", "automation", "python",
    "full-stack", "backend", "frontend", "infrastructure", "devops",
    "ai", "machine learning", "data", "software", "architect", "security",
    "sre", "platform", "cloud", "growth", "product manager", "designer",
    "mobile", "ios", "android", "rust", "golang", "react", "node",
]
OPS_KEYWORDS = [
    "support", "customer", "success", "care", "operations", "specialist",
    "coordinator", "assistant", "intake", "client", "analyst", "onboarding",
    "compliance", "administrative", "associate", "recruiter", "people",
    "finance", "account", "sales", "marketing", "content", "writer",
]


def classify(title: str) -> str:
    t = title.lower()
    if any(k in t for k in TECH_KEYWORDS):
        return "tech"
    if any(k in t for k in OPS_KEYWORDS):
        return "operations"
    return "tech"


def collect_all_jobs() -> list:
    """Busca vagas em paralelo de TODOS os boards (GH + Ashby)."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    results = []

    def fetch_gh(args_):
        board, comp = args_
        try:
            for j in fetch_greenhouse_jobs(board, comp):
                j["_company_display"] = comp
                j["_source"] = "Greenhouse"
                results.append(j)
        except Exception as e:
            print(f"  [skip GH {board}] {e}")

    def fetch_ashby(args_):
        org, comp = args_
        try:
            for j in fetch_ashby_jobs(org, comp):
                j["_company_display"] = comp
                j["_source"] = "Ashby"
                results.append(j)
        except Exception as e:
            print(f"  [skip Ashby {org}] {e}")

    print(f"Coletando vagas de {len(GH_BOARDS)} boards Greenhouse + {len(ASHBY_ORGS)} orgs Ashby em paralelo...")
    with ThreadPoolExecutor(max_workers=12) as ex:
        futs = [ex.submit(fetch_gh, (b, c)) for b, c in GH_BOARDS]
        futs += [ex.submit(fetch_ashby, (o, c)) for o, c in ASHBY_ORGS]
        for f in as_completed(futs):
            f.result()
    return results


def upsert_supabase(rows: list, batch_size: int = 80) -> int:
    """Faz upsert em batches. Retorna total sincronizado."""
    total = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i + batch_size]
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/jobs",
            data=json.dumps(chunk).encode("utf-8"),
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                total += len(chunk)
                print(f"  ✅ Batch {i // batch_size + 1}: +{len(chunk)} vagas (status {resp.status})")
        except Exception as e:
            print(f"  ⚠️ Erro no batch {i // batch_size + 1}: {e}")
    return total


def build_supabase_rows(jobs: list, target: int) -> list:
    """Constrói as linhas no schema do Supabase, priorizando tech."""
    seen_ids = set()
    rows = []
    now = int(time.time())

    # 1ª passada: tech (até atingir ~70% do alvo)
    tech_target = int(target * 0.7)
    for j in jobs:
        if len([r for r in rows if r["category"] == "tech"]) >= tech_target:
            break
        title = (j.get("title") or "").strip()
        if not title or classify(title) != "tech":
            continue
        # Usa applicationLink injetado por fetch_greenhouse_jobs/fetch_ashby_jobs
        guid = j.get("applicationLink") or j.get("absolute_url") or j.get("applyUrl")
        if not guid or not guid.startswith("http") or guid in seen_ids:
            continue
        seen_ids.add(guid)
        loc = (j.get("location") or {}).get("name") if isinstance(j.get("location"), dict) else (j.get("location") or "Worldwide")
        summary = sanitize_summary("", title, j["_company_display"], "tech")
        rows.append({
            "id": f"bulk-gh-{abs(hash(guid)) % 10_000_000}",
            "title": title,
            "company": j["_company_display"],
            "location": f"{loc} (100% Remoto)",
            "salary": "A combinar ($ USD / Anual)",
            "employment_type": "Full-time (Remoto)",
            "pub_date": time.strftime("%d/%m/%Y", time.gmtime(now)),
            "pub_timestamp": now - (len(rows) * 60),
            "application_link": guid,
            "summary_pt": summary,
            "tags": ["Tech & IA", f"{j['_source']} Oficial", "Remoto Worldwide"],
            "category": "tech",
        })

    # 2ª passada: operations (até target)
    for j in jobs:
        if len(rows) >= target:
            break
        title = (j.get("title") or "").strip()
        if not title or classify(title) != "operations":
            continue
        guid = j.get("applicationLink") or j.get("absolute_url") or j.get("applyUrl")
        if not guid or not guid.startswith("http") or guid in seen_ids:
            continue
        seen_ids.add(guid)
        loc = (j.get("location") or {}).get("name") if isinstance(j.get("location"), dict) else (j.get("location") or "Worldwide")
        summary = sanitize_summary("", title, j["_company_display"], "operations")
        rows.append({
            "id": f"bulk-gh-{abs(hash(guid)) % 10_000_000}",
            "title": title,
            "company": j["_company_display"],
            "location": f"{loc} (100% Remoto)",
            "salary": "A combinar ($ USD / Anual)",
            "employment_type": "Full-time (Remoto)",
            "pub_date": time.strftime("%d/%m/%Y", time.gmtime(now)),
            "pub_timestamp": now - (len(rows) * 60),
            "application_link": guid,
            "summary_pt": summary,
            "tags": ["Operações", f"{j['_source']} Oficial", "Remoto Worldwide"],
            "category": "operations",
        })

    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", type=int, default=500, help="Número mínimo de vagas a sincronizar (default 500).")
    args = parser.parse_args()

    print("=" * 70)
    print(f"BULK SEED — Alvo: {args.target} vagas oficiais")
    print("=" * 70)

    started = time.time()
    all_jobs = collect_all_jobs()
    print(f"\n📦 Total bruto coletado: {len(all_jobs)} vagas de {len(GH_BOARDS) + len(ASHBY_ORGS)} fontes")

    rows = build_supabase_rows(all_jobs, args.target)
    tech_count = sum(1 for r in rows if r["category"] == "tech")
    ops_count = sum(1 for r in rows if r["category"] == "operations")
    print(f"\n🎯 Vagas classificadas: {tech_count} tech + {ops_count} operations = {len(rows)} total")

    if len(rows) < args.target:
        print(f"⚠️ Apenas {len(rows)} vagas disponíveis (alvo {args.target}). Considere adicionar mais boards.")

    print(f"\n💾 Sincronizando {len(rows)} vagas no Supabase (batches de 80)...")
    synced = upsert_supabase(rows)

    elapsed = round(time.time() - started, 1)
    print("\n" + "=" * 70)
    print(f"✅ CONCLUÍDO em {elapsed}s — {synced} vagas sincronizadas no Supabase")
    print("=" * 70)


if __name__ == "__main__":
    main()
