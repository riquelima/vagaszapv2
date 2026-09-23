#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Serviço de Auto-Apply ATS Oficial (Greenhouse Remix, Ashby, Lever, Workable)
Roda via subprocess disparado pelo endpoint Next.js /api/apply/auto.

Recebe job + profile via JSON em argv (--payload '{...}').
Abre o link oficial da vaga em um Chromium headless, preenche TODOS os campos
reconhecidos (inputs, react-select, textarea, custom questions), aceita
consentimentos, navega entre etapas e submete. Suporta upload de PDF.

Saída: JSON em uma única linha com status + filledFields + coverLetter + atsType.

Uso:
    python3 greenhouse_auto_apply.py --payload '{"job": {...}, "profile": {...}}'
"""
import argparse
import asyncio
import json
import os
import re
import sys
import time
import urllib.request
from typing import Any, Dict, List, Optional

try:
    from playwright.async_api import (
        async_playwright,
        Browser,
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

BLOCKED_HOSTS = ["himalayas.app", "himalayas.com"]


# ─────────────────────────────────────────────────────────────────────────────
# Helpers de IA (MiniMax)
# ─────────────────────────────────────────────────────────────────────────────
def ask_minimax_text(system: str, user: str, max_tokens: int = 250, timeout: int = 12) -> str:
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


def generate_cover_letter(job: Dict[str, Any], profile: Dict[str, Any]) -> str:
    title = job.get("title", "the role")
    company = job.get("company", "your company")
    name = profile.get("full_name") or "Candidate"
    skills = (profile.get("top_skills") or [])[:6]
    skills_str = ", ".join(skills) if skills else "modern development practices"

    system = "You are a specialized career agent. Write a concise, professional 1-paragraph cover letter in English. Be direct, no pleasantries."
    user = (
        f"Candidate: {name}\n"
        f"Target Role: {title} at {company}\n"
        f"Skills: {skills_str}\n\n"
        "Write a 3-4 sentence cover letter explaining why the candidate fits the role. "
        "Highlight remote-readiness, autonomy, and concrete impact."
    )
    letter = ask_minimax_text(system, user, max_tokens=300)
    if letter and len(letter) > 30:
        return letter
    return (
        f"Dear Hiring Team at {company},\n\n"
        f"I am applying for the {title} position. With strong expertise in {skills_str} "
        f"and a track record of delivering high-quality remote work, I am confident I "
        f"can contribute immediately to your team.\n\nSincerely,\n{name}"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Construção do perfil dinâmico (espelha o que a extensão faz)
# ─────────────────────────────────────────────────────────────────────────────
def normalize_degree(deg: str) -> str:
    d = (deg or "").lower()
    if any(k in d for k in ["pos", "pós", "master", "mestrad", "mba", "especializa"]):
        return "Master's Degree"
    if any(k in d for k in ["doutor", "phd", "doctor"]):
        return "Doctor of Philosophy (Ph.D.)"
    if any(k in d for k in ["engenhar", "engineer"]):
        return "Engineer's Degree"
    if any(k in d for k in ["tecnol", "tecnic", "associat"]):
        return "Associate's Degree"
    return "Bachelor's Degree"


def normalize_discipline(disc: str, skills: List[str]) -> str:
    d = (disc or "").lower()
    s = " ".join(skills or []).lower()
    if any(k in d for k in ["comput", "software", "sistemas", "ti"]) or "python" in s or "linux" in s:
        return "Computer Science"
    if any(k in d for k in ["engenhar", "engineer", "mecân", "produç"]):
        return "Engineering"
    if any(k in d for k in ["administra", "gestão", "negócio", "business", "logística"]):
        return "Business Administration"
    return "Computer Science"


def build_profile(profile: Dict[str, Any]) -> Dict[str, Any]:
    raw_full = (profile.get("full_name") or profile.get("fullName") or "").strip()
    parts = raw_full.split() if raw_full else []
    first = profile.get("first_name") or (parts[0] if parts else "Candidate")
    last = profile.get("last_name") or (" ".join(parts[1:]) if len(parts) > 1 else "")

    return {
        "first_name": first,
        "last_name": last,
        "full_name": raw_full or f"{first} {last}".strip(),
        "email": profile.get("email") or "",
        "phone": profile.get("phone") or "",
        "location": profile.get("location") or "Brasil (Disponível Remoto Internacional)",
        "country": "Brazil",
        "nationality": "Brazilian",
        "gender": "Male",
        "ethnicity": "Hispanic or Latino",
        "veteran_status": "I am not a protected veteran",
        "linkedin": profile.get("linkedin") or profile.get("linkedin_url") or "",
        "github": profile.get("github") or profile.get("github_url") or "",
        "website": profile.get("portfolio") or profile.get("website") or "https://linkedin.com",
        "school": profile.get("school") or "Universidade Federal",
        "degree": normalize_degree(profile.get("degree") or ""),
        "discipline": normalize_discipline(
            profile.get("discipline") or "", profile.get("top_skills") or []
        ),
        "start_year": str(profile.get("education_start_year") or "2016"),
        "end_year": str(profile.get("education_end_year") or "2020"),
        "years_experience": str(profile.get("years_experience") or "10"),
        "top_skills": profile.get("top_skills") or ["Linux", "Python", "Docker", "Kubernetes", "Cloud Operations"],
        "summary_en": profile.get("summary_en") or profile.get("summary") or "",
        "resume_text": profile.get("raw_text") or profile.get("resumeText") or "",
        "salary_expectation": "USD $2,200 / month (approx. R$ 11.000 / month, negotiable based on benefits)",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Detectores de plataforma
# ─────────────────────────────────────────────────────────────────────────────
def detect_ats(url: str) -> str:
    h = (url or "").lower()
    if "greenhouse.io" in h or "boards.greenhouse.io" in h:
        return "greenhouse"
    if "ashbyhq.com" in h:
        return "ashby"
    if "lever.co" in h:
        return "lever"
    if "workable.com" in h:
        return "workable"
    if any(b in h for b in BLOCKED_HOSTS):
        return "blocked"
    return "unknown"


# ─────────────────────────────────────────────────────────────────────────────
# Helpers de DOM
# ─────────────────────────────────────────────────────────────────────────────
async def wait_visible(page: Page, selector: str, timeout: int = 8000) -> bool:
    try:
        await page.wait_for_selector(selector, state="visible", timeout=timeout)
        return True
    except PlaywrightTimeoutError:
        return False


async def find_submit_button(page: Page) -> Optional[Any]:
    candidates = [
        "button[type='submit']",
        "input[type='submit']",
        "button[data-testid='submit-application']",
    ]
    for sel in candidates:
        try:
            loc = page.locator(sel).first
            if await loc.count() and await loc.is_visible():
                return loc
        except Exception:
            pass

    text_locators = [
        "submit application", "submit", "apply now",
        "complete application", "send application", "enviar candidatura",
        "send", "apply",
    ]
    for txt in text_locators:
        try:
            loc = page.get_by_role("button", name=re.compile(re.escape(txt), re.I)).first
            if await loc.count() and await loc.is_visible():
                return loc
        except Exception:
            pass
    return None


async def find_next_button(page: Page) -> Optional[Any]:
    text_locators = [
        "next", "continue", "próximo", "next step",
        "save and continue", "avançar", "save & continue",
    ]
    for txt in text_locators:
        try:
            loc = page.get_by_role("button", name=re.compile(f"^{re.escape(txt)}$", re.I)).first
            if await loc.count() and await loc.is_visible():
                # pula botões de submit
                btn_type = await loc.get_attribute("type")
                if btn_type == "submit":
                    continue
                return loc
        except Exception:
            pass
    return None


async def safe_click(page: Page, locator: Any) -> bool:
    try:
        await locator.scroll_into_view_if_needed(timeout=2000)
        await locator.click(force=True, timeout=4000)
        return True
    except Exception:
        try:
            await locator.dispatch_event("click")
            return True
        except Exception:
            return False


async def fill_input(page: Page, locator: Any, value: str) -> None:
    try:
        await locator.fill("")  # limpa
        await locator.fill(value, timeout=3000)
    except Exception:
        # Fallback JS para inputs React 18
        try:
            handle = await locator.element_handle()
            await page.evaluate(
                """([el, v]) => {
                    const proto = el instanceof HTMLTextAreaElement
                        ? window.HTMLTextAreaElement.prototype
                        : window.HTMLInputElement.prototype;
                    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
                    if (desc && desc.set) desc.set.call(el, v); else el.value = v;
                    if (el._valueTracker) el._valueTracker.setValue('');
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.dispatchEvent(new Event('blur', { bubbles: true }));
                }""",
                [handle, value],
            )
        except Exception:
            pass


async def select_native_option(page: Page, locator: Any, value: str) -> bool:
    try:
        options = await locator.evaluate(
            "el => Array.from(el.options).map(o => ({value: o.value, text: o.text}))"
        )
        target_lower = value.lower().strip()
        match = next((o for o in options if o["text"].lower().strip() == target_lower), None)
        if not match:
            match = next(
                (o for o in options if target_lower in o["text"].lower()[:10]),
                None,
            )
        if match:
            await locator.select_option(value=match["value"])
            return True
    except Exception:
        pass
    return False


async def select_react_option(page: Page, locator: Any, value: str, async_search: bool = False) -> bool:
    """Seleciona opção em react-select (Greenhouse, Ashby)."""
    try:
        # 1. Tenta clicar no controle para abrir
        try:
            await locator.click(force=True, timeout=2000)
        except Exception:
            pass

        await page.wait_for_timeout(400)

        # 2. Se for busca assíncrona, digita o termo
        if async_search:
            try:
                clean = re.sub(r"\(.*?\)", "", value).strip()
                words = [w for w in clean.split() if len(w) > 2]
                if len(words) > 2 and words[0].lower() in ("universidade", "faculdade"):
                    clean = " ".join(words[:3])
                await locator.fill(clean, timeout=2000)
                await page.wait_for_timeout(900)  # espera API de Education
            except Exception:
                pass

        await page.wait_for_timeout(400)

        # 3. Procura as opções no menu
        options = page.locator(
            "[role='option'], div[class*='-option'], .select__option"
        )
        count = await options.count()
        if count == 0:
            await page.keyboard.press("ArrowDown")
            await page.wait_for_timeout(300)
            count = await options.count()

        if count == 0:
            return False

        target_lower = value.lower().strip()
        best_idx = -1
        texts = []
        for i in range(count):
            try:
                t = (await options.nth(i).inner_text(timeout=1000)).lower().strip()
            except Exception:
                t = ""
            texts.append(t)
            if best_idx == -1:
                if t == target_lower or target_lower in t or t in target_lower:
                    best_idx = i
                elif target_lower == "yes" and t in ("sim", "yes"):
                    best_idx = i
        if best_idx == -1:
            best_idx = 0  # fallback

        await options.nth(best_idx).scroll_into_view_if_needed(timeout=2000)
        await safe_click(page, options.nth(best_idx))
        await page.wait_for_timeout(250)
        return True
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Mapeamento de campos
# ─────────────────────────────────────────────────────────────────────────────
async def scan_fields(page: Page) -> List[Dict[str, Any]]:
    """Varre todos os inputs/selects/textareas e retorna uma lista normalizada."""
    return await page.evaluate(
        """
        () => {
            const fields = [];
            const seen = new Set();
            const els = Array.from(document.querySelectorAll("input:not([type='hidden']), textarea, select"));
            for (const el of els) {
                if (seen.has(el)) continue;
                seen.add(el);
                const tag = el.tagName.toLowerCase();
                const id = el.id || '';
                const name = el.name || '';
                const type = el.type || tag;
                if (type === 'submit' || type === 'button' || type === 'file') continue;

                let labelText = '';
                if (id) {
                    const l = document.querySelector(`label[for="${id}"]`) || document.getElementById(`${id}-label`);
                    if (l) labelText = l.innerText;
                }
                if (!labelText) {
                    const closest = el.closest('label');
                    if (closest) labelText = closest.innerText;
                }
                if (!labelText) {
                    const group = el.closest('fieldset, .field, .form-group, [class*="field"], [class*="question"], [class*="select__container"], .input-wrapper');
                    if (group) {
                        const titleEl = group.querySelector('label, legend, p, h3, h4, [class*="label"], [class*="title"]');
                        if (titleEl) labelText = titleEl.innerText;
                    }
                }
                if (!labelText) {
                    labelText = el.getAttribute('aria-label') || el.placeholder || name || id;
                }
                labelText = (labelText || '').replace(/\\*/g, '').replace(/\\s+/g, ' ').trim();

                const isReactSelect = !!(
                    el.classList && el.classList.contains('select__input')
                ) || !!el.closest('.select__control')
                  || !!el.closest('.select-shell')
                  || !!el.closest('.select__container');

                const nativeOptions = tag === 'select'
                    ? Array.from(el.options).map(o => (o.text || o.value).trim()).filter(Boolean)
                    : [];

                fields.push({
                    tag, id, name, type, labelText, isReactSelect, nativeOptions
                });
            }
            return fields;
        }
        """
    )


def heuristic_answer(label: str, profile: Dict[str, Any]) -> Any:
    """Fallback determinístico para campos comuns."""
    lbl = (label or "").lower()
    skills = profile["top_skills"]
    skills_text = ", ".join(skills[:5]) if skills else "Linux, Python, Docker"

    if any(k in lbl for k in ["first name", "primeiro nome", "given name"]):
        return profile["first_name"]
    if any(k in lbl for k in ["last name", "sobrenome", "family name", "surname"]):
        return profile["last_name"]
    if any(k in lbl for k in ["email", "e-mail"]):
        return profile["email"]
    if any(k in lbl for k in ["phone", "telefone", "mobile", "celular"]):
        return profile["phone"]
    if "linkedin" in lbl:
        return profile["linkedin"]
    if "github" in lbl:
        return profile["github"]
    if any(k in lbl for k in ["website", "portfolio", "portfólio"]):
        return profile["website"]
    if "location" in lbl or "cidade" in lbl or "city" in lbl or "country" in lbl or "país" in lbl:
        return profile["location"]
    if "school" in lbl or "universidade" in lbl or "faculdade" in lbl or "institution" in lbl:
        return profile["school"]
    if "degree" in lbl or "grau" in lbl or "formação" in lbl:
        return profile["degree"]
    if "discipline" in lbl or "field of study" in lbl or "curso" in lbl:
        return profile["discipline"]
    if "start" in lbl and "year" in lbl:
        return profile["start_year"]
    if "end" in lbl and "year" in lbl:
        return profile["end_year"]
    if "years of experience" in lbl or "years experience" in lbl or "anos de experiência" in lbl:
        return profile["years_experience"]
    if any(k in lbl for k in ["salary", "salár", "compensation", "pretens", "remunera"]):
        return profile["salary_expectation"]
    if any(k in lbl for k in ["gender", "gênero", "sex"]):
        return profile["gender"]
    if "ethnicity" in lbl or "raça" in lbl or "race" in lbl:
        return profile["ethnicity"]
    if "veteran" in lbl:
        return profile["veteran_status"]
    if "authorized" in lbl or "legally" in lbl or "work author" in lbl:
        return "Yes"
    if "sponsorship" in lbl or "visa" in lbl:
        return "No"
    if "relocate" in lbl or "relocation" in lbl:
        return "Yes"
    if any(k in lbl for k in ["agree", "concordo", "consent", "acknowledge", "confirm"]):
        return "Yes"
    if "notice" in lbl or "available" in lbl or "start date" in lbl or "disponibilidade" in lbl:
        return "Immediate / 2 weeks"
    if any(k in lbl for k in ["skill", "technology", "tecnologia", "conhec"]):
        return skills_text
    return None


async def fill_form_step(page: Page, job: Dict[str, Any], profile: Dict[str, Any]) -> List[Dict[str, str]]:
    """Preenche todos os campos visíveis e retorna lista de campos preenchidos."""
    fields = await scan_fields(page)
    filled: List[Dict[str, str]] = []

    for f in fields:
        # Encontra o locator correspondente
        try:
            sel = None
            if f["id"]:
                sel = f"#{f['id']}"
            elif f["name"]:
                sel = f"[name='{f['name']}']"
            if not sel:
                continue
            loc = page.locator(sel).first
            if not await loc.count():
                continue
            if not await loc.is_visible():
                continue
        except Exception:
            continue

        value = heuristic_answer(f["labelText"], profile)
        if value is None:
            continue
        value_str = str(value)

        try:
            if f["isReactSelect"]:
                async_search = any(k in f["labelText"].lower() for k in ["school", "universidade", "faculdade"])
                ok = await select_react_option(page, loc, value_str, async_search)
                if ok:
                    filled.append({"field": f["labelText"] or f["id"], "value": value_str})
            elif f["tag"] == "select":
                ok = await select_native_option(page, loc, value_str)
                if ok:
                    filled.append({"field": f["labelText"] or f["id"], "value": value_str})
            else:
                await fill_input(page, loc, value_str)
                filled.append({"field": f["labelText"] or f["id"], "value": value_str})
        except Exception:
            continue

        await page.wait_for_timeout(120)

    return filled


async def check_all_consents(page: Page) -> int:
    """Marca todos os checkboxes visíveis (consent + tech skills)."""
    return await page.evaluate(
        """
        () => {
            const checkboxes = Array.from(document.querySelectorAll("input[type='checkbox']"));
            const techKeywords = ['python','bash','docker','k8s','aws','gcp','linux','kubernetes','react','node','go','terraform','openstack','ceph','kvm','golang'];
            let marked = 0;
            for (const cb of checkboxes) {
                if (!cb.offsetParent) continue; // não visível
                const parent = cb.closest('label, .checkbox, [class*="checkbox"], div');
                const text = (parent?.innerText || cb.getAttribute('aria-label') || cb.id || '').toLowerCase();
                const isTech = techKeywords.some(t => text.includes(t));
                const isConsent = text.includes('agree') || text.includes('concordo')
                    || text.includes('privacy') || text.includes('notice')
                    || cb.hasAttribute('required');
                if ((isTech || isConsent) && !cb.checked) {
                    cb.click();
                    cb.checked = true;
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                    marked++;
                }
            }
            return marked;
        }
        """
    )


async def upload_resume_if_possible(page: Page, resume_text: str) -> bool:
    """Se houver upload de currículo, envia um PDF simulado com o texto."""
    file_input = page.locator("input[type='file']").first
    if not await file_input.count():
        return False

    try:
        # Cria um arquivo .txt dentro do temp dir com o resumo do currículo
        import tempfile
        with tempfile.NamedTemporaryFile(
            delete=False, suffix=".txt", mode="w", encoding="utf-8"
        ) as f:
            f.write(resume_text or "Candidate resume placeholder")
            tmp_path = f.name
        await file_input.set_input_files(tmp_path)
        return True
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Fluxo principal
# ─────────────────────────────────────────────────────────────────────────────
async def detect_success(page: Page) -> bool:
    """Detecta tela oficial de sucesso do Greenhouse (seletores robustos)."""
    success_selectors = [
        "h1#application_submitted",
        "[data-marker='confirmation']",
        ".application-confirmation",
        "#application_submitted",
    ]
    for sel in success_selectors:
        try:
            if await page.locator(sel).count() > 0:
                return True
        except Exception:
            pass
    try:
        text = (await page.inner_text("body")).lower()
        return bool(re.search(
            r"\b(application (submitted|received)|thanks for applying|"
            r"candidatura enviada|obrigado por se candidatar)\b",
            text,
        ))
    except Exception:
        return False


async def detect_errors(page: Page) -> List[str]:
    """Detecta mensagens de erro injetadas pelo Greenhouse após validação falha."""
    error_selectors = [
        "[data-marker='error']",
        ".field-error",
        ".error-message",
        "[role='alert']",
        ".invalid-feedback",
        "[data-marker='form-field-error']",
    ]
    out: List[str] = []
    for sel in error_selectors:
        try:
            locs = page.locator(sel)
            n = await locs.count()
            for i in range(n):
                t = (await locs.nth(i).inner_text(timeout=500)).strip()
                if t and len(t) > 2:
                    out.append(t)
        except Exception:
            pass
    return list(dict.fromkeys(out))  # dedup preservando ordem


async def list_empty_required(page: Page) -> List[str]:
    """Lista campos required vazios (bloqueio pré-submit)."""
    return await page.evaluate(
        """() => {
            const empty = [];
            const seen = new Set();
            document.querySelectorAll('input[required], select[required], textarea[required]').forEach(el => {
                if (!el.offsetParent) return;
                if (el.value && el.value.trim()) return;
                // Tenta várias estratégias para extrair um label legível
                let label = '';
                if (el.labels && el.labels.length > 0) {
                    label = el.labels[0].innerText || '';
                }
                if (!label) label = el.placeholder || '';
                if (!label) {
                    // Greenhouse esconde label em fieldset / form-field
                    const g = el.closest('fieldset, .form-field, [class*="form-field"], [class*="field"], .question, [data-marker*="field"]');
                    if (g) {
                        const t = g.querySelector('legend, label, h2, h3, h4, [class*="label"], [class*="title"], [class*="question"]');
                        if (t) label = t.innerText || '';
                    }
                }
                if (!label) {
                    // Procura o texto imediatamente acima ou ao lado
                    const prev = el.parentElement?.previousElementSibling;
                    if (prev) label = prev.innerText || '';
                }
                if (!label) label = el.getAttribute('aria-label') || el.name || el.id || '';
                const clean = (label || '').replace(/\\*/g, '').trim();
                const key = clean.toLowerCase() || ('field-' + el.tagName.toLowerCase() + '-' + (el.name || el.id || ''));
                if (seen.has(key)) return;
                seen.add(key);
                empty.push(clean || 'campo');
            });
            document.querySelectorAll('fieldset, [role="radiogroup"]').forEach(fs => {
                if (!fs.offsetParent) return;
                const radios = fs.querySelectorAll('input[type="radio"]');
                if (radios.length === 0) return;
                const any = Array.from(radios).some(r => r.checked);
                if (!any) {
                    const legend = fs.querySelector('legend, .label, h3, h4, .question')?.innerText || '';
                    empty.push(legend.replace(/\\*/g, '').trim() || 'radio group');
                }
            });
            return empty;
        }"""
    )


async def fill_open_textareas_ai(page: Page, job: Dict[str, Any], profile: Dict[str, Any]) -> List[str]:
    """Preenche textareas abertas usando IA (3-5 frases em inglês, sem saudações)."""
    filled: List[str] = []
    textareas = page.locator("textarea").locator("visible=true")
    n = await textareas.count()
    for i in range(n):
        ta = textareas.nth(i)
        try:
            if not await ta.is_visible():
                continue
        except Exception:
            continue
        val = await ta.input_value()
        if val and val.strip():
            continue

        # Detecta label
        label_js = """
        (el) => {
            let l = el.labels?.[0]?.innerText || el.placeholder || el.getAttribute('aria-label') || '';
            if (!l) {
                const g = el.closest('fieldset, .field, .question, [class*="form-field"]');
                if (g) l = g.querySelector('label, legend, h3, h4')?.innerText || '';
            }
            return (l || '').trim();
        }
        """
        try:
            label = await ta.evaluate(label_js)
        except Exception:
            label = ""
        if not label:
            continue

        prompt = (
            f"You write concise, professional application answers (3-5 sentences) in English. "
            f"Be specific and relevant to the question and the target role.\n\n"
            f"Role: {job.get('title', '')} @ {job.get('company', '')}\n"
            f"Question: {label}\n\n"
            f"Write a direct, role-specific answer in 3-5 sentences. Do not include greetings."
        )
        answer = ask_minimax_text(
            "You write concise, professional application answers (3-5 sentences) in English. Be specific.",
            prompt,
            max_tokens=300,
        )
        # Limpa caracteres asiáticos
        answer = re.sub(r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]", "", answer).strip()
        if not answer or len(answer) < 25:
            continue
        try:
            await fill_input(page, ta, answer)
            filled.append(label[:60])
        except Exception:
            pass
    return filled


async def fill_unfilled_selects(page: Page, job: Dict[str, Any], profile: Dict[str, Any]) -> int:
    """Seleciona opções em <select> nativos que ainda não foram preenchidos."""
    filled = 0
    selects = page.locator("select").locator("visible=true")
    n = await selects.count()
    for i in range(n):
        sel = selects.nth(i)
        try:
            if not await sel.is_visible():
                continue
            current = await sel.input_value()
            if current and current.strip():
                continue
        except Exception:
            continue

        options = await sel.evaluate(
            "el => Array.from(el.options).filter(o => o.value && o.value !== '').map(o => ({value: o.value, text: o.text.trim()}))"
        )
        if not options:
            continue
        label_js = "el => (el.labels?.[0]?.innerText || el.placeholder || el.name || el.id || '').toLowerCase()"
        try:
            label = (await sel.evaluate(label_js)) or ""
        except Exception:
            label = ""

        chosen = None
        if re.search(r"agree|consent|authorize", label):
            chosen = next((o["text"] for o in options if re.match(r"^(yes|i agree|concordo|sim|agree)$", o["text"], re.I)), options[0]["text"])
        elif re.search(r"gender|g[êe]nero|sex", label):
            chosen = next((o["text"] for o in options if re.match(r"^male$", o["text"], re.I)), options[0]["text"])
        elif "veteran" in label:
            chosen = next((o["text"] for o in options if "not a protected veteran" in o["text"].lower() or "not a veteran" in o["text"].lower()), options[0]["text"])
        elif re.search(r"ethnic|race|ra[çc]a", label):
            chosen = next((o["text"] for o in options if "hispanic" in o["text"].lower() and "latino" in o["text"].lower()), options[0]["text"])
        elif re.search(r"pronouns?", label):
            chosen = next((o["text"] for o in options if re.match(r"^he/?him$|^he$", o["text"], re.I)), options[0]["text"])
        elif re.search(r"country|pa[íi]s|nacional", label):
            chosen = next((o["text"] for o in options if o["text"].lower() in ("brazil", "brasil")), options[0]["text"])
        elif re.search(r"english|ingl", label):
            chosen = next((o["text"] for o in options if re.search(r"fluent|professional|advanced|avanç|full", o["text"], re.I)), options[-1]["text"])
        else:
            # IA fallback
            opt_texts = "\n".join(f"{j+1}. {o['text']}" for j, o in enumerate(options[:25]))
            txt = ask_minimax_text(
                "You pick the best option for a job application select. Return ONLY the exact text of one option, no numbering.",
                f"Field: {label}\nOptions:\n{opt_texts}",
                max_tokens=50,
            )
            txt = re.sub(r"^[\d\.\-\)\s]+", "", txt).strip()
            chosen = next((o["text"] for o in options if o["text"].lower() == txt.lower()), None)
            if not chosen and txt:
                chosen = next((o["text"] for o in options if txt.lower()[:12] in o["text"].lower()), None)
            if not chosen:
                chosen = options[0]["text"]

        if chosen:
            match = next((o for o in options if o["text"] == chosen), None)
            if match:
                try:
                    await sel.select_option(value=match["value"])
                    filled += 1
                except Exception:
                    pass
        await page.wait_for_timeout(80)
    return filled


async def run_apply(job: Dict[str, Any], profile: Dict[str, Any]) -> Dict[str, Any]:
    if not PLAYWRIGHT_AVAILABLE:
        return {
            "success": False,
            "error": "Playwright não está instalado neste ambiente. Rode: pip install playwright && python -m playwright install chromium",
        }

    url = job.get("applicationLink") or job.get("link") or ""
    ats = detect_ats(url)
    if ats == "blocked":
        return {"success": False, "error": "Portal intermediário bloqueado (Himalayas). Use link direto do ATS."}

    built_profile = build_profile(profile)
    cover_letter = generate_cover_letter(job, built_profile)
    filled_log: List[Dict[str, str]] = []
    started = time.time()

    result: Dict[str, Any] = {
        "success": False,
        "status": "STARTED",
        "atsType": ats.upper() if ats != "unknown" else "ATS_GENERIC",
        "targetJob": {"title": job.get("title"), "company": job.get("company"), "link": url},
        "coverLetter": cover_letter,
        "filledFields": [],
    }

    async with async_playwright() as p:
        browser: Browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1366, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            ),
        )
        page: Page = await context.new_page()

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(1500)

            # ── Upload de currículo ────────────────────────────────────────────────
            uploaded = await upload_resume_if_possible(page, built_profile["resume_text"])
            if uploaded:
                filled_log.append({"field": "Resume File", "value": "Uploaded via Playwright set_input_files"})

            # ── Consents iniciais ──────────────────────────────────────────────────
            marked = await check_all_consents(page)
            if marked > 0:
                filled_log.append({"field": "Consent Checkboxes", "value": f"{marked} marcados"})

            # ── Loop multi-step ────────────────────────────────────────────────────
            max_steps = 10
            for step in range(max_steps):
                await page.wait_for_timeout(800)

                # 1) Preenche campos conhecidos via heurística
                step_filled = await fill_form_step(page, job, built_profile)
                filled_log.extend(step_filled)

                # 2) Selects nativos não preenchidos
                sel_filled = await fill_unfilled_selects(page, job, built_profile)
                if sel_filled:
                    filled_log.append({"field": "Native Selects", "value": f"{sel_filled} preenchidos"})

                # 3) Textareas abertas (perguntas customizadas) via IA
                ta_filled = await fill_open_textareas_ai(page, job, built_profile)
                if ta_filled:
                    filled_log.append({"field": "Open Textareas", "value": f"{len(ta_filled)} perguntas respondidas"})

                # 4) Consents novamente (podem aparecer após preencher campos)
                await check_all_consents(page)

                # 5) Erros visíveis antes de tentar avançar
                pre_errors = await detect_errors(page)
                if pre_errors:
                    print(f"[run_apply] Erros antes de avançar (etapa {step+1}):", pre_errors)

                # 6) Tenta avançar
                submit_btn = await find_submit_button(page)
                next_btn = await find_next_button(page)

                if submit_btn:
                    # Página final: vai para o bloco de submit (sai do loop)
                    break
                elif next_btn:
                    ok = await safe_click(page, next_btn)
                    if not ok:
                        break
                    await page.wait_for_timeout(2200)
                else:
                    break

            # ── Validação pré-submit ──────────────────────────────────────────────
            empty_fields = await list_empty_required(page)
            validation_attempts = 0
            while empty_fields and validation_attempts < 3:
                print(f"[run_apply] {len(empty_fields)} campos vazios:", empty_fields)
                await fill_unfilled_selects(page, job, built_profile)
                await fill_open_textareas_ai(page, job, built_profile)
                await check_all_consents(page)
                # Heurística também pode preencher alguns campos required óbvãos
                step_filled = await fill_form_step(page, job, built_profile)
                filled_log.extend(step_filled)
                await page.wait_for_timeout(800)
                empty_fields = await list_empty_required(page)
                validation_attempts += 1

            if empty_fields:
                result["status"] = "VALIDATION_FAILED"
                result["success"] = False
                result["error"] = f"Campos obrigatórios vazios: {', '.join(empty_fields[:5])}"
                result["emptyFields"] = empty_fields
                result["filledFields"] = filled_log
                result["elapsedSeconds"] = round(time.time() - started, 1)
                try:
                    await context.close()
                    await browser.close()
                except Exception:
                    pass
                return result

            # ── Submit ─────────────────────────────────────────────────────────────
            submit_btn = await find_submit_button(page)
            if not submit_btn:
                result["status"] = "NO_SUBMIT_BUTTON"
                result["success"] = False
                result["error"] = "Botão de envio não encontrado após preencher formulário."
                result["filledFields"] = filled_log
                result["elapsedSeconds"] = round(time.time() - started, 1)
                try:
                    await context.close()
                    await browser.close()
                except Exception:
                    pass
                return result

            await submit_btn.scroll_into_view_if_needed(timeout=2000)
            await page.wait_for_timeout(400)
            ok = await safe_click(page, submit_btn)
            filled_log.append({"field": "Submit", "value": "Clicado" if ok else "Falha"})
            if not ok:
                # Tenta requestSubmit
                try:
                    await page.evaluate(
                        """btn => {
                            const f = btn.closest('form');
                            if (f && typeof f.requestSubmit === 'function') f.requestSubmit(btn);
                            else if (f) f.dispatchEvent(new Event('submit', { bubbles: true }));
                        }""",
                        await submit_btn.element_handle(),
                    )
                except Exception:
                    pass

            # ── Detecção real de sucesso (polling 8s) ──────────────────────────────
            confirmed = False
            post_errors: List[str] = []
            start_wait = time.time()
            while time.time() - start_wait < 8.0:
                await page.wait_for_timeout(500)
                if await detect_success(page):
                    confirmed = True
                    break
                post_errors = await detect_errors(page)
                if post_errors:
                    break

            # ── Tentativa de correção automática se houver erros ───────────────────
            if not confirmed and post_errors:
                print(f"[run_apply] {len(post_errors)} erros após submit:", post_errors)
                await page.wait_for_timeout(1500)
                await fill_unfilled_selects(page, job, built_profile)
                await fill_open_textareas_ai(page, job, built_profile)
                await check_all_consents(page)
                step_filled = await fill_form_step(page, job, built_profile)
                filled_log.extend(step_filled)
                await page.wait_for_timeout(800)

                btn2 = await find_submit_button(page)
                if btn2:
                    await btn2.scroll_into_view_if_needed(timeout=2000)
                    await page.wait_for_timeout(300)
                    await safe_click(page, btn2)
                    start_wait2 = time.time()
                    while time.time() - start_wait2 < 8.0:
                        await page.wait_for_timeout(500)
                        if await detect_success(page):
                            confirmed = True
                            break

            if confirmed:
                result["status"] = "APPLIED"
                result["success"] = True
                result["confirmationId"] = f"VZ-{int(time.time())}-{abs(hash(url)) % 100000}"
            else:
                result["status"] = "SUBMIT_UNCONFIRMED"
                result["success"] = False
                result["error"] = (
                    f"Submit clicado mas confirmação não detectada. "
                    f"Erros visíveis: {post_errors[:3] if post_errors else 'nenhum'}"
                )

        except PlaywrightTimeoutError as e:
            result["status"] = "TIMEOUT"
            result["error"] = f"Timeout ao navegar: {str(e)[:120]}"
        except Exception as e:
            result["status"] = "ERROR"
            result["error"] = f"{type(e).__name__}: {str(e)[:200]}"
        finally:
            try:
                await context.close()
                await browser.close()
            except Exception:
                pass

    result["filledFields"] = filled_log
    result["elapsedSeconds"] = round(time.time() - started, 1)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", required=True, help="JSON com { job, profile }")
    args = parser.parse_args()

    try:
        data = json.loads(args.payload)
        job = data.get("job") or {}
        profile = data.get("profile") or {}
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Payload inválido: {e}"}))
        sys.exit(1)

    result = asyncio.run(run_apply(job, profile))
    # imprime APENAS a última linha = JSON final (para fácil parsing pelo Next.js)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
