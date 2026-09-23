#!/usr/bin/env python3
"""
Serviço Contínuo de Sincronização de Vagas (30 minutos)
Preenche o Supabase e o SaaS com pelo menos 20 novas vagas a cada 30 minutos.
Himalayas foi removido: portal intermediário sem suporte direto a Auto-Apply no Greenhouse.
"""

import urllib.request
import json
import re
import os
import time
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "https://ffxpsothavxbrdhshtoj.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmeHBzb3RoYXZ4YnJkaHNodG9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwODMxNzUsImV4cCI6MjEwNTY1OTE3NX0.kSHFcIGN8l0GZz4lHrNHJHo87_3gAvXKtobneTrQ43A")
MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", "sk-cp-meaN0PHZdGi3-5gZffia9b6PyDIh27vyk54LwG6gw965dFLWoIHowFo19rTqoHdbxhaQezJlMMBgTEYhNni51sJnMWCcPHIKtCg4GRY-pGMmrXarNIxxGQA")

def clean_html(text):
    if not text: return ""
    clean = re.sub(r"<[^>]*>", " ", text)
    return " ".join(clean.split())[:1200]

def format_salary(job):
    min_sal = job.get("minSalary")
    max_sal = job.get("maxSalary")
    period = job.get("salaryPeriod")
    if min_sal and min_sal > 0:
        p_str = "/h" if period == "hourly" else "/ano"
        if max_sal:
            return f"${min_sal:,} - ${max_sal:,} USD{p_str}"
        return f"${min_sal:,}+ USD{p_str}"
    return "A combinar ($ USD / Remoto)"

def format_location(job):
    locs = job.get("locationRestrictions")
    if isinstance(locs, list) and len(locs) > 0:
        return ", ".join(locs[:2])
    return "Worldwide (100% Remoto)"

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
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode())
            res = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
            bad_patterns = [
                r'olá', r'como posso', r'preciso que você', r'compartilhe a descrição',
                r'não tenho acesso', r'não foi fornecid', r'fornecer os detalhes',
                r'assim que você', r'para criar o resumo', r'desculpe', r'como ia', r'como modelo de ia',
                r'como assistente', r'por favor, envie', r'insira o texto', r'infelizmente, não recebi',
                r'percebi que você não incluiu', r'você não forneceu', r'não recebi os detalhes', r'colar o texto'
            ]
            if res and len(res) > 25 and not any(re.search(p, res, re.I) for p in bad_patterns):
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

def is_today(job):
    """Filtra vagas publicadas ou atualizadas exatamente na data de hoje."""
    date_str = job.get('updated_at') or job.get('publishedAt') or job.get('first_published')
    if not date_str:
        return False # Se não tem data, ignoramos para o cron diário exigente
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        return dt.date() == now.date()
    except Exception:
        return False

def parse_date_to_ts(date_str, fallback):
    if not date_str: return fallback
    if isinstance(date_str, (int, float)): return int(date_str)
    try:
        dt = datetime.fromisoformat(str(date_str).replace("Z", "+00:00"))
        return int(dt.timestamp())
    except Exception:
        return fallback

def load_cycle_index() -> int:
    """Carrega o índice do ciclo atual para rotação de boards (anti-saturação)."""
    try:
        if os.path.exists(CYCLE_STATE_FILE):
            with open(CYCLE_STATE_FILE, "r", encoding="utf-8") as f:
                return int(json.load(f).get("cycle_index", 0))
    except Exception:
        pass
    return 0


def save_cycle_index(idx: int) -> None:
    try:
        with open(CYCLE_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump({"cycle_index": idx, "updated_at": int(time.time())}, f)
    except Exception as e:
        print(f"[aviso] Falha ao salvar cycle_index: {e}")


def run_sync_cycle():
    now_str = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now_str}] Iniciando cron diário (7am) para buscar ~100 vagas exclusivas de HOJE...")
    now = int(time.time())

    # Todos os boards oficiais conhecidos
    gh_boards = [
        "canonical", "gitlab", "cloudflare", "elastic", "remotecom", "brex",
        "datadog", "stripe", "figma", "vercel", "shopify", "automattic",
        "doist", "buffer", "zapier", "toptal", "mozilla", "openai",
        "anthropic", "notion", "asana", "hashicorp",
    ]
    ashby_orgs = [
        "perplexity", "elevenlabs", "cursor", "replit", "synthesia",
        "linear", "vanta", "glean", "harvey", "mistral", "huggingface",
        "modal", "replicate", "pinecone",
    ]

    raw_tech = []
    raw_ops = []
    for b in gh_boards:
        for j in fetch_greenhouse_jobs(b):
            if not is_today(j): continue
            cat = classify_gh_job(j)
            (raw_tech if cat == "tech" else raw_ops).append(j)
    for o in ashby_orgs:
        for j in fetch_ashby_jobs(o):
            if not is_today(j): continue
            cat = classify_gh_job(j)
            (raw_tech if cat == "tech" else raw_ops).append(j)

    # Obter IDs já existentes no Supabase para não duplicar
    existing_ids = set()
    try:
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/jobs?select=id",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            items = json.loads(resp.read().decode())
            existing_ids = {it['id'] for it in items}
    except Exception as e:
        print(f"[{now_str}] Aviso ao verificar IDs existentes: {e}")

    # Filtro: até 50 vagas de tech e 50 de ops
    selected_tech = []
    for j in raw_tech:
        guid = j.get('absolute_url') or j.get('applyUrl') or j.get('id')
        if not guid or is_blocked_url(guid): continue
        jid = f"gh-tec-{abs(hash(guid)) % 10000000}"
        if jid not in existing_ids:
            selected_tech.append(j)
            if len(selected_tech) >= 50: break

    selected_ops = []
    for j in raw_ops:
        guid = j.get('absolute_url') or j.get('applyUrl') or j.get('id')
        if not guid or is_blocked_url(guid): continue
        jid = f"gh-ope-{abs(hash(guid)) % 10000000}"
        if jid not in existing_ids:
            selected_ops.append(j)
            if len(selected_ops) >= 50: break

    print(f"[{now_str}] Selecionadas {len(selected_tech)} novas Tech e {len(selected_ops)} novas Operations DO DIA.")

    to_process = [(j, 'tech') for j in selected_tech] + [(j, 'operations') for j in selected_ops]
    processed = []

    def process_one(item, cat):
        guid = item.get('absolute_url') or item.get('applyUrl') or item.get('id')
        if is_blocked_url(guid):
            return None
        jid = f"gh-{cat[:3]}-{abs(hash(guid)) % 10000000}"
        title = item.get('title', 'Remote Position')
        company_loc = item.get('location', {})
        comp = item.get('company_name') or (company_loc.get('name') if isinstance(company_loc, dict) else 'Global Company') or 'Global Company'
        loc = (company_loc.get('name') if isinstance(company_loc, dict) else company_loc) or 'Worldwide (100% Remoto)'
        desc = clean_html(item.get('content') or item.get('description') or '')
        summary = generate_summary(title, comp, cat, desc)
        pub_ts = parse_date_to_ts(item.get("updated_at") or item.get("publishedAt") or item.get("first_published"), now)
        return {
            "id": jid,
            "title": title,
            "company": comp,
            "company_logo": None,
            "location": f"{loc} (100% Remoto)",
            "salary": "A combinar ($ USD / Anual)",
            "employment_type": "Full-time (Remoto)",
            "pub_date": time.strftime("%d/%m/%Y", time.gmtime(pub_ts)),
            "pub_timestamp": int(pub_ts),
            "application_link": guid,
            "summary_pt": summary,
            "tags": ["Tech & IA" if cat == "tech" else "Operações", "Greenhouse Oficial", "Remoto Worldwide"],
            "category": cat
        }

    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = [ex.submit(process_one, j, cat) for j, cat in to_process]
        for f in as_completed(futures):
            result = f.result()
            if result is not None:
                processed.append(result)

    # Upsert em batches de 40 (Supabase REST aceita melhor volumes moderados)
    if processed:
        BATCH_SIZE = 40
        total_sent = 0
        for i in range(0, len(processed), BATCH_SIZE):
            chunk = processed[i:i + BATCH_SIZE]
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
                with urllib.request.urlopen(req, timeout=20) as resp:
                    total_sent += len(chunk)
                    print(f"[{now_str}]   ✅ Batch {i // BATCH_SIZE + 1}: {len(chunk)} vagas (status {resp.status})")
            except Exception as e:
                print(f"[{now_str}]   ⚠️ Erro no batch {i // BATCH_SIZE + 1}: {e}")
        print(f"[{now_str}] 🎯 Total enviado neste ciclo: {total_sent} vagas (alvo: ≥20).")

    # Não precisa salvar cycle_index pois iteramos todos os boards

    # Atualizar cache local
    catalog_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'jobs_catalog.json')
    try:
        existing = []
        if os.path.exists(catalog_path):
            with open(catalog_path, 'r', encoding='utf-8') as f:
                existing = json.load(f)
        merged = {j['id']: j for j in existing}
        for j in processed:
            merged[j['id']] = {
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
            json.dump(list(merged.values()), f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[{now_str}] Erro ao atualizar cache local: {e}")

def main():
    print("Iniciando cron diário das 7am (meta: até 100 vagas de HOJE)...")
    try:
        run_sync_cycle()
    except Exception as e:
        print(f"Erro no ciclo de sincronização: {e}")
    print("Execução finalizada. O OS cron deve acionar este script amanhã as 7am.")

if __name__ == '__main__':
    main()
