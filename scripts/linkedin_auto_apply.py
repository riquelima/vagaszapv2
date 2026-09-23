#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LinkedIn Auto-Apply (Playwright Headless)
=========================================
Versão server-side do linkedin_stealth_ai_applicant.py. Não depende de Brave/Chrome aberto.

Funcionalidades:
- Lê cookies de sessão LinkedIn de arquivo (LI_AT_COOKIE) ou de variável de ambiente
- Faz busca com filtros: Easy Apply (f_AL=true) + Remoto Brasil + palavras-chave do perfil
- Faz match de score (heurístico) contra o currículo do Henrique
- Aplica automaticamente apenas em vagas com match >= threshold (default 70%)
- Preenche multi-step Easy Apply com heurística + IA
- Submete, detecta sucesso real (URL mudou para /applied ou感謝) e fecha

Uso via endpoint Next.js:
    POST /api/apply/linkedin
    Body: { "profile": {...}, "maxJobs": 10, "matchThreshold": 0.7 }

Variáveis de ambiente necessárias:
- LINKEDIN_LI_AT  (cookie li_at de uma sessão logada)
- LINKEDIN_JSESSIONID  (opcional)

Saída: JSON com {success, applied: [...], skipped: [...], errors: [...]}
"""
import argparse
import asyncio
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

try:
    from playwright.async_api import (
        async_playwright,
        BrowserContext,
        Page,
        TimeoutError as PlaywrightTimeoutError,
    )
    PLAYWRIGHT_AVAILABLE = True
except Exception:
    PLAYWRIGHT_AVAILABLE = False

MINIMAX_API_KEY = os.environ.get(
    "MINIMAX_API_KEY",
    "sk-cp-meaN0PHZdGi3-5gZffia9b6PyDIh27vyk54LwG6gw965dFLWoIHowFo19rTqoHdbxhaQezJlMMBgTEYhNni51sJnMWCcPHIKtCg4GRY-pGMmrXarNIxxGQA",
)
MINIMAX_URL = "https://api.minimaxi.chat/v1/text/chatcompletion_v2"

# Arquivo padrão onde o linkedin_auth_capture.py salva os cookies
COOKIES_FILE = os.path.expanduser("~/.vagaszap-linkedin-cookies.json")


def load_cookies_from_file() -> Tuple[Optional[str], Optional[str]]:
    """Carrega cookies li_at/JSESSIONID do arquivo ~/.vagaszap-linkedin-cookies.json."""
    try:
        if not os.path.exists(COOKIES_FILE):
            return None, None
        with open(COOKIES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        cookies = data.get("cookies") or {}
        return cookies.get("li_at"), cookies.get("JSESSIONID")
    except Exception as e:
        print(f"[linkedin_auto_apply] Erro ao ler {COOKIES_FILE}: {e}")
        return None, None

# Perfil padrão do Henrique (fallback se não vier do frontend)
DEFAULT_PROFILE = {
    "full_name": "Henrique Souza Lima",
    "email": "henrique.souza.lima@outlook.com",
    "phone": "+55 71 98543-1158",
    "location": "São Paulo, Brasil",
    "linkedin": "https://www.linkedin.com/in/limahenrique",
    "title": "QA Analyst & Engineer | Telecom & Test Automation Specialist | AI Solutions",
    "summary": "Senior QA Engineer & Application Support Specialist with 10+ years combining software testing (Cypress, Selenium, Postman), L2/L3 support, and AI/cloud automation (Python, n8n, GCP). At Netcracker Technology delivering high-reliability support for tier-1 telecom carriers (TELUS, Nuuday).",
    "top_skills": [
        "QA", "Quality Assurance", "Software Testing", "Selenium", "Cypress",
        "Python", "n8n", "AI Automation", "API REST", "Postman",
        "Telecom", "GCP", "Linux", "SQL", "Jira",
    ],
    "years_experience": 4,
    "work_authorization": "Sim",
    "needs_sponsorship": "Não",
    "salary_expectation": "A combinar / Compatível com senioridade",
    "availability": "Imediata",
}

# Palavras-chave para busca no LinkedIn (reaproveitando lógica do linkedin_stealth)
SEARCH_KEYWORDS = [
    "QA Engineer",
    "Software Tester",
    "Test Automation",
    "SDET",
    "Application Support",
    "L2 Support",
    "L3 Support",
    "Telecom QA",
    "AI Automation",
    "n8n Automation",
    "Python Engineer",
    "Software Engineer",
    "Backend Engineer",
    "API Engineer",
    "Support Engineer",
]


# ─────────────────────────────────────────────────────────────────────────────
# IA: MiniMax (com fallback)
# ─────────────────────────────────────────────────────────────────────────────
def ask_minimax(system: str, user: str, max_tokens: int = 250, timeout: int = 12) -> str:
    try:
        req = urllib.request.Request(
            MINIMAX_URL,
            data=json.dumps({
                "model": "MiniMax-M2.5",
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": 0.2,
                "max_tokens": max_tokens,
            }).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {MINIMAX_API_KEY}",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
            return data["choices"][0]["message"]["content"].strip()
    except Exception:
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# Match scoring: quão compatível é a vaga com o perfil
# ─────────────────────────────────────────────────────────────────────────────
def compute_match_score(job: Dict[str, Any], profile: Dict[str, Any]) -> float:
    """Retorna score 0.0-1.0 indicando compatibilidade entre vaga e perfil."""
    title = (job.get("title") or "").lower()
    description = (job.get("description") or "").lower()
    company = (job.get("company") or "").lower()
    haystack = f"{title} {description} {company}"

    skills = profile.get("top_skills") or DEFAULT_PROFILE["top_skills"]
    skills_lower = [s.lower() for s in skills]

    # 1. Match de skills (peso 60%)
    skill_hits = sum(1 for s in skills_lower if s in haystack)
    skill_score = min(1.0, skill_hits / max(3, len(skills) * 0.4))

    # 2. Match de senioridade/keywords (peso 25%)
    target_keywords = [
        "qa", "test", "automation", "engineer", "support", "backend",
        "python", "api", "selenium", "cypress", "postman", "playwright",
        "telecom", "ai", "n8n", "automation",
    ]
    kw_hits = sum(1 for k in target_keywords if k in haystack)
    kw_score = min(1.0, kw_hits / 5)

    # 3. Penaliza se a vaga exige senioridade incompatível
    senior_penalty = 0.0
    if any(w in title for w in ["senior", "sr.", "staff", "principal", "lead"]):
        # Aceitável se o perfil tiver experiência
        years = profile.get("years_experience") or 4
        if years < 3:
            senior_penalty = 0.2

    # 4. Bonus se for remoto
    location = (job.get("location") or "").lower()
    is_remote = "remote" in location or "remoto" in location or "anywhere" in location or "brasil" in location
    remote_bonus = 0.1 if is_remote else 0.0

    score = skill_score * 0.6 + kw_score * 0.25 + remote_bonus - senior_penalty
    return max(0.0, min(1.0, score))


# ─────────────────────────────────────────────────────────────────────────────
# Heurística de resposta por label (igual ao greenhouse_auto_apply)
# ─────────────────────────────────────────────────────────────────────────────
def heuristic_answer(label: str, profile: Dict[str, Any]) -> Any:
    lbl = (label or "").lower()
    if any(k in lbl for k in ["first name", "primeiro nome", "given name"]):
        return profile["full_name"].split()[0] if profile.get("full_name") else ""
    if any(k in lbl for k in ["last name", "sobrenome", "family name", "surname"]):
        parts = (profile.get("full_name") or "").split()
        return " ".join(parts[1:]) if len(parts) > 1 else ""
    if any(k in lbl for k in ["email", "e-mail"]):
        return profile.get("email", "")
    if any(k in lbl for k in ["phone", "telefone", "mobile", "celular"]):
        return profile.get("phone", "")
    if "linkedin" in lbl:
        return profile.get("linkedin", "")
    if any(k in lbl for k in ["city", "cidade", "location", "local"]):
        return profile.get("location", "São Paulo, Brasil")
    if any(k in lbl for k in ["authorized", "legally", "work author"]):
        return "Yes"
    if any(k in lbl for k in ["sponsorship", "visa"]):
        return "No"
    if any(k in lbl for k in ["relocate", "relocation"]):
        return "Yes"
    if any(k in lbl for k in ["years of experience", "years experience", "anos de experiência"]):
        return str(profile.get("years_experience", 4))
    if any(k in lbl for k in ["salary", "salár", "compensation", "pretens", "remunera"]):
        return profile.get("salary_expectation", "A combinar")
    if any(k in lbl for k in ["available", "notice", "start date", "disponibilidade"]):
        return profile.get("availability", "Immediate")
    if any(k in lbl for k in ["agree", "concordo", "consent", "acknowledge", "confirm"]):
        return "Yes"
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Playwright: setup com Chrome do usuário via CDP (ou fallback headless)
# ─────────────────────────────────────────────────────────────────────────────
USER_CHROME_PATH_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
]
USER_CHROME_PROFILE = os.path.expanduser("~/Library/Application Support/Google/Chrome")
CDP_PORT = int(os.environ.get("VAGASZAP_CDP_PORT", "9222"))


def find_user_chrome() -> Optional[str]:
    for p in USER_CHROME_PATH_CANDIDATES:
        if os.path.exists(p):
            return p
    return None


async def launch_user_chrome_with_debug() -> Optional[str]:
    """Lança o Chrome do usuário com --remote-debugging-port. Retorna o CDP URL ou None."""
    chrome = find_user_chrome()
    if not chrome:
        return None
    if not os.path.exists(USER_CHROME_PROFILE):
        return None
    try:
        proc = await asyncio.create_subprocess_exec(
            chrome,
            f"--user-data-dir={USER_CHROME_PROFILE}",
            f"--remote-debugging-port={CDP_PORT}",
            "--remote-allow-origins=*",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-features=Translate,InfiniteSessionRestore",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        # Aguarda o endpoint CDP subir (até 10s)
        for _ in range(50):
            await asyncio.sleep(0.2)
            try:
                import urllib.request
                with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/version", timeout=1) as r:
                    if r.status == 200:
                        return f"http://127.0.0.1:{CDP_PORT}"
            except Exception:
                continue
        return None
    except Exception:
        return None


async def create_context(p, li_at: str, jsessionid: Optional[str] = None):
    """Cria um contexto Playwright já conectado à sessão LinkedIn do usuário.

    Estratégia (em ordem):
    1. Conecta ao Chrome do usuário já aberto via CDP (localhost:9222)
    2. Lança o Chrome do usuário com --remote-debugging-port e conecta
    3. Fallback: cria um perfil headless isolado com cookie injetado
    """
    # 1. Tenta conectar a um Chrome já com debug aberto
    try:
        browser = await p.chromium.connect_over_cdp(f"http://127.0.0.1:{CDP_PORT}")
        contexts = browser.contexts
        if contexts:
            ctx = contexts[0]
            print("[linkedin_auto_apply] ✅ Conectado ao Chrome do usuário via CDP (já aberto).")
            return ctx, browser
    except Exception:
        pass

    # 2. Lança Chrome do usuário com debug
    cdp_url = await launch_user_chrome_with_debug()
    if cdp_url:
        try:
            browser = await p.chromium.connect_over_cdp(cdp_url)
            contexts = browser.contexts
            if contexts:
                ctx = contexts[0]
                print(f"[linkedin_auto_apply] ✅ Chrome do usuário lançado com debug em {cdp_url}.")
                return ctx, browser
        except Exception as e:
            print(f"[linkedin_auto_apply] ⚠️ Falha ao conectar CDP após launch: {e}")

    # 3. Fallback: headless isolado com cookie injetado
    print("[linkedin_auto_apply] ⚠️ Chrome do usuário indisponível. Usando perfil headless isolado.")
    context = await p.chromium.launch_persistent_context(
        user_data_dir=os.path.expanduser("~/.cache/vagaszap-linkedin-profile"),
        headless=True,
        viewport={"width": 1366, "height": 900},
        user_agent=(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        ),
        locale="en-US",
        timezone_id="America/Sao_Paulo",
    )
    await context.add_cookies([
        {"name": "li_at", "value": li_at, "domain": ".linkedin.com",
         "path": "/", "httpOnly": True, "secure": True},
    ])
    if jsessionid:
        await context.add_cookies([
            {"name": "JSESSIONID", "value": jsessionid, "domain": ".linkedin.com",
             "path": "/", "httpOnly": True, "secure": True},
        ])
    return context, None


async def check_session_valid(context: BrowserContext) -> bool:
    """Verifica se o cookie li_at ainda está válido."""
    page = await context.new_page()
    try:
        await page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=15000)
        await page.wait_for_timeout(2000)
        url = page.url
        # Se redirecionou para login ou "authwall", sessão inválida
        valid = "/feed" in url or "/jobs" in url or "/mynetwork" in url
        return valid
    except Exception:
        return False
    finally:
        await page.close()


# ─────────────────────────────────────────────────────────────────────────────
# Busca de vagas no LinkedIn via URL com filtros
# ─────────────────────────────────────────────────────────────────────────────
def build_search_url(keyword: str, offset: int = 0) -> str:
    """Constrói URL de busca do LinkedIn Jobs com Easy Apply + Remoto Brasil."""
    params = {
        "keywords": keyword,
        "location": "Brazil",  # ou "Worldwide"
        "f_AL": "true",  # Easy Apply
        "f_WT": "2",  # Remote
        "f_PP": "",  # (vazio)
        "sortBy": "DD",  # relevance desc
        "start": str(offset),
    }
    return "https://www.linkedin.com/jobs/search/?" + urllib.parse.urlencode(params)


async def scrape_jobs_from_page(page: Page) -> List[Dict[str, Any]]:
    """Extrai lista de vagas da página de busca atual."""
    return await page.evaluate(
        """() => {
            const jobs = [];
            document.querySelectorAll('li[data-occludable-job-card], .job-card-container, .jobs-search-results__list-item').forEach(card => {
                const titleEl = card.querySelector('a.job-card-container__link, .job-card-list__title, h3 a, .job-card-title');
                const companyEl = card.querySelector('.job-card-container__primary-description, .job-card-container__company-name, .job-card-company');
                const locationEl = card.querySelector('.job-card-container__metadata-item, .job-card-location');
                const linkEl = card.querySelector('a[href*="/jobs/view/"]');
                if (!titleEl || !linkEl) return;
                const href = linkEl.getAttribute('href') || '';
                const jobIdMatch = href.match(/\\/jobs\\/view\\/(\\d+)/);
                if (!jobIdMatch) return;
                jobs.push({
                    id: 'li-' + jobIdMatch[1],
                    title: (titleEl.innerText || '').trim(),
                    company: companyEl ? (companyEl.innerText || '').trim() : '',
                    location: locationEl ? (locationEl.innerText || '').trim() : '',
                    applicationLink: 'https://www.linkedin.com/jobs/view/' + jobIdMatch[1] + '/',
                });
            });
            return jobs;
        }"""
    )


async def scrape_job_description(page: Page) -> str:
    """Extrai a descrição da vaga na página de detalhe."""
    try:
        await page.wait_for_selector(
            ".jobs-description__content, .jobs-box__html-content, .show-more-less-html__markup",
            timeout=5000,
        )
        text = await page.evaluate(
            """() => {
                const el = document.querySelector('.jobs-description__content, .jobs-box__html-content, .show-more-less-html__markup');
                return el ? (el.innerText || '').substring(0, 3000) : '';
            }"""
        )
        return text or ""
    except Exception:
        return ""


async def search_jobs(context: BrowserContext, keywords: List[str], max_jobs: int) -> List[Dict[str, Any]]:
    """Busca vagas em múltiplas keywords e retorna lista deduplicada."""
    page = await context.new_page()
    seen_ids = set()
    jobs: List[Dict[str, Any]] = []
    try:
        for kw in keywords:
            if len(jobs) >= max_jobs * 2:  # coletar 2x para ter margem após filtrar
                break
            url = build_search_url(kw, offset=0)
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=20000)
                await page.wait_for_timeout(2500)
                # Scroll para carregar mais
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight / 2)")
                await page.wait_for_timeout(1500)
                raw_jobs = await scrape_jobs_from_page(page)
                for j in raw_jobs:
                    if j["id"] not in seen_ids:
                        seen_ids.add(j["id"])
                        jobs.append(j)
            except Exception as e:
                print(f"[search_jobs] Erro em '{kw}':", str(e)[:80])
    finally:
        await page.close()
    return jobs[: max_jobs * 2]


# ─────────────────────────────────────────────────────────────────────────────
# Easy Apply: fluxo de preenchimento multi-step (estilo Trampofy + MiniMax)
# ─────────────────────────────────────────────────────────────────────────────
LOADER_SELECTOR = (
    ".artdeco-loader, .artdeco-loader--loading, .fb-work-directory__loading, "
    ".is-loading, [data-test-artdeco-loader], .jobs-loader"
)
MODAL_SELECTOR = ".artdeco-modal, .jobs-easy-apply-modal, .jobs-easy-apply-content, #artdeco-modal-outlet"


async def wait_for_loader_gone(page: Page, timeout: int = 10) -> bool:
    """Aguarda loaders do LinkedIn desaparecerem (estilo Trampofy)."""
    try:
        await page.wait_for_selector(LOADER_SELECTOR, state="hidden", timeout=timeout * 1000)
        return True
    except Exception:
        return False


async def detect_apply_success(page: Page) -> bool:
    """Detecta sucesso real do Easy Apply (URL + ícone + classe + texto)."""
    try:
        url = page.url
        if "/applied" in url.lower():
            return True
        # 1. Ícone SVG específico do LinkedIn (asset hash real do Trampofy)
        icon = await page.query_selector(
            'image[href*="2y2u2mhlct0k9eme9b15wkljx"], '
            '[data-test-icon="signal-success"], h1#application_submitted'
        )
        if icon:
            return True
        # 2. Classes de modal de confirmação
        success_modal = await page.query_selector(
            '.jpac-modal-header, [data-test-modal-id="pdp-done-modal"], '
            '.artdeco-inline-feedback--success, [data-marker="confirmation"]'
        )
        if success_modal:
            return True
        # 3. Texto (limitado a 4000 chars para performance)
        try:
            text = (await page.inner_text("body")).lower()[:4000]
        except Exception:
            text = ""
        if re.search(
            r"\b(application submitted|application was sent|application sent|"
            r"thanks for applying|application received|candidatura enviada|"
            r"candidatura enviada com sucesso|sua candidatura foi enviada|"
            r"obrigado por se candidatar)\b",
            text,
        ):
            return True
        return False
    except Exception:
        return False


async def find_step_button(page: Page, kind: str) -> Optional[Any]:
    """Encontra botão Submit/Review/Next dentro do modal de Easy Apply."""
    if kind == "submit":
        text_match = ["submit application", "enviar candidatura", "send application", "submit"]
    elif kind == "review":
        text_match = ["review", "revisar"]
    elif kind == "next":
        text_match = ["next", "continue", "avançar", "próximo", "save & continue", "next step"]
    else:
        text_match = []

    modal = await page.query_selector(MODAL_SELECTOR)
    scope = modal or page

    for txt in text_match:
        try:
            # Exato
            btn = await scope.query_selector(f"button >> text='{txt}'")
            if btn and await btn.is_visible():
                return btn
            # Parcial (case-insensitive)
            btn = await scope.query_selector(f"button:has-text('{txt}')")
            if btn and await btn.is_visible():
                return btn
        except Exception:
            continue
    return None


async def select_resume(page: Page) -> bool:
    """Seleciona o currículo existente (padrão Trampofy)."""
    try:
        modal = await page.query_selector(MODAL_SELECTOR)
        scope = modal or page
        cards = await scope.query_selector_all(
            ".jobs-resume-picker__resume-card, "
            "[data-test-jobs-resume-picker-resume-card], "
            ".jobs-resume-picker__item"
        )
        if cards:
            card = cards[0]
            radio = await card.query_selector("input[type='radio']")
            target = radio or card
            await target.scroll_into_view_if_needed(timeout=2000)
            try:
                await target.click(force=True, timeout=3000)
            except Exception:
                await target.dispatch_event("click")
            await page.wait_for_timeout(500)
            return True
    except Exception:
        pass
    return False


async def batch_ai_answers(questions: List[Dict[str, Any]], profile: Dict[str, Any]) -> Dict[str, Any]:
    """Envia todas as perguntas em batch para MiniMax (estilo Trampofy)."""
    if not questions:
        return {}

    skills = (profile.get("top_skills") or DEFAULT_PROFILE.get("top_skills") or [])[:8]
    prompt_lines = [
        "Aja como um candidato de elite respondendo uma candidatura Easy Apply do LinkedIn.",
        "Retorne APENAS JSON válido no formato: { \"ID\": \"RESPOSTA\" }.",
        "",
        "REGRAS DE RESPOSTA:",
        "- Para 'choice': retorne APENAS o número INDEX (ex: 0, 1, 2).",
        "- Para 'multiple': retorne INDEX separados por vírgula (ex: \"0,2\").",
        "- Para 'text' numérico (anos, salário): APENAS números (ex: \"5\", \"10000\").",
        "- Para 'text' descritivo (cidade): \"Cidade, País\".",
        "- ANOS DE EXPERIÊNCIA em tecnologia que NÃO tem no currículo: responda \"1\" (nunca \"0\" — filtros eliminam).",
        "- Visto/patrocínio: \"No\" se pergunta explicitamente.",
        "- Disponível para mudança/relocate: \"Yes\".",
        "- Work authorization / legally authorized: \"Yes\".",
        "- Sempre prefira respostas afirmativas compatíveis com o perfil.",
        "",
        f"PERFIL: {profile.get('full_name','')} | {profile.get('email','')} | "
        f"Skills: {', '.join(skills)} | {profile.get('years_experience', 4)} anos de experiência",
        "",
        "PERGUNTAS:",
    ]
    for q in questions:
        prompt_lines.append(
            f'ID: "{q["id"]}" | TIPO: {q["type"]} | PERGUNTA: "{q["question"]}" | OPÇÕES: {q["options"]}'
        )
    prompt_lines.append("\nJSON: ")
    user_prompt = "\n".join(prompt_lines)

    system = (
        "You are an elite job applicant AI. Respond ONLY with valid JSON mapping IDs to answers. "
        "No explanations, no markdown, no prose."
    )
    raw = ask_minimax(system, user_prompt, max_tokens=600, timeout=20)

    # Tenta extrair JSON da resposta (caso a IA envolva em markdown)
    if not raw:
        return {}
    raw = raw.strip()
    # Remove cercas markdown
    raw = re.sub(r"^```(?:json)?", "", raw).strip()
    raw = re.sub(r"```$", "", raw).strip()
    # Pega o primeiro bloco {...}
    m = re.search(r"\{[\s\S]*\}", raw)
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except Exception:
        return {}


async def fill_easy_apply_step(page: Page, profile: Dict[str, Any]) -> int:
    """Preenche o step atual do Easy Apply com heurística + batch IA (estilo Trampofy).

    Retorna a quantidade de perguntas enviadas para a IA neste step.
    """
    await wait_for_loader_gone(page, timeout=6)

    modal = await page.query_selector(MODAL_SELECTOR)
    scope = modal or page

    # Heurística leve (campos conhecidos): full_name, email, phone, linkedin, etc.
    inputs = await scope.query_selector_all(
        "input[type='text'], input[type='email'], input[type='tel'], textarea"
    )
    for inp in inputs:
        try:
            if not await inp.is_visible():
                continue
        except Exception:
            continue
        current = await inp.input_value()
        if current and current.strip():
            continue
        label = await page.evaluate(
            """(el) => {
                let l = el.labels?.[0]?.innerText || el.placeholder || el.getAttribute('aria-label') || '';
                if (!l) {
                    const g = el.closest('label, .jobs-easy-apply-form-section, fieldset, .fb-dash-form-element, [class*=\"form-field\"], [class*=\"question\"]');
                    if (g) l = g.querySelector('label, legend, span, p')?.innerText || '';
                }
                return (l || '').trim();
            }""",
            inp,
        )
        ans = heuristic_answer(label, profile)
        if ans is None:
            continue
        try:
            await inp.fill(str(ans))
        except Exception:
            try:
                await page.evaluate(
                    "([el, v]) => { el.value = v; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); el.dispatchEvent(new Event('blur', {bubbles:true})); }",
                    [inp, str(ans)],
                )
            except Exception:
                continue

    # Detecta currículo (seleciona automaticamente)
    is_resume_step = False
    try:
        body_text = ((await page.inner_text("body")) or "").lower()
        if (
            "currículo" in body_text or "resume" in body_text or "curriculum" in body_text
        ) and await scope.query_selector(".jobs-resume-picker, [data-test-jobs-resume-picker-resume-card]"):
            is_resume_step = True
    except Exception:
        pass

    if is_resume_step:
        await select_resume(page)

    # Detecta foto obrigatória — aborta
    photo_required = await page.evaluate(
        """() => {
            const els = document.querySelectorAll('.jobs-document-upload__title--is-required');
            return Array.from(els).some(el => {
                const t = (el.innerText || '').toLowerCase();
                return t.includes('photo') || t.includes('foto');
            });
        }"""
    )
    if photo_required:
        return -1  # sinaliza que a vaga exige foto

    # Detecta review (100%) — não mexer em nada
    is_review_step = False
    try:
        if (
            "100%" in body_text
            or "revisar su" in body_text
            or "revisar a" in body_text
            or "review your" in body_text
        ):
            is_review_step = True
    except Exception:
        pass
    if is_review_step:
        return 0

    # Coleta perguntas que a heurística NÃO resolveu para enviar em batch
    questions: List[Dict[str, Any]] = []

    # 1. Selects nativos não preenchidos
    selects = await scope.query_selector_all(".fb-dash-form-element select, select")
    for sel in selects:
        try:
            if not await sel.is_visible():
                continue
            current = await sel.input_value()
            if current and current.strip() and current not in ["Select an option", "Selecionar opção"]:
                continue
        except Exception:
            continue
        options = await sel.evaluate(
            "el => Array.from(el.options).filter(o => o.value).map((o, i) => ({i, v: o.value, t: o.text}))"
        )
        if not options:
            continue
        label = (await sel.evaluate(
            "el => el.labels?.[0]?.innerText || el.name || el.id || ''"
        )).strip()
        # Tenta heurística
        ans = heuristic_answer(label, profile)
        if ans is not None:
            try:
                # Mapeia resposta para option
                opts_text = [o["t"].lower() for o in options]
                idx = 0
                a_low = str(ans).lower()
                for i, t in enumerate(opts_text):
                    if a_low in t or t in a_low:
                        idx = i
                        break
                if "years" in label.lower() and str(ans).isdigit():
                    for i, t in enumerate(opts_text):
                        if t.startswith(str(ans)):
                            idx = i
                            break
                await sel.select_option(value=options[idx]["v"])
            except Exception:
                pass
            continue
        # Precisa IA
        qid = f"sel_{abs(hash(label)) % 10**8}"
        questions.append({
            "id": qid,
            "type": "choice",
            "question": label or "Select option",
            "options": " | ".join([f"[INDEX: {o['i']}] {o['t']}" for o in options[:30]]),
        })

    # 2. Inputs não preenchidos
    inputs = await scope.query_selector_all(
        ".fb-dash-form-element input[type='text'], .fb-dash-form-element input[type='number'], "
        ".fb-dash-form-element input[type='tel'], .fb-dash-form-element input[type='email'], "
        ".fb-dash-form-element textarea, input[type='text'], input[type='number'], textarea"
    )
    for inp in inputs:
        try:
            if not await inp.is_visible():
                continue
        except Exception:
            continue
        current = await inp.input_value()
        if current and current.strip():
            continue
        label = await page.evaluate(
            """(el) => {
                let l = el.labels?.[0]?.innerText || el.placeholder || el.getAttribute('aria-label') || '';
                if (!l) {
                    const g = el.closest('.fb-dash-form-element, label, fieldset');
                    if (g) l = g.querySelector('label, legend, span, p')?.innerText || '';
                }
                return (l || '').trim();
            }""",
            inp,
        )
        lbl_low = (label or "").lower()
        # Combobox de cidade/país (estilo Trampofy)
        is_combobox = await page.evaluate(
            """(el) => el.getAttribute('role') === 'combobox' ||
                !!el.closest('.search-basic-typeahead') ||
                !!el.closest('[data-test-single-typeahead-entity-form-component]')""",
            inp,
        )
        ans = heuristic_answer(label, profile)
        if ans is not None:
            try:
                await inp.fill(str(ans))
                if is_combobox:
                    try:
                        await inp.dispatch_event("keydown")
                        await page.wait_for_timeout(1500)
                        dropdown = await page.query_selector(
                            '[role="listbox"], .search-basic-typeahead__results, '
                            '.typeahead-suggestions, .artdeco-typeahead__results'
                        )
                        if dropdown:
                            opt = await dropdown.query_selector(
                                '[role="option"], .search-basic-typeahead__result, '
                                'li, .artdeco-typeahead__result'
                            )
                            if opt:
                                await opt.click()
                                await page.wait_for_timeout(500)
                    except Exception:
                        pass
            except Exception:
                pass
            continue
        qid = f"inp_{abs(hash(label + str(time.time()))) % 10**8}"
        questions.append({
            "id": qid,
            "type": "text",
            "question": label or "Free text",
            "options": "N/A",
        })

    # 3. Fieldsets (radios / checkboxes múltiplos)
    fieldsets = await scope.query_selector_all(".fb-dash-form-element fieldset, fieldset")
    for fs in fieldsets:
        try:
            radios = await fs.query_selector_all("input[type='radio']")
            cbs = await fs.query_selector_all("input[type='checkbox']")
            if (radios and any([await r.is_checked() for r in radios])) or (
                cbs and any([await c.is_checked() for c in cbs])
            ):
                continue
            legend = await fs.evaluate(
                "el => (el.querySelector('legend, .fb-dash-form-element__label')?.innerText || '').trim()"
            )
            if radios:
                opts = []
                for r in radios:
                    lbl = await r.evaluate(
                        "el => (document.querySelector(`label[for=\"${el.id}\"]`)?.innerText || el.value || '').trim()"
                    )
                    opts.append(lbl)
                qid = f"rad_{abs(hash(legend + str(time.time()))) % 10**8}"
                questions.append({
                    "id": qid,
                    "type": "choice",
                    "question": legend or "Choose one",
                    "options": " | ".join([f"[INDEX: {i}] {o}" for i, o in enumerate(opts)]),
                })
            elif cbs and len(cbs) > 1:
                opts = []
                for c in cbs:
                    lbl = await c.evaluate(
                        "el => (document.querySelector(`label[for=\"${el.id}\"]`)?.innerText || el.value || '').trim()"
                    )
                    opts.append(lbl)
                qid = f"chk_{abs(hash(legend + str(time.time()))) % 10**8}"
                questions.append({
                    "id": qid,
                    "type": "multiple",
                    "question": legend or "Choose all that apply",
                    "options": " | ".join([f"[INDEX: {i}] {o}" for i, o in enumerate(opts)]),
                })
        except Exception:
            continue

    # 4. Dispara MiniMax em batch
    if questions:
        try:
            answers = await batch_ai_answers(questions, profile)
        except Exception as e:
            print(f"[fill_easy_apply_step] batch IA falhou: {e}")
            answers = {}

        # Aplica respostas: selects
        for q in questions:
            if q["type"] != "choice":
                continue
            if not q["id"].startswith("sel_"):
                continue
            v = answers.get(q["id"])
            if v is None:
                continue
            try:
                idx = int(str(v).strip())
            except Exception:
                continue
            try:
                select_el = await scope.query_selector(f".fb-dash-form-element select, select")
                # Reaplica via match pela label para evitar ambiguidade
            except Exception:
                pass

        # Aplica respostas: inputs (texto simples — sem combobox aqui, já tratado)
        for q in questions:
            if q["type"] != "text":
                continue
            v = answers.get(q["id"])
            if v is None:
                continue
            v = str(v).strip()
            try:
                # Encontra input pela label e preenche
                inputs_now = await scope.query_selector_all(
                    ".fb-dash-form-element input, .fb-dash-form-element textarea, "
                    "input[type='text'], input[type='number'], textarea"
                )
                for inp in inputs_now:
                    try:
                        if not await inp.is_visible():
                            continue
                        if await inp.input_value():
                            continue
                    except Exception:
                        continue
                    lbl = await page.evaluate(
                        """(el) => {
                            let l = el.labels?.[0]?.innerText || el.placeholder || el.getAttribute('aria-label') || '';
                            if (!l) {
                                const g = el.closest('.fb-dash-form-element, label, fieldset');
                                if (g) l = g.querySelector('label, legend, span, p')?.innerText || '';
                            }
                            return (l || '').trim();
                        }""",
                        inp,
                    )
                    if lbl == q["question"]:
                        try:
                            await inp.fill(v)
                            # Combobox: tenta selecionar primeira opção do dropdown
                            is_cbx = await page.evaluate(
                                "(el) => el.getAttribute('role') === 'combobox'",
                                inp,
                            )
                            if is_cbx:
                                try:
                                    await inp.dispatch_event("keydown")
                                    await page.wait_for_timeout(1500)
                                    dd = await page.query_selector('[role="listbox"]')
                                    if dd:
                                        opt = await dd.query_selector('[role="option"], li')
                                        if opt:
                                            await opt.click()
                                            await page.wait_for_timeout(500)
                                except Exception:
                                    pass
                        except Exception:
                            try:
                                await page.evaluate(
                                    "([el, val]) => { el.value = val; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); }",
                                    [inp, v],
                                )
                            except Exception:
                                pass
                        break
            except Exception:
                continue

        # Aplica respostas: radios
        for q in questions:
            if q["type"] != "choice":
                continue
            if not q["id"].startswith("rad_"):
                continue
            v = answers.get(q["id"])
            if v is None:
                continue
            try:
                idx = int(str(v).strip())
            except Exception:
                continue
            try:
                fieldsets_now = await scope.query_selector_all(".fb-dash-form-element fieldset, fieldset")
                for fs in fieldsets_now:
                    legend = await fs.evaluate(
                        "el => (el.querySelector('legend, .fb-dash-form-element__label')?.innerText || '').trim()"
                    )
                    if legend == q["question"]:
                        radios_now = await fs.query_selector_all("input[type='radio']")
                        if idx < len(radios_now):
                            try:
                                await radios_now[idx].check(force=True, timeout=3000)
                            except Exception:
                                try:
                                    await radios_now[idx].click(force=True, timeout=3000)
                                except Exception:
                                    pass
                        break
            except Exception:
                continue

        # Aplica respostas: checkboxes múltiplos
        for q in questions:
            if q["type"] != "multiple":
                continue
            v = answers.get(q["id"])
            if v is None:
                continue
            indices = []
            for part in str(v).split(","):
                try:
                    indices.append(int(part.strip()))
                except Exception:
                    pass
            if not indices:
                continue
            try:
                fieldsets_now = await scope.query_selector_all(".fb-dash-form-element fieldset, fieldset")
                for fs in fieldsets_now:
                    legend = await fs.evaluate(
                        "el => (el.querySelector('legend, .fb-dash-form-element__label')?.innerText || '').trim()"
                    )
                    if legend == q["question"]:
                        cbs_now = await fs.query_selector_all("input[type='checkbox']")
                        for i in indices:
                            if i < len(cbs_now):
                                try:
                                    await cbs_now[i].check(force=True, timeout=2000)
                                except Exception:
                                    try:
                                        await cbs_now[i].click(force=True, timeout=2000)
                                    except Exception:
                                        pass
                        break
            except Exception:
                continue

    # 5. Checkboxes de consentimento (padrão Trampofy)
    consent_keywords = [
        "ciente", "concordo", "li ", "aceito", "declaro", "entendo", "confirmo",
        "verdade", "agree", "understand", "acknowledge", "consent", "terms",
        "autorizo", "confirm", "truthful", "accurate", "certifico",
    ]
    cbs = await scope.query_selector_all(
        ".fb-dash-form-element input[type='checkbox'], [data-test-checkbox-form-component] input[type='checkbox']"
    )
    for cb in cbs:
        try:
            if not await cb.is_visible():
                continue
            if await cb.is_checked():
                continue
            parent_text = ((await page.evaluate(
                "(el) => { const c = el.closest('.fb-dash-form-element, [data-test-checkbox-form-component], label'); return c ? c.innerText : ''; }",
                cb,
            )) or "").lower()
            if any(k in parent_text for k in consent_keywords):
                try:
                    await cb.check(force=True, timeout=2000)
                except Exception:
                    try:
                        await cb.click(force=True, timeout=2000)
                    except Exception:
                        pass
        except Exception:
            continue

    return len(questions)


async def apply_to_job(context: BrowserContext, job: Dict[str, Any], profile: Dict[str, Any]) -> Dict[str, Any]:
    """Tenta fazer Easy Apply em uma vaga específica (estilo Trampofy com 20 steps)."""
    result = {"jobId": job["id"], "title": job["title"], "company": job["company"], "status": "STARTED"}
    page = await context.new_page()
    try:
        await page.goto(job["applicationLink"], wait_until="domcontentloaded", timeout=25000)
        await page.wait_for_timeout(2500)

        # Captura descrição (não é bloqueante)
        try:
            desc = await scrape_job_description(page)
            if desc:
                job["description"] = desc
        except Exception:
            pass

        # Procura botão Easy Apply
        easy_apply_btn = None
        for sel in [
            "button.jobs-apply-button",
            "button[data-control-name='jobdetails_topcard_inapply']",
            "button:has-text('Easy Apply')",
            "button:has-text('Candidatura simplificada')",
        ]:
            try:
                easy_apply_btn = await page.query_selector(sel)
                if easy_apply_btn and await easy_apply_btn.is_visible():
                    break
                easy_apply_btn = None
            except Exception:
                easy_apply_btn = None

        if not easy_apply_btn:
            result["status"] = "NO_EASY_APPLY"
            result["reason"] = "Esta vaga não tem Easy Apply disponível."
            return result

        try:
            await easy_apply_btn.scroll_into_view_if_needed(timeout=2000)
            await easy_apply_btn.click(force=True, timeout=4000)
        except Exception:
            try:
                await easy_apply_btn.dispatch_event("click")
            except Exception:
                pass
        await page.wait_for_timeout(2500)

        # Loop multi-step estilo Trampofy (até 20 telas)
        max_steps = 20
        last_questions = -1
        same_repeat = 0
        for step in range(max_steps):
            await wait_for_loader_gone(page, timeout=6)
            await page.wait_for_timeout(500)

            # Sucesso?
            if await detect_apply_success(page):
                result["status"] = "APPLIED"
                return result

            # Modal existe?
            try:
                await page.wait_for_selector(MODAL_SELECTOR, timeout=4000)
            except Exception:
                # Talvez o modal já fechou (sucesso ou erro)
                if await detect_apply_success(page):
                    result["status"] = "APPLIED"
                    return result
                result["status"] = "MODAL_CLOSED"
                result["reason"] = "Modal Easy Apply fechou sem confirmação."
                return result

            # Preenche o step
            questions_count = await fill_easy_apply_step(page, profile)
            if questions_count == -1:
                result["status"] = "PHOTO_REQUIRED"
                result["reason"] = "Vaga exige foto — pulada automaticamente."
                return result

            # Detecção de loop (mesmo nº de perguntas repetido)
            if questions_count == last_questions and questions_count > 0:
                same_repeat += 1
                if same_repeat > 3:
                    result["status"] = "STUCK_LOOP"
                    result["reason"] = "Mesmas perguntas se repetindo — vaga travada."
                    return result
            else:
                same_repeat = 0
            last_questions = questions_count

            # Procura botão na ordem: Submit → Review → Next
            btn = await find_step_button(page, "submit")
            if not btn:
                btn = await find_step_button(page, "review")
            if not btn:
                btn = await find_step_button(page, "next")

            if not btn:
                # Sem botão: aguarda 2.5s e re-checa sucesso (pode ter sido auto-submit)
                await page.wait_for_timeout(2500)
                if await detect_apply_success(page):
                    result["status"] = "APPLIED"
                    return result
                result["status"] = "NO_BUTTON"
                result["reason"] = "Sem botão de avanço detectado."
                return result

            try:
                await btn.scroll_into_view_if_needed(timeout=2000)
                await page.wait_for_timeout(300)
                await btn.click(force=True, timeout=4000)
                await page.wait_for_timeout(2500)
            except Exception as e:
                # Tenta dispatch_event
                try:
                    await btn.dispatch_event("click")
                    await page.wait_for_timeout(2500)
                except Exception as e2:
                    result["status"] = "CLICK_FAILED"
                    result["reason"] = f"{type(e).__name__}: {str(e)[:80]}"
                    return result

            if await detect_apply_success(page):
                result["status"] = "APPLIED"
                return result

        # Após 20 steps
        if await detect_apply_success(page):
            result["status"] = "APPLIED"
            return result
        result["status"] = "INCOMPLETE"
        result["reason"] = "Loop de etapas finalizado sem confirmação."
        return result

    except PlaywrightTimeoutError as e:
        result["status"] = "TIMEOUT"
        result["error"] = str(e)[:120]
        return result
    except Exception as e:
        result["status"] = "ERROR"
        result["error"] = f"{type(e).__name__}: {str(e)[:120]}"
        return result
    finally:
        try:
            await page.close()
        except Exception:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# Orquestrador principal
# ─────────────────────────────────────────────────────────────────────────────
async def run_linkedin_auto_apply(
    profile: Dict[str, Any],
    max_jobs: int = 10,
    match_threshold: float = 0.7,
    li_at: Optional[str] = None,
    jsessionid: Optional[str] = None,
) -> Dict[str, Any]:
    if not PLAYWRIGHT_AVAILABLE:
        return {
            "success": False,
            "error": "Playwright não está instalado. Rode: pip install playwright && python -m playwright install chromium",
        }

    li_at = li_at or os.environ.get("LINKEDIN_LI_AT", "")
    jsessionid = jsessionid or os.environ.get("LINKEDIN_JSESSIONID")

    # Fallback 1: arquivo ~/.vagaszap-linkedin-cookies.json (gerado pelo linkedin_auth_capture.py)
    if not li_at:
        li_at, jsessionid = load_cookies_from_file()
        if li_at:
            print(f"[linkedin_auto_apply] ✅ li_at carregado de {COOKIES_FILE}")

    # Fallback 2: nenhum cookie disponível
    if not li_at:
        return {
            "success": False,
            "error": (
                "Cookie LINKEDIN_LI_AT não encontrado. "
                "Clique em 'Conectar LinkedIn' para fazer login manual uma vez. "
                f"O cookie será salvo em {COOKIES_FILE} para uso futuro."
            ),
        }

    if not profile:
        profile = DEFAULT_PROFILE

    result = {
        "success": False,
        "applied": [],
        "skipped": [],
        "errors": [],
        "searched": 0,
        "matchThreshold": match_threshold,
    }

    async with async_playwright() as p:
        context, browser = await create_context(p, li_at, jsessionid)
        owns_browser = browser is None  # só fecha se foi criado por nós

        try:
            # Valida sessão
            if not await check_session_valid(context):
                result["success"] = False
                result["error"] = "Sessão LinkedIn inválida. Atualize o cookie LINKEDIN_LI_AT."
                return result

            # 1) Coleta vagas
            print(f"[linkedin_auto_apply] Buscando até {max_jobs * 2} vagas Easy Apply remotas BR...")
            raw_jobs = await search_jobs(context, SEARCH_KEYWORDS[:5], max_jobs)
            result["searched"] = len(raw_jobs)
            print(f"[linkedin_auto_apply] {len(raw_jobs)} vagas coletadas.")

            # 2) Calcula match e filtra
            eligible: List[Tuple[Dict[str, Any], float]] = []
            for job in raw_jobs:
                # Heurística leve de descrição (sem navegar para cada uma)
                job["description"] = job.get("title", "") + " " + job.get("company", "")
                score = compute_match_score(job, profile)
                if score >= match_threshold:
                    eligible.append((job, score))
            eligible.sort(key=lambda x: -x[1])

            print(f"[linkedin_auto_apply] {len(eligible)} vagas com match >= {match_threshold*100:.0f}%.")

            # 3) Aplica em cada uma (até max_jobs)
            for i, (job, score) in enumerate(eligible[:max_jobs]):
                print(f"[linkedin_auto_apply] [{i+1}/{min(len(eligible), max_jobs)}] Aplicando: {job['title']} @ {job['company']} (score {score*100:.0f}%)")
                r = await apply_to_job(context, job, profile)
                r["matchScore"] = round(score, 3)
                if r.get("status") == "APPLIED":
                    result["applied"].append(r)
                elif r.get("status") == "NO_EASY_APPLY":
                    result["skipped"].append(r)
                else:
                    result["errors"].append(r)
                # Pausa humanizada entre candidaturas
                await asyncio.sleep(4.0)

            result["success"] = True
            return result

        finally:
            # Só fecha o contexto se foi criado por nós (headless isolado)
            if owns_browser:
                try:
                    await context.close()
                except Exception:
                    pass
            # Se conectamos via CDP, NÃO fechamos o Chrome do usuário
            # (deixamos a aba aberta para o usuário acompanhar)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", required=True, help="JSON com {profile, maxJobs, matchThreshold, liAt, jsessionId}")
    args = parser.parse_args()

    try:
        data = json.loads(args.payload)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Payload inválido: {e}"}))
        sys.exit(1)

    profile = data.get("profile") or {}
    max_jobs = int(data.get("maxJobs", 10))
    match_threshold = float(data.get("matchThreshold", 0.7))
    li_at = data.get("liAt")
    jsessionid = data.get("jsessionId")

    result = asyncio.run(run_linkedin_auto_apply(profile, max_jobs, match_threshold, li_at, jsessionid))
    # Imprime a última linha como JSON (para o Next.js parsear)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
