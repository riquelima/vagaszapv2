#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LinkedIn Auth Capture — Captura o cookie li_at via login manual do usuário.

Fluxo:
1. Abre Chromium em MODO HEADED (com janela visível) no LinkedIn /login
2. Aguarda o usuário fazer login manualmente (com email/senha/2FA/etc.)
3. Detecta quando aparece /feed ou /jobs (login bem-sucedido)
4. Extrai cookies li_at e JSESSIONID
5. Salva em ~/.vagaszap-linkedin-cookies.json para uso pelo linkedin_auto_apply.py

Uso:
    python3 linkedin_auth_capture.py --timeout 180
"""
import argparse
import asyncio
import json
import os
import sys
from datetime import datetime

try:
    from playwright.async_api import async_playwright, TimeoutError as PWTimeout
    PLAYWRIGHT_AVAILABLE = True
except Exception:
    PLAYWRIGHT_AVAILABLE = False

COOKIES_FILE = os.path.expanduser("~/.vagaszap-linkedin-cookies.json")


async def capture(timeout: int = 180) -> dict:
    if not PLAYWRIGHT_AVAILABLE:
        return {"success": False, "error": "Playwright não instalado."}

    result = {"success": False, "cookies": {}, "url": None}

    async with async_playwright() as p:
        # HEADDED = janela visível (usuário faz login visualmente)
        browser = await p.chromium.launch(
            headless=False,
            slow_mo=200,  # deixa mais humanizado
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--start-maximized",
            ],
        )
        context = await browser.new_context(
            viewport={"width": 1366, "height": 800},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            ),
            locale="en-US",
            timezone_id="America/Sao_Paulo",
        )

        page = await context.new_page()
        print(f"[auth_capture] Abrindo LinkedIn... (você tem {timeout}s para fazer login)")

        try:
            await page.goto("https://www.linkedin.com/login", wait_until="domcontentloaded", timeout=30000)
        except Exception as e:
            print(f"[auth_capture] Falha ao abrir /login: {e}")

        # Polling: checa a cada 2s se o login foi completado
        start = asyncio.get_event_loop().time()
        logged_in = False
        while asyncio.get_event_loop().time() - start < timeout:
            try:
                url = page.url
                # Login concluído = URL contém /feed, /jobs, /mynetwork, ou saiu de /login
                if "/feed" in url or "/jobs" in url or "/mynetwork" in url:
                    logged_in = True
                    result["url"] = url
                    break
                # Ou se aparecer elementos pós-login
                if await page.locator(".global-nav, [data-test-app-banner]").count() > 0:
                    logged_in = True
                    result["url"] = page.url
                    break
            except Exception:
                pass
            await asyncio.sleep(2)
            elapsed = int(asyncio.get_event_loop().time() - start)
            if elapsed % 20 == 0 and elapsed > 0:
                print(f"[auth_capture] Aguardando login manual... ({elapsed}s / {timeout}s)")

        if not logged_in:
            await browser.close()
            result["error"] = f"Timeout de {timeout}s sem login manual detectado."
            return result

        # Extrai cookies
        cookies = await context.cookies()
        for c in cookies:
            name = c.get("name")
            if name == "li_at":
                result["cookies"]["li_at"] = c.get("value")
            elif name == "JSESSIONID":
                result["cookies"]["JSESSIONID"] = c.get("value")
            elif name == "liap":
                result["cookies"]["liap"] = c.get("value")

        result["success"] = bool(result["cookies"].get("li_at"))
        if not result["success"]:
            await browser.close()
            result["error"] = "Login detectado mas cookie li_at não foi encontrado."
            return result

        # Salva em arquivo para uso futuro
        save_data = {
            "cookies": result["cookies"],
            "captured_at": datetime.utcnow().isoformat() + "Z",
            "url": result["url"],
        }
        try:
            with open(COOKIES_FILE, "w", encoding="utf-8") as f:
                json.dump(save_data, f, indent=2)
            os.chmod(COOKIES_FILE, 0o600)  # só o user pode ler
            print(f"[auth_capture] ✅ Cookies salvos em {COOKIES_FILE}")
        except Exception as e:
            print(f"[auth_capture] ⚠️ Erro ao salvar: {e}")

        await browser.close()
        return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--timeout", type=int, default=180, help="Segundos para esperar o login manual (padrão 180).")
    args = parser.parse_args()

    result = asyncio.run(capture(args.timeout))
    # Imprime a última linha como JSON (para o Next.js parsear)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
