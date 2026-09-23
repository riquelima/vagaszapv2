#!/usr/bin/env python3
"""
Daily Automated Sync Script: VagasZap -> Supabase
Busca novas vagas em fontes ATS oficiais (Greenhouse + Ashby) e gera resumos em português com MiniMax.
Himalayas foi removido: portal intermediário sem suporte direto a Auto-Apply no Greenhouse.
Pode ser executado diariamente via cron ou agendamento no n8n.
"""

import urllib.request
import json
import re
import os
import time

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "https://ffxpsothavxbrdhshtoj.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmeHBzb3RoYXZ4YnJkaHNodG9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwODMxNzUsImV4cCI6MjEwNTY1OTE3NX0.kSHFcIGN8l0GZz4lHrNHJHo87_3gAvXKtobneTrQ43A")
MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", "sk-cp-meaN0PHZdGi3-5gZffia9b6PyDIh27vyk54LwG6gw965dFLWoIHowFo19rTqoHdbxhaQezJlMMBgTEYhNni51sJnMWCcPHIKtCg4GRY-pGMmrXarNIxxGQA")

def ask_minimax(system_prompt, user_prompt):
    try:
        req = urllib.request.Request(
            "https://api.minimaxi.chat/v1/text/chatcompletion_v2",
            headers={"Authorization": f"Bearer {MINIMAX_API_KEY}", "Content-Type": "application/json"},
            data=json.dumps({
                "model": "MiniMax-M2.5",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "temperature": 0.3,
                "max_tokens": 250
            }).encode("utf-8")
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode())
            return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        return ""

def clean_html(text):
    if not text: return ""
    clean = re.sub(r"<[^>]*>", " ", text)
    return " ".join(clean.split())[:1200]

def fetch_greenhouse_jobs(board):
    """Coleta vagas oficiais via API pública do Greenhouse (sem intermediários)."""
    url = f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs"
    headers = {'User-Agent': 'Mozilla/5.0'}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            return json.loads(resp.read().decode()).get("jobs", [])
    except Exception:
        return []

def fetch_ashby_jobs(org):
    """Coleta vagas oficiais via API pública do Ashby (sem intermediários)."""
    url = f"https://api.ashbyhq.com/posting-api/job-board/{org}"
    headers = {'User-Agent': 'Mozilla/5.0'}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            return json.loads(resp.read().decode()).get("jobs", [])
    except Exception:
        return []

def is_blocked_url(url):
    """Filtra qualquer URL de portal intermediário (Himalayas, etc.)."""
    if not url:
        return True
    blocked = ['himalayas.app', 'himalayas.com']
    return any(b in url.lower() for b in blocked)

def classify_gh_job(job):
    """Classifica uma vaga do Greenhouse em tech/operations com base no título."""
    title = (job.get("title") or "").lower()
    tech_kw = ["engineer", "developer", "qa", "test", "automation", "python",
               "full-stack", "backend", "frontend", "infrastructure", "devops",
               "ai", "machine learning", "data", "software", "architect", "security",
               "sre", "platform", "cloud"]
    ops_kw = ["support", "customer", "success", "care", "operations", "specialist",
              "coordinator", "assistant", "intake", "client", "analyst", "onboarding",
              "compliance", "administrative", "associate"]
    if any(k in title for k in tech_kw):
        return "tech"
    if any(k in title for k in ops_kw):
        return "operations"
    return "tech"

def run_daily_sync():
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Iniciando sincronização diária de vagas no Supabase (somente ATS oficiais)...")
    now = int(time.time())

    # ── Fontes oficiais: Greenhouse + Ashby ──
    gh_boards = ["canonical", "gitlab", "cloudflare", "elastic", "remotecom", "brex", "datadog"]
    ashby_orgs = ["perplexity", "elevenlabs", "cursor", "replit", "synthesia"]

    raw_tech = []
    raw_ops = []
    for b in gh_boards:
        for j in fetch_greenhouse_jobs(b):
            cat = classify_gh_job(j)
            (raw_tech if cat == "tech" else raw_ops).append(j)
    for o in ashby_orgs:
        for j in fetch_ashby_jobs(o):
            cat = classify_gh_job(j)
            (raw_tech if cat == "tech" else raw_ops).append(j)

    # Process Tech
    tech_sys = "Você é um especialista em recrutamento tech. Sua única tarefa é resumir a vaga em 2 ou 3 frases curtas, diretas e atrativas em português para WhatsApp, destacando responsabilidades e ferramentas essenciais. NÃO inclua saudações, NÃO repita o título da vaga nem use títulos ou cabeçalhos em negrito. Comece direto com o texto do resumo."
    ops_sys = "Você é um especialista em recrutamento para vagas operacionais, suporte e posições de entrada (júnior/assistente). Sua única tarefa é resumir a vaga em 2 ou 3 frases curtas, simples e diretas em português para WhatsApp, destacando o que a pessoa fará no dia a dia (atendimento, suporte, tarefas administrativas ou moderação), requisitos básicos e benefícios/remuneração. NÃO inclua saudações, NÃO repita o título da vaga nem use formatação em negrito para subtítulos. Comece direto com o texto do resumo."

    jobs_to_upsert = []

    seen = set()
    for j in raw_tech[:15]:
        # Greenhouse: id + absolute_url | Ashby: id + applyUrl
        guid = j.get("absolute_url") or j.get("applyUrl") or j.get("id")
        if not guid or guid in seen: continue
        if is_blocked_url(guid): continue
        seen.add(guid)
        title = j.get("title", "Remote Position")
        company_loc = j.get("location", {})
        company = j.get("company_name") or (company_loc.get("name") if isinstance(company_loc, dict) else "Global Company") or "Global Company"
        loc = (company_loc.get("name") if isinstance(company_loc, dict) else company_loc) or "Worldwide (100% Remoto)"
        jid = f"gh-tech-{abs(hash(guid)) % 1000000}"
        desc = clean_html(j.get("content") or j.get("description") or "")
        prompt = f"Resuma esta vaga em português (máximo 2 a 3 frases curtas e diretas):\n\nVaga: {title}\nEmpresa: {company}\nDescrição:\n{desc}"
        summary = ask_minimax(tech_sys, prompt) or f"Oportunidade tech 100% remota na {company} com foco em desenvolvimento e inovação."

        jobs_to_upsert.append({
            "id": jid,
            "title": title,
            "company": company,
            "location": f"{loc} (100% Remoto)",
            "salary": "A combinar ($ USD / Anual)",
            "employment_type": "Full-time (Remoto)",
            "pub_date": time.strftime("%d/%m/%Y", time.gmtime(now)),
            "pub_timestamp": now,
            "application_link": guid,
            "summary_pt": summary,
            "tags": ["Tech & IA", "Greenhouse Oficial", "Remoto USD"],
            "category": "tech"
        })

    for j in raw_ops[:15]:
        guid = j.get("absolute_url") or j.get("applyUrl") or j.get("id")
        if not guid or guid in seen: continue
        if is_blocked_url(guid): continue
        seen.add(guid)
        title = j.get("title", "Remote Position")
        company_loc = j.get("location", {})
        company = j.get("company_name") or (company_loc.get("name") if isinstance(company_loc, dict) else "Global Company") or "Global Company"
        loc = (company_loc.get("name") if isinstance(company_loc, dict) else company_loc) or "Worldwide (100% Remoto)"
        jid = f"gh-ops-{abs(hash(guid)) % 1000000}"
        desc = clean_html(j.get("content") or j.get("description") or "")
        prompt = f"Resuma esta vaga júnior/operacional em português (máximo 2 a 3 frases curtas e diretas):\n\nVaga: {title}\nEmpresa: {company}\nDescrição:\n{desc}"
        summary = ask_minimax(ops_sys, prompt) or f"Oportunidade operacional 100% remota na {company} com foco em suporte e processos."

        jobs_to_upsert.append({
            "id": jid,
            "title": title,
            "company": company,
            "location": f"{loc} (100% Remoto)",
            "salary": "A combinar ($ USD / Anual)",
            "employment_type": "Full-time (Remoto)",
            "pub_date": time.strftime("%d/%m/%Y", time.gmtime(now)),
            "pub_timestamp": now,
            "application_link": guid,
            "summary_pt": summary,
            "tags": ["Operações", "Greenhouse Oficial", "Remoto USD"],
            "category": "operations"
        })

    # Upsert no Supabase
    if jobs_to_upsert:
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/jobs",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates"
            },
            data=json.dumps(jobs_to_upsert).encode("utf-8")
        )
        with urllib.request.urlopen(req) as resp:
            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Concluído com sucesso! {len(jobs_to_upsert)} vagas sincronizadas no Supabase (Status: {resp.status}).")

if __name__ == '__main__':
    run_daily_sync()
