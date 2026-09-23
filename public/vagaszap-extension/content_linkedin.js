// content_linkedin.js
// Roda em *.linkedin.com/jobs/* - auto-aplica em vagas Easy Apply
// Multi-step: detecta cada modal, preenche heuristica + IA (miniMax API).
//
// Recebe via chrome.runtime.onMessage:
//   { type: 'VAGASZAP_START_APPLY', job, profile }
//   { type: 'VAGASZAP_START_BATCH',  profile, maxJobs }

(function () {
  if (window.__VAGASZAP_LI_LOADED__) return;
  window.__VAGASZAP_LI_LOADED__ = true;

  const MODAL = ".artdeco-modal, .jobs-easy-apply-modal, .jobs-easy-apply-content, #artdeco-modal-outlet";
  const LOADER = ".artdeco-loader, .artdeco-loader--loading, [data-test-artdeco-loader], .jobs-loader";

  let currentProfile = null;
  let abortFlag = false;
  let batchRunning = false;

  // ---------- MiniMax API (mesma chave do backend) -------------------------
  const MINIMAX_URL = "https://api.minimaxi.chat/v1/text/chatcompletion_v2";
  const MINIMAX_KEY =
    "sk-cp-meaN0PHZdGi3-5gZffia9b6PyDIh27vyk54LwG6gw965dFLWoIHowFo19rTqoHdbxhaQezJlMMBgTEYhNni51sJnMWCcPHIKtCg4GRY-pGMmrXarNIxxGQA";

  async function askMinimax(system, user, maxTokens = 250) {
    try {
      const resp = await fetch(MINIMAX_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + MINIMAX_KEY,
        },
        body: JSON.stringify({
          model: "MiniMax-M2.5",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.2,
          max_tokens: maxTokens,
        }),
      });
      const data = await resp.json();
      return data?.choices?.[0]?.message?.content?.trim() || "";
    } catch (_) {
      return "";
    }
  }

  // ---------- Heuristica de resposta ---------------------------------------
  function heuristicAnswer(label, profile) {
    const lbl = (label || "").toLowerCase();
    if (!lbl) return null;
    if (lbl.includes("first name") || lbl.includes("primeiro nome"))
      return (profile.full_name || "").split(" ")[0];
    if (lbl.includes("last name") || lbl.includes("sobrenome"))
      return ((profile.full_name || "").split(" ").slice(1).join(" "));
    if (lbl.includes("email") || lbl.includes("e-mail"))
      return profile.email || "";
    if (lbl.includes("phone") || lbl.includes("telefone") || lbl.includes("mobile") || lbl.includes("celular"))
      return profile.phone || "";
    if (lbl.includes("linkedin")) return profile.linkedin || "";
    if (lbl.includes("city") || lbl.includes("cidade") || lbl.includes("location"))
      return profile.location || "São Paulo, Brasil";
    if (lbl.includes("authorized") || lbl.includes("legally") || lbl.includes("work author"))
      return "Yes";
    if (lbl.includes("sponsorship") || lbl.includes("visa")) return "No";
    if (lbl.includes("relocate") || lbl.includes("relocation")) return "Yes";
    if (lbl.includes("years") && lbl.includes("experience"))
      return String(profile.years_experience || 4);
    if (lbl.includes("salary") || lbl.includes("salár") || lbl.includes("compensation") || lbl.includes("remunera"))
      return profile.salary_expectation || "A combinar";
    if (lbl.includes("available") || lbl.includes("notice") || lbl.includes("start date") || lbl.includes("disponibilidade"))
      return profile.availability || "Immediate";
    if (lbl.includes("agree") || lbl.includes("concordo") || lbl.includes("consent")
        || lbl.includes("acknowledge") || lbl.includes("confirm") || lbl.includes("terms"))
      return "Yes";
    return null;
  }

  // ---------- Helpers de UI / DOM ------------------------------------------
  function $all(root, sel) { return Array.from((root || document).querySelectorAll(sel)); }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function waitForLoaderGone() {
    try {
      const el = document.querySelector(LOADER);
      if (el) await el.waitFor?.({ state: "hidden", timeout: 7000 });
    } catch (_) {}
  }

  function dispatchReact(el, value) {
    try {
      const proto = el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc?.set) desc.set.call(el, value); else el.value = value;
      if (el._valueTracker) el._valueTracker.setValue("");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    } catch (_) {}
  }

  async function fillInput(inp, value) {
    try {
      const proto = Object.getPrototypeOf(inp) === HTMLTextAreaElement.prototype
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc?.set) desc.set.call(inp, value); else inp.value = value;
      if (inp._valueTracker) inp._valueTracker.setValue("");
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
      inp.dispatchEvent(new Event("blur", { bubbles: true }));
      return true;
    } catch (_) {
      return false;
    }
  }

  async function selectNativeOption(sel, value) {
    try {
      const opts = Array.from(sel.options).filter((o) => o.value);
      const tgt = value.toLowerCase();
      let chosen = opts.find((o) => o.text.toLowerCase().trim() === tgt);
      if (!chosen) chosen = opts.find((o) => o.text.toLowerCase().includes(tgt.slice(0, 10)));
      if (!chosen) chosen = opts[0];
      if (chosen) {
        sel.value = chosen.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    } catch (_) {}
    return false;
  }

  function getLabelFor(el) {
    try {
      let l = el.labels?.[0]?.innerText || el.placeholder || el.getAttribute("aria-label") || "";
      if (!l) {
        const g = el.closest(".fb-dash-form-element, label, fieldset, .form-field, [class*='question']");
        if (g) l = g.querySelector("label, legend, span, p")?.innerText || "";
      }
      return (l || "").trim();
    } catch (_) { return ""; }
  }

  async function fillCurrentStep(profile) {
    await waitForLoaderGone();
    const modal = document.querySelector(MODAL);
    const scope = modal || document;

    // ----- inputs simples -----
    const inputs = $all(scope, "input[type='text'], input[type='email'], input[type='tel'], input[type='number'], textarea");
    for (const inp of inputs) {
      if (!inp.offsetParent) continue;
      let cur = "";
      try { cur = inp.value || ""; } catch (_) {}
      if (cur.trim()) continue;
      const lbl = getLabelFor(inp);
      const ans = heuristicAnswer(lbl, profile);
      if (ans != null) {
        try { await fillInput(inp, String(ans)); } catch (_) { dispatchReact(inp, String(ans)); }
      }
    }

    // ----- selects nativos -----
    const selects = $all(scope, "select");
    for (const sel of selects) {
      if (!sel.offsetParent) continue;
      if ((sel.value || "") && sel.value.trim() !== "Select an option" && sel.value.trim() !== "Selecionar opção") continue;
      const lbl = (getLabelFor(sel) || "").toLowerCase();
      const ans = heuristicAnswer(lbl, profile);
      if (ans == null) continue;
      await selectNativeOption(sel, String(ans));
    }

    // ----- radios (Yes/No) -----
    const fieldsets = $all(scope, ".fb-dash-form-element fieldset, fieldset");
    for (const fs of fieldsets) {
      const radios = $all(fs, "input[type='radio']");
      if (!radios.length) continue;
      if (radios.some((r) => r.checked)) continue;
      const legend = (fs.querySelector("legend, .fb-dash-form-element__label")?.innerText || "").trim();
      const lblLow = legend.toLowerCase();
      let pickValue = null;
      if (lblLow.includes("sponsor") || lblLow.includes("visa")) pickValue = "no";
      else if (lblLow.includes("authorized") || lblLow.includes("legally") || lblLow.includes("relocate")) pickValue = "yes";
      else if (lblLow.includes("agree") || lblLow.includes("acknowledge") || lblLow.includes("termo") || lblLow.includes("consent") || lblLow.includes("confirm")) pickValue = "yes";
      if (pickValue == null) continue;
      // escolhe o radio cujo label inclui o value
      for (const r of radios) {
        const lblText = ((r.closest("label")?.innerText) || (document.querySelector(`label[for="${r.id}"]`)?.innerText) || r.value || "").toLowerCase();
        if (lblText.includes(pickValue)) {
          try { r.click(); } catch (_) {}
          r.checked = true;
          r.dispatchEvent(new Event("change", { bubbles: true }));
          break;
        }
      }
    }

    // ----- checkboxes de consentimento -----
    const consents = ["concordo", "agree", "acknowledge", "li ", "aceito", "declaro", "entendo",
                      "autorizo", "confirm", "terms", "consent", "privacy", "verdade", "truthful", "accurate"];
    const cbs = $all(scope, ".fb-dash-form-element input[type='checkbox'], [data-test-checkbox-form-component] input[type='checkbox']");
    for (const cb of cbs) {
      if (cb.checked) continue;
      if (!cb.offsetParent) continue;
      const parentText = (cb.closest(".fb-dash-form-element, label, [data-test-checkbox-form-component]")?.innerText || "").toLowerCase();
      if (consents.some((k) => parentText.includes(k))) {
        try { cb.click(); } catch (_) {}
        cb.checked = true;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    // ----- textareas sem label -> IA -----
    const textareas = $all(scope, "textarea");
    for (const ta of textareas) {
      if (!ta.offsetParent) continue;
      let cur = "";
      try { cur = ta.value || ""; } catch (_) {}
      if (cur.trim()) continue;
      const lbl = getLabelFor(ta);
      if (!lbl) continue;
      if (heuristicAnswer(lbl, profile) != null) continue;
      const ans = await askMinimax(
        "You answer LinkedIn Easy Apply questions concisely (1-2 sentences) in English.",
        `Question: ${lbl}\nProfile: ${profile.full_name} - ${profile.top_skills?.slice(0,5).join(", ")}\nAnswer the question directly.`,
        200
      );
      if (ans && ans.length >= 5) {
        await fillInput(ta, ans);
      }
    }
  }

  async function findStepButton(kind) {
    const modal = document.querySelector(MODAL);
    const scope = modal || document;
    let texts = [];
    if (kind === "submit") texts = ["submit application", "enviar candidatura", "send application"];
    else if (kind === "review") texts = ["review", "revisar"];
    else texts = ["next", "continue", "avançar", "próximo", "save & continue", "next step"];
    for (const t of texts) {
      const btns = $all(scope, "button");
      const b = btns.find((b) => (b.innerText || "").trim().toLowerCase().includes(t) && b.offsetParent);
      if (b) return b;
    }
    return null;
  }

  async function detectSuccess() {
    try {
      if (location.href.toLowerCase().includes("/applied")) return true;
      if (document.querySelector("h1#application_submitted, [data-test-icon='signal-success'], .artdeco-inline-feedback--success, [data-marker='confirmation']")) return true;
      const txt = (document.body?.innerText || "").toLowerCase();
      return /\b(application submitted|application was sent|application sent|thanks for applying|application received|candidatura enviada|sua candidatura foi enviada|obrigado por se candidatar)\b/.test(txt);
    } catch (_) { return false; }
  }

  async function applyOnce(profile, jobMeta) {
    const maxSteps = 18;
    let lastQuestionsCount = -1;
    let sameRepeat = 0;
    for (let step = 0; step < maxSteps; step++) {
      if (abortFlag) return { status: "ABORTED" };
      await sleep(700);
      if (await detectSuccess()) return { status: "APPLIED" };
      try {
        await waitForLoaderGone();
      } catch (_) {}
      await fillCurrentStep(profile);

      let btn = await findStepButton("submit");
      if (!btn) btn = await findStepButton("review");
      if (!btn) btn = await findStepButton("next");
      if (!btn) {
        await sleep(2000);
        if (await detectSuccess()) return { status: "APPLIED" };
        return { status: "NO_BUTTON" };
      }
      try {
        btn.scrollIntoView();
        await sleep(200);
        btn.click();
      } catch (_) {
        try { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })); } catch (_) {}
      }
      await sleep(2000);

      // Guarda contra loop
      const same = modalHasSameErrors();
      if (same) {
        sameRepeat++;
        if (sameRepeat > 3) return { status: "STUCK_LOOP" };
      } else {
        sameRepeat = 0;
      }
    }
    return { status: "INCOMPLETE" };
  }

  function modalHasSameErrors() {
    try {
      const errs = document.querySelectorAll("[data-test-form-element-error-message], .artdeco-inline-feedback--error, .fb-dash-form-element__error");
      return errs.length > 0;
    } catch (_) { return false; }
  }

  async function runOne(job, profile) {
    const result = await applyOnce(profile, job);
    try {
      chrome.runtime.sendMessage({
        type: "VAGASZAP_APPLY_DONE",
        jobId: job.id || location.href,
        job,
        result,
      });
    } catch (_) {}
    return result;
  }

  async function runBatch(profile, maxJobs) {
    batchRunning = true;
    abortFlag = false;
    let applied = 0, skipped = 0, errors = 0;
    while (batchRunning && applied < maxJobs && !abortFlag) {
      // pega todos os cards visiveis na pagina de busca
      const cards = $all(document, "li[data-occludable-job-card], .job-card-container, .jobs-search-results__list-item");
      // filtra cards ja processados
      const fresh = cards.filter((c) => {
        const id = (c.getAttribute("data-id") || "") + c.innerText;
        return !sessionStorage.getItem("vz_done_" + btoa(id).slice(0, 16));
      });
      let card = fresh[0];
      if (!card) {
        // scroll e tenta de novo
        window.scrollBy(0, 800);
        await sleep(1500);
        continue;
      }
      // cardId
      const cardId = (card.getAttribute("data-id") || btoa(card.innerText).slice(0, 16));
      sessionStorage.setItem("vz_done_" + cardId, "1");
      // click no card para abrir a vaga
      const link = card.querySelector("a.job-card-container__link, a[href*='/jobs/view/']");
      if (!link) { errors++; continue; }
      link.click();
      await sleep(3500);

      const ok = await applyOnce(profile, { id: cardId, title: card.querySelector("h3, .job-card-list__title")?.innerText || "", company: card.querySelector(".job-card-container__company-name, .job-card-company")?.innerText || "", applicationLink: location.href });
      if (ok.status === "APPLIED") applied++;
      else if (ok.status === "NO_EASY_APPLY") skipped++;
      else errors++;

      // volta para a busca
      history.back();
      await sleep(3000);
    }
    batchRunning = false;
    return { applied, skipped, errors };
  }

  // ---------- Mensagens vindas do background -------------------------------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      try {
        if (msg?.type === "VAGASZAP_PROFILE_UPDATED") {
          currentProfile = msg.profile;
          sendResponse({ ok: true });
          return;
        }
        if (msg?.type === "VAGASZAP_START_APPLY") {
          currentProfile = msg.profile;
          await sleep(2500); // aguarda pagina carregar
          const res = await runOne(msg.job, msg.profile);
          sendResponse({ ok: true, result: res });
          return;
        }
        if (msg?.type === "VAGASZAP_START_BATCH") {
          currentProfile = msg.profile;
          await sleep(3000);
          const res = await runBatch(msg.profile, msg.maxJobs || 10);
          sendResponse({ ok: true, result: res });
          return;
        }
        sendResponse({ ok: false });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  });

  // Anuncia para a pagina
  document.documentElement.setAttribute("data-vagaszap-extension", "linkedin-installed");
})();
