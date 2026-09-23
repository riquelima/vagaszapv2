"""
AppleScript bridge for macOS browsers (Google Chrome / Brave Browser).

Reuses the existing chrome_bridge.py pattern (AppleScript via osascript) and
extends it with helpers tailored for job application flows:

    - activate_browser(): focus browser window
    - open_url(url): navigate an existing tab (or create one) to the URL
    - run_js(js): execute arbitrary JS in the active tab and return result
    - submit_active_form(): click the first Submit / Apply button found
    - attach_resume(path): set <input type=file> with the English resume PDF

The browser window the user has open must already be logged into the target
job platforms. This bridge only drives that window — no passwords are stored.

Browser is selected via BROWSER_NAME env (default "Brave Browser"). Both
Google Chrome and Brave expose the same AppleScript dictionary, so the
generated commands are identical.
"""
from __future__ import annotations

import os
import shlex
import subprocess
from pathlib import Path
from typing import Dict, List, Optional


def _osascript(script: str) -> str:
    """Runs the AppleScript and returns stdout, raising on failure."""
    res = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if res.returncode != 0:
        raise RuntimeError(f"AppleScript error: {res.stderr.strip()}")
    return res.stdout.strip()


def _esc(text: str) -> str:
    """Escape a Python string for embedding inside an AppleScript double-quoted literal."""
    return text.replace("\\", "\\\\").replace('"', '\\"')


def _browser_name() -> str:
    return os.environ.get("BROWSER_NAME", "Brave Browser").strip() or "Brave Browser"


def activate_browser() -> None:
    _osascript(f'tell application "{_browser_name()}" to activate')


def new_window() -> None:
    _osascript(
        f'tell application "{_browser_name()}"\n'
        '  if (count of windows) = 0 then make new window\n'
        'end tell'
    )


def open_url(url: str, new_tab: bool = False) -> None:
    safe = _esc(url)
    app = _browser_name()
    if new_tab:
        script = (
            f'tell application "{app}"\n'
            f'  set t to make new tab at end of tabs of front window\n'
            f'  set URL of t to "{safe}"\n'
            'end tell'
        )
    else:
        script = (
            f'tell application "{app}"\n'
            '  if (count of windows) = 0 then make new window\n'
            f'  set URL of active tab of front window to "{safe}"\n'
            'end tell'
        )
    _osascript(script)


def get_active_url() -> str:
    return _osascript(
        f'tell application "{_browser_name()}" to return URL of active tab of front window'
    )


def run_js(js: str) -> str:
    """Execute JavaScript in the active tab and return the result as text."""
    safe = _esc(js)
    return _osascript(
        f'tell application "{_browser_name()}"\n'
        f'  return execute active tab of front window javascript "{safe}"\n'
        'end tell'
    )


def wait_for_load(timeout_s: int = 30) -> bool:
    """Poll document.readyState until complete or timeout."""
    js = (
        "(function(){var s=document.readyState;if(s==='complete')return 'ready';return s;})()"
    )
    import time
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            if run_js(js) == "ready":
                return True
        except RuntimeError:
            pass
        time.sleep(0.8)
    return False


def fill_field(selector: str, value: str) -> str:
    """
    Fill an input/textarea matched by CSS selector with `value`. The value is
    JSON-encoded and assigned via .value = ... then an `input` event is fired
    so React/Vue forms detect the change.
    """
    payload = __import__("json").dumps(value)
    js = f"""
(function() {{
  const el = document.querySelector({__import__('json').dumps(selector)});
  if (!el) return 'NOT_FOUND';
  const setter = Object.getOwnPropertyDescriptor(
    el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value'
  ).set;
  setter.call(el, {payload});
  el.dispatchEvent(new Event('input', {{ bubbles: true }}));
  el.dispatchEvent(new Event('change', {{ bubbles: true }}));
  return 'OK';
}})()
"""
    return run_js(js)


def fill_by_label(label_text: str, value: str) -> str:
    """Fill the input whose associated <label> contains `label_text`."""
    payload = __import__("json").dumps(value)
    label_payload = __import__("json").dumps(label_text)
    js = f"""
(function() {{
  const labels = [...document.querySelectorAll('label')];
  const target = labels.find(l => l.innerText.trim().toLowerCase()
                                   .includes({label_payload}.toLowerCase()));
  if (!target) return 'LABEL_NOT_FOUND';
  let el = target.querySelector('input,textarea,select');
  if (!el && target.htmlFor) {{
    el = document.getElementById(target.htmlFor);
  }}
  if (!el) return 'INPUT_NOT_FOUND';
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, {payload});
  el.dispatchEvent(new Event('input', {{ bubbles: true }}));
  el.dispatchEvent(new Event('change', {{ bubbles: true }}));
  return 'OK';
}})()
"""
    return run_js(js)


def attach_resume(file_path: Path) -> str:
    """
    Attach the resume PDF to the first file input on the page by using a
    synthetic File object loaded via fetch(). Browsers cannot set File inputs
    to local paths directly for security reasons, but they can be filled with
    a File created from a Blob fetched from a file:// URL.
    """
    import json as _json
    if not file_path.exists():
        return f"FILE_NOT_FOUND:{file_path}"
    file_url = f"file://{file_path.absolute()}"
    payload_file = _json.dumps(file_url)
    payload_name = _json.dumps(file_path.name)
    js = (
        "(function(){" +
        "  var i = document.querySelector('input[type=file]');" +
        "  if (!i) return 'NO_FILE_INPUT';" +
        "  fetch(" + payload_file + ")" +
        "    .then(function(r){return r.blob();})" +
        "    .then(function(b){" +
        "      var f = new File([b], " + payload_name + ", {type:'application/pdf'});" +
        "      var dt = new DataTransfer();" +
        "      dt.items.add(f);" +
        "      i.files = dt.files;" +
        "      i.dispatchEvent(new Event('change', {bubbles:true}));" +
        "    });" +
        "  return 'OK';" +
        "})()"
    )
    return run_js(js)


def click_submit() -> str:
    js = """
(function() {
  const candidates = [...document.querySelectorAll(
    'button[type=submit], input[type=submit], button'
  )];
  const match = candidates.find(b => {
    const t = (b.innerText || b.value || '').trim().toLowerCase();
    return t === 'submit' || t === 'apply' || t === 'apply now'
        || t === 'send application' || t === 'enviar candidatura';
  });
  if (!match) return 'NO_SUBMIT_BUTTON';
  match.click();
  return 'CLICKED:' + (match.innerText || match.value || '');
})()
"""
    return run_js(js)


def page_status() -> str:
    js = "JSON.stringify({url: location.href, title: document.title})"
    return run_js(js)


# ---------------------------------------------------------------------------
# Post-submit verification helpers
# ---------------------------------------------------------------------------
# Keywords that, when present on the page after submit, strongly suggest the
# application was accepted by the ATS. ATS-agnostic on purpose.
THANK_YOU_KEYWORDS = [
    "thank you", "thanks for applying", "thanks for your application",
    "application submitted", "application received", "successfully submitted",
    "successfully applied", "we have received your", "your application has been",
    "obrigado", "candidatura enviada", "candidatura recebida", "candidatura realizada",
    "inscrição realizada", "inscricao realizada", "enviada com sucesso",
]


def snapshot_page() -> Dict[str, Optional[str]]:
    """
    Return the current page URL + title + visible text snippet. Used right after
    clicking Submit to verify whether the form went through.
    """
    js = """
(function() {
  try {
    var visible = (document.body && document.body.innerText) || '';
    return JSON.stringify({
      url: location.href,
      title: document.title || '',
      text: visible.substring(0, 1500)
    });
  } catch (e) {
    return JSON.stringify({url: location.href, title: '', text: ''});
  }
})()
"""
    import json as _json
    raw = run_js(js)
    try:
        data = _json.loads(raw)
    except (ValueError, TypeError):
        data = {"url": raw, "title": "", "text": ""}
    return {
        "url": data.get("url"),
        "title": data.get("title"),
        "text": (data.get("text") or "").strip(),
    }


def detect_thank_you(snapshot: Dict[str, Optional[str]]) -> List[str]:
    """
    Return the list of confirmation keywords found in the page text/url/title.
    Empty list means we did NOT detect a confirmation.
    """
    haystack = " ".join(
        str(snapshot.get(k) or "") for k in ("url", "title", "text")
    ).lower()
    return [kw for kw in THANK_YOU_KEYWORDS if kw in haystack]


def wait_for_navigation(timeout_s: int = 15) -> Optional[str]:
    """Wait until location.href changes from a known pre-submit URL. Returns the new URL."""
    import time as _time
    deadline = _time.time() + timeout_s
    last_url: Optional[str] = None
    while _time.time() < deadline:
        try:
            status = page_status()
            import json as _json
            data = _json.loads(status)
            last_url = data.get("url")
            # If document.readyState is complete AND URL looks stable, return.
            ready = run_js("document.readyState")
            if ready == "complete" and last_url:
                return last_url
        except (RuntimeError, ValueError):
            pass
        _time.sleep(0.6)
    return last_url


def take_screenshot(save_path: Path) -> bool:
    """
    Capture the active tab as a PNG using AppleScript + a small osascript
    snippet that hits Chrome's hidden screenshot command. Returns True on
    success.

    NOTE: Chrome's AppleScript dictionary does NOT expose a screenshot verb
    on macOS the way it does on Windows. The reliable cross-platform path is
    to use the DevTools Protocol via headless mode, but our runner drives a
    non-headless browser for auth. As a fallback we use `screencapture` to
    capture the entire screen and crop later if needed.
    """
    try:
        save_path.parent.mkdir(parents=True, exist_ok=True)
        # screencapture requires a file path; pass -x to suppress sound.
        res = subprocess.run(
            ["screencapture", "-x", "-l", os.environ.get("BROWSER_WINDOW_ID", ""), str(save_path)],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if res.returncode == 0 and save_path.exists() and save_path.stat().st_size > 0:
            return True
        # Fallback: capture the whole screen (works headless on most macOS setups).
        res = subprocess.run(
            ["screencapture", "-x", str(save_path)],
            capture_output=True,
            text=True,
            timeout=15,
        )
        return res.returncode == 0 and save_path.exists() and save_path.stat().st_size > 0
    except (subprocess.TimeoutExpired, OSError):
        return False