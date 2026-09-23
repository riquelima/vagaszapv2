#!/usr/bin/env python3
"""
População Massiva de Vagas no Supabase.
Himalayas foi removido: portal intermediário sem suporte direto a Auto-Apply no Greenhouse.
"""
import urllib.request
import json
import re
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "https://ffxpsothavxbrdhshtoj.supabase.co")
SUPABASE_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmeHBzb3RoYXZ4YnJkaHNodG9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwODMxNzUsImV4cCI6MjEwNTY1OTE3NX0.kSHFcIGN8l0GZz4lHrNHJHo87_3gAvXKtobneTrQ43A")
MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", "sk-cp-meaN0PHZdGi3-5gZffia9b6PyDIh27vyk54LwG6gw965dFLWoIHowFo19rTqoHdbxhaQezJlMMBgTEYhNni51sJnMWCcPHIKtCg4GRY-pGMmrXarNIxxGQA")

def clean_html(text):
    if not text: return ""
    clean = re.sub(r"<[^>]*>", " ", text)
    return " ".join(clean.split())[:1200]

def generate_summary(title, company, category, desc):
    try:
        sys_prompt = "Você é um especialista em recrutamento. Resuma a vaga em 2 ou 3 frases curtas, diretas e atraentes em português destacando o objetivo principal, tecnologias e modalidade remota. NÃO inclua saudações nem títulos."
        user_prompt = f"Vaga: {title}\nEmpresa: {company}\nCategoria: {category}\nDescrição:\n{desc[:1000]}"
        req = urllib.request.Request(
            "https://api.minimaxi.chat/v1/text/chatcompletion_v2",
            headers={"Authorization": f"Bearer {MINIMAX_API_KEY}", "Content-Type": "application/json"},
            data=json.dumps({
                "model": "MiniMax-M2.5",
                "messages": [
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "temperature": 0.3,
                "max_tokens": 200
            }).encode("utf-8")
        )
        with urllib.request.urlopen(req, timeout=9) as resp:
            data = json.loads(resp.read().decode())
            res = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
            if res and len(res) > 25:
                return res
    except Exception:
        pass

    if category == "tech":
        return f"Excelente oportunidade para atuar como {title} na equipe de {company}. Posição 100% remota com foco em desenvolvimento, boas práticas de engenharia e projetos de escala global."
    else:
        return f"Oportunidade internacional de {title} junto à empresa {company}. Atuação 100% remota focada em excelência de atendimento, processos operacionais e suporte contínuo ao cliente em inglês."

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
    """Coleta vagas oficiais via API pública do Ashby."""
    url = f"https://api.ashbyhq.com/posting-api/job-board/{org}"
    headers = {'User-Agent': 'Mozilla/5.0'}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            return json.loads(resp.read().decode()).get("jobs", [])
    except Exception:
        return []

def is_blocked_url(url):
    """Bloqueia qualquer URL de portal intermediário (Himalayas, etc.)."""
    if not url:
        return True
    blocked = ['himalayas.app', 'himalayas.com']
    return any(b in url.lower() for b in blocked)

def classify_gh_job(job):
    """Classifica uma vaga ATS em tech/operations com base no título."""
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

def process_single_job(j, category, now):
    # Greenhouse: absolute_url | Ashby: applyUrl | Fallback: id
    guid = j.get('absolute_url') or j.get('applyUrl') or j.get('id')
    if not guid or is_blocked_url(guid):
        return None
    jid = f"gh-{category[:3]}-{abs(hash(guid)) % 10000000}"
    title = j.get('title', 'Remote Position')
    company_loc = j.get('location', {})
    company = (company_loc.get('name') if isinstance(company_loc, dict) else company_loc) or j.get('company_name') or 'Global Company'
    loc = (company_loc.get('name') if isinstance(company_loc, dict) else company_loc) or 'Worldwide (100% Remoto)'
    desc = clean_html(j.get('content') or j.get('description') or '')
    pub_ts = j.get('updated_at') or now

    summary = generate_summary(title, company, category, desc)

    if category == "tech":
        tags = ["Tech & IA", "Greenhouse Oficial", "Remoto Worldwide"]
    else:
        tags = ["Operações", "Greenhouse Oficial", "Remoto Worldwide"]

    return {
        "id": jid,
        "title": title,
        "company": company,
        "company_logo": None,
        "location": f"{loc} (100% Remoto)",
        "salary": "A combinar ($ USD / Anual)",
        "employment_type": "Full-time (Remoto)",
        "pub_date": time.strftime("%d/%m/%Y", time.gmtime(pub_ts)),
        "pub_timestamp": int(pub_ts),
        "application_link": guid,
        "summary_pt": summary,
        "tags": tags,
        "category": category
    }

def main():
    print("Iniciando busca massiva de vagas (somente ATS oficiais: Greenhouse + Ashby)...")
    now = int(time.time())

    # ── Fontes oficiais: Greenhouse + Ashby (Himalayas removido) ──
    gh_boards = ["canonical", "gitlab", "cloudflare", "elastic", "remotecom", "brex", "datadog"]
    ashby_orgs = ["perplexity", "elevenlabs", "cursor", "replit", "synthesia"]

    all_raw_tech = []
    all_raw_ops = []

    print(f"Buscando vagas de {len(gh_boards)} boards Greenhouse e {len(ashby_orgs)} orgs Ashby...")

    with ThreadPoolExecutor(max_workers=6) as executor:
        futures_gh = {executor.submit(fetch_greenhouse_jobs, b): b for b in gh_boards}
        for f in as_completed(futures_gh):
            for j in f.result():
                cat = classify_gh_job(j)
                (all_raw_tech if cat == "tech" else all_raw_ops).append(j)

        futures_ashby = {executor.submit(fetch_ashby_jobs, o): o for o in ashby_orgs}
        for f in as_completed(futures_ashby):
            for j in f.result():
                cat = classify_gh_job(j)
                (all_raw_tech if cat == "tech" else all_raw_ops).append(j)

    print(f"Total bruto capturado: {len(all_raw_tech)} Tech, {len(all_raw_ops)} Ops")

    seen_guids = set()
    unique_tech = []
    for j in all_raw_tech:
        k = j.get('absolute_url') or j.get('applyUrl') or j.get('id')
        if k and k not in seen_guids and not is_blocked_url(k):
            seen_guids.add(k)
            unique_tech.append(j)

    unique_ops = []
    for j in all_raw_ops:
        k = j.get('absolute_url') or j.get('applyUrl') or j.get('id')
        if k and k not in seen_guids and not is_blocked_url(k):
            seen_guids.add(k)
            unique_ops.append(j)

    print(f"Vagas únicas selecionadas: {len(unique_tech)} Tech, {len(unique_ops)} Ops (Total: {len(unique_tech) + len(unique_ops)})")

    target_tech = unique_tech[:100]
    target_ops = unique_ops[:100]

    processed_jobs = []
    print("Gerando resumos inteligentes e estruturando registros em paralelo (12 threads)...")

    tasks = [(j, "tech") for j in target_tech] + [(j, "operations") for j in target_ops]

    with ThreadPoolExecutor(max_workers=12) as executor:
        futures = [executor.submit(process_single_job, j, cat, now) for j, cat in tasks]
        for f in as_completed(futures):
            result = f.result()
            if result is not None:
                processed_jobs.append(result)

    print(f"Processamento concluído: {len(processed_jobs)} vagas prontas para upsert.")

    batch_size = 50
    total_synced = 0
    for i in range(0, len(processed_jobs), batch_size):
        chunk = processed_jobs[i:i+batch_size]
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/jobs",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates"
            },
            data=json.dumps(chunk).encode("utf-8")
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                total_synced += len(chunk)
                print(f"Batch {i//batch_size + 1}: {len(chunk)} vagas sincronizadas (Status: {resp.status}).")
        except Exception as e:
            print(f"Erro no batch {i//batch_size + 1}: {e}")

    catalog_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'jobs_catalog.json')
    try:
        existing = []
        if os.path.exists(catalog_path):
            with open(catalog_path, 'r', encoding='utf-8') as f:
                existing = json.load(f)
        
        merged_dict = {j['id']: j for j in existing}
        for j in processed_jobs:
            merged_dict[j['id']] = {
                "id": j["id"],
                "title": j["title"],
                "company": j["company"],
                "companyLogo": j["company_logo"],
                "location": j["location"],
                "salary": j["salary"],
                "employmentType": j["employment_type"],
                "pubDate": j["pub_date"],
                "pubTimestamp": j["pub_timestamp"],
                "applicationLink": j["application_link"],
                "summary": j["summary_pt"],
                "tags": j["tags"],
                "category": j["category"]
            }
        with open(catalog_path, 'w', encoding='utf-8') as f:
            json.dump(list(merged_dict.values()), f, ensure_ascii=False, indent=2)
        print(f"Cache local atualizado com {len(merged_dict)} vagas.")
    except Exception as e:
        print(f"Erro ao atualizar cache local: {e}")

    print(f"População massiva concluída com sucesso! Total sincronizado no Supabase: {total_synced} vagas.")

if __name__ == '__main__':
    main()
