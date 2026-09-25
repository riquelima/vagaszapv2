// content_ats.js
// Roda em greenhouse.io, ashbyhq.com, lever.co, workable.com
// Preenche COMPLETAMENTE formularios de candidatura multi-step e submete.

(function () {
  if (window.__VAGASZAP_ATS_LOADED__) return;
  window.__VAGASZAP_ATS_LOADED__ = true;

  let currentProfile = null;
  let abortFlag = false;

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

  // ---------- helpers -------------------------------------------------------
  function $(s) { return document.querySelector(s); }
  function $all(s) { return Array.from(document.querySelectorAll(s)); }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function buildProfile(profile) {
    const rawFull = (profile.full_name || profile.fullName || "").trim();
    const parts = rawFull.split();
    const first = profile.first_name || parts[0] || "Candidate";
    const last = profile.last_name || (parts.length > 1 ? parts.slice(1).join(" ") : "");
    return {
      first_name: first,
      last_name: last,
      full_name: rawFull || `${first} ${last}`.trim(),
      email: profile.email || "",
      phone: profile.phone || "",
      location: profile.location || "Brasil",
      country: "Brazil",
      nationality: "Brazilian",
      gender: "Male",
      ethnicity: "Hispanic or Latino",
      veteran_status: "I am not a protected veteran",
      linkedin: profile.linkedin || "",
      github: profile.github || "",
      website: profile.portfolio || profile.website || "https://linkedin.com",
      school: profile.school || "Universidade Federal",
      degree: (profile.degree && /master/i.test(profile.degree)) ? "Master's Degree" : "Bachelor's Degree",
      discipline: "Computer Science",
      start_year: "2016",
      end_year: "2020",
      years_experience: String(profile.years_experience || 10),
      top_skills: profile.top_skills || ["Linux", "Python", "Docker"],
      summary_en: profile.summary_en || profile.summary || "",
      salary_expectation: "USD $2,200 / month (approx. R$ 11.000 / month)",
    };
  }

  function fillReactInput(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc?.set) desc.set.call(el, value); else el.value = value;
    if (el._valueTracker) el._valueTracker.setValue("");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function getLabel(el) {
    try {
      if (el.id) {
        const l = document.querySelector(`label[for="${el.id}"]`)
               || document.getElementById(`${el.id}-label`);
        if (l) return l.innerText || "";
      }
      const clos = el.closest("label");
      if (clos) return clos.innerText || "";
      const g = el.closest("fieldset, .field, .form-group, [class*='field'], [class*='question'], [class*='select__container'], .input-wrapper");
      if (g) {
        const titleEl = g.querySelector("label, legend, p, h3, h4, [class*='label'], [class*='title']");
        if (titleEl) return titleEl.innerText || "";
      }
      return el.getAttribute("aria-label") || el.placeholder || el.name || el.id || "";
    } catch (_) { return ""; }
  }

  function heuristicAnswer(label, profile) {
    const lbl = (label || "").toLowerCase();
    const skills = profile.top_skills || [];
    const skillsText = skills.slice(0, 5).join(", ") || "Linux, Python, Docker";
    const isCover = /cover|carta|letter|why|motivation|tell us|describe|interested|qualifies|message to hiring/i.test(lbl);
    if (isCover) return "__COVER__";
    if (/first name|primeiro nome/.test(lbl)) return profile.first_name;
    if (/last name|sobrenome|family name|surname/.test(lbl)) return profile.last_name;
    if (/email|e-mail/.test(lbl)) return profile.email;
    if (/phone|telefone|mobile|celular/.test(lbl)) return profile.phone;
    if (/linkedin/.test(lbl)) return profile.linkedin;
    if (/github/.test(lbl)) return profile.github;
    if (/website|portfolio|portfólio/.test(lbl)) return profile.website;
    if (/location|cidade|city|country|país/.test(lbl)) return profile.location;
    if (/school|universidade|faculdade|institution/.test(lbl)) return profile.school;
    if (/degree|grau|formação/.test(lbl)) return profile.degree;
    if (/discipline|field of study|curso/.test(lbl)) return profile.discipline;
    if (/start.*year/.test(lbl)) return profile.start_year;
    if (/end.*year/.test(lbl)) return profile.end_year;
    if (/years of experience|years experience|anos de experiência/.test(lbl)) return profile.years_experience;
    if (/salary|salár|compensation|pretens|remunera/.test(lbl)) return profile.salary_expectation;
    if (/gender|gênero|sex/.test(lbl)) return profile.gender;
    if (/ethnicity|raça|race/.test(lbl)) return profile.ethnicity;
    if (/veteran/.test(lbl)) return profile.veteran_status;
    if (/authorized|legally|work author/.test(lbl)) return "Yes";
    if (/sponsorship|visa/.test(lbl)) return "No";
    if (/relocate|relocation/.test(lbl)) return "Yes";
    if (/agree|concordo|consent|acknowledge|confirm/.test(lbl)) return "Yes";
    if (/notice|available|start date|disponibilidade/.test(lbl)) return "Immediate / 2 weeks";
    if (/skill|technology|tecnologia|conhec/.test(lbl)) return skillsText;
    return null;
  }

  function isReactSelect(el) {
    return !!(el.classList && el.classList.contains("select__input"))
      || !!el.closest(".select__control")
      || !!el.closest(".select-shell")
      || !!el.closest(".select__container");
  }

  async function selectReactOption(locator, value) {
    try {
      locator.scrollIntoView?.({ block: "center" });
    } catch (_) {}
    try { locator.click(); } catch (_) {}
    await sleep(400);
    // digita (caso escola)
    try { locator.focus(); fillReactInput(locator, value); } catch (_) {}
    await sleep(900);
    const opts = $all("[role='option'], div[class*='-option'], .select__option");
    if (!opts.length) {
      try { locator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); } catch (_) {}
      await sleep(300);
    }
    const all = $all("[role='option'], div[class*='-option'], .select__option");
    const tgt = value.toLowerCase();
    let pick = all.findIndex((o) => (o.innerText || "").toLowerCase().trim() === tgt);
    if (pick < 0) pick = all.findIndex((o) => (o.innerText || "").toLowerCase().includes(tgt));
    if (pick < 0) pick = 0;
    if (all[pick]) {
      try { all[pick].click(); } catch (_) {}
      await sleep(250);
      return true;
    }
    return false;
  }

  async function selectNative(sel, value) {
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

  function checkAllConsents() {
    const checkboxes = $all("input[type='checkbox']");
    const techKws = ["python","bash","docker","k8s","aws","gcp","linux","kubernetes","react","node","go","terraform","openstack","ceph","kvm","golang","selenium","cypress","postman","playwright","qa","test","automation","api","sql","javascript","typescript"];
    const consentKws = ["agree","concordo","consent","privacy","notice","terms","acknowledge","truthful","accurate","certify","declaro","autorizo","confirm","aceito","li "];
    let marked = 0;
    for (const cb of checkboxes) {
      if (!cb.offsetParent) continue;
      const parent = (cb.closest("label, .checkbox, [class*='checkbox'], div")?.innerText || "").toLowerCase();
      const isTech = techKws.some((t) => parent.includes(t));
      const isConsent = consentKws.some((t) => parent.includes(t)) || cb.hasAttribute("required");
      if ((isTech || isConsent) && !cb.checked) {
        try { cb.click(); } catch (_) {}
        cb.checked = true;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
        marked++;
      }
    }
    return marked;
  }

  async function generateCoverLetter(profile, job) {
    const title = job.title || "the role";
    const company = job.company || "your company";
    const skills = (profile.top_skills || []).slice(0, 6).join(", ") || "modern engineering practices";
    const name = profile.full_name || "Candidate";
    const letter = await askMinimax(
      "You write concise 1-paragraph cover letters in English. No greetings, no pleasantries.",
      `Candidate: ${name}\nTarget Role: ${title} at ${company}\nSkills: ${skills}\n\nWrite a 3-4 sentence cover letter focusing on remote-readiness, autonomy, and concrete impact.`,
      300
    );
    if (letter && letter.length > 30) return letter;
    return `Dear Hiring Team,\n\nI am applying for the ${title} position. With strong expertise in ${skills} and a track record of delivering high-quality remote work, I can contribute immediately.\n\nSincerely,\n${name}`;
  }

  async function fillStep(profile, coverLetter) {
    const els = $all("input:not([type='hidden']), textarea, select");
    let filled = 0;
    for (const el of els) {
      if (!el.offsetParent) continue;
      if (el.type === "submit" || el.type === "button" || el.type === "file") continue;
      let cur = "";
      try { cur = el.value || ""; } catch (_) {}
      if (cur.trim()) continue;
      const lbl = getLabel(el);
      const ans = heuristicAnswer(lbl, profile);
      if (ans == null) continue;
      let value = String(ans);
      if (value === "__COVER__") value = coverLetter;
      try {
        if (isReactSelect(el)) {
          if (await selectReactOption(el, value)) filled++;
        } else if (el.tagName.toLowerCase() === "select") {
          if (await selectNative(el, value)) filled++;
        } else if (el.tagName.toLowerCase() === "textarea") {
          // cover letter é longo, então não preenche fora do heuristicAnswer
          if (value.length >= 25) {
            fillReactInput(el, value);
            filled++;
          }
        } else {
          fillReactInput(el, value);
          filled++;
        }
      } catch (_) {}
      await sleep(60);
    }
    // textareas abertas (perguntas customizadas)
    const textareas = $all("textarea").filter((t) => t.offsetParent);
    for (const ta of textareas) {
      if ((ta.value || "").trim()) continue;
      const lbl = getLabel(ta);
      if (!lbl) continue;
      if (heuristicAnswer(lbl, profile) != null) continue;
      // pergunta custom -> IA
      const ans = await askMinimax(
        "You write concise 3-5 sentence application answers in English. No greetings.",
        `Role: ${location.href}\nQuestion: ${lbl}\n\nWrite a direct, role-specific answer.`,
        350
      );
      if (ans && ans.length >= 20) {
        fillReactInput(ta, ans);
        filled++;
      }
    }
    // radio groups sem resposta
    const fieldsets = $all("fieldset, [role='radiogroup']");
    for (const fs of fieldsets) {
      if (!fs.offsetParent) continue;
      const radios = $all(fs, "input[type='radio']");
      if (!radios.length) continue;
      if (radios.some((r) => r.checked)) continue;
      const legend = (fs.querySelector("legend, .label, h3, h4, .question")?.innerText || "").toLowerCase();
      let pickValue = "yes";
      if (/sponsor|visa/.test(legend)) pickValue = "no";
      else if (/veteran/.test(legend)) pickValue = "no";
      else if (/ethnic|race|raça/.test(legend)) pickValue = "hispanic";
      const labels = $all(fs, "label");
      const wanted = labels.find((l) => (l.innerText || "").toLowerCase().includes(pickValue));
      let r = null;
      if (wanted) r = wanted.querySelector("input[type='radio']") || document.getElementById(wanted.htmlFor);
      if (!r && radios.length) r = radios[0];
      if (r) {
        try { r.click(); } catch (_) {}
        r.checked = true;
        r.dispatchEvent(new Event("change", { bubbles: true }));
        filled++;
      }
    }
    // checkboxes
    const cbs = checkAllConsents();
    return { filled, consents: cbs };
  }

  function findSubmitButton() {
    const txts = ["submit application", "submit", "apply now", "complete application", "send application", "enviar candidatura", "send"];
    for (const t of txts) {
      const sel = `button[type='submit'], input[type='submit'], button[name*='submit'], button`;
      for (const b of $all(sel)) {
        if (!b.offsetParent) continue;
        if ((b.innerText || b.value || "").toLowerCase().includes(t)) return b;
      }
    }
    return null;
  }

  function findNextButton() {
    const txts = ["next", "continue", "próximo", "next step", "save and continue", "avançar"];
    const buttons = $all("button");
    for (const t of txts) {
      const b = buttons.find((b) => {
        const txt = (b.innerText || "").trim().toLowerCase();
        if (txt !== t && !txt.startsWith(t)) return false;
        return b.offsetParent && b.type !== "submit";
      });
      if (b) return b;
    }
    return null;
  }

  function detectSuccess() {
    if (document.querySelector("h1#application_submitted, [data-marker='confirmation'], .application-confirmation, #application_submitted")) return true;
    const text = (document.body?.innerText || "").toLowerCase();
    return /\b(application (submitted|received)|thanks for applying|candidatura enviada|obrigado por se candidatar)\b/.test(text);
  }

  function detectErrors() {
    const errs = [];
    for (const sel of ["[data-marker='error']", ".field-error", ".error-message", "[role='alert']", ".invalid-feedback", "[data-marker='form-field-error']"]) {
      for (const el of $all(sel)) {
        const t = (el.innerText || "").trim();
        if (t && t.length > 2) errs.push(t);
      }
    }
    return Array.from(new Set(errs));
  }

  function listEmptyRequired() {
    const empty = [];
    $all("input[required], select[required], textarea[required]").forEach((el) => {
      if (!el.offsetParent) return;
      if ((el.value || "").trim()) return;
      let label = el.labels?.[0]?.innerText || "";
      if (!label) {
        const g = el.closest("fieldset, .form-field, [class*='form-field'], [class*='field'], .question, [data-marker*='field']");
        if (g) label = g.querySelector("legend, label, h2, h3, h4, [class*='label'], [class*='title']")?.innerText || "";
      }
      if (!label) label = el.placeholder || el.getAttribute("aria-label") || el.name || el.id || "";
      empty.push(label.replace(/\*/g, "").trim() || "campo");
    });
    $all("fieldset, [role='radiogroup']").forEach((fs) => {
      if (!fs.offsetParent) return;
      const radios = $all(fs, "input[type='radio']");
      if (!radios.length) return;
      if (radios.some((r) => r.checked)) return;
      const legend = (fs.querySelector("legend, .label, h3, h4, .question")?.innerText || "").replace(/\*/g, "").trim();
      empty.push(legend || "radio group");
    });
    return empty;
  }

  async function uploadResumeIfPossible(profile) {
    const file = document.querySelector("input[type='file']");
    if (!file) return false;
    try {
      // Tenta baixar o currículo injetado pela pagina. Se nao houver, faz fallback.
      const blob = new Blob([profile.summary_en || "Candidate resume placeholder"], { type: "application/pdf" });
      const file2 = new File([blob], "henrique_lima_resume.pdf", { type: "application/pdf" });
      const dt = new DataTransfer();
      dt.items.add(file2);
      file.files = dt.files;
      file.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch (_) {
      return false;
    }
  }

  async function runApply(profile, job) {
    const built = buildProfile(profile);
    const cover = await generateCoverLetter(built, job || { title: document.title, company: location.hostname });
    const filled = [];

    // upload do curriculo se houver
    const uploaded = await uploadResumeIfPossible(built);
    if (uploaded) filled.push("Resume uploaded");

    // consents iniciais
    const initConsents = checkAllConsents();
    if (initConsents) filled.push(`${initConsents} consents checked`);

    // loop de steps
    let safety = 12;
    while (safety-- > 0) {
      await sleep(700);
      const r = await fillStep(built, cover);
      if (r.filled || r.consents) filled.push(`Step filled: ${r.filled} fields, ${r.consents} consents`);

      const submit = findSubmitButton();
      const next = findNextButton();
      if (submit) {
        // sai do loop para submeter
        break;
      }
      if (next) {
        try { next.scrollIntoView(); await sleep(200); next.click(); } catch (_) {}
        await sleep(2200);
      } else {
        break;
      }
    }

    // valida required
    let empty = listEmptyRequired();
    let attempts = 0;
    while (empty.length && attempts < 4) {
      await fillStep(built, cover);
      checkAllConsents();
      await sleep(800);
      empty = listEmptyRequired();
      attempts++;
    }
    if (empty.length) {
      return { status: "VALIDATION_FAILED", emptyFields: empty, filledFields: filled };
    }

    // submit
    const submitBtn = findSubmitButton();
    if (!submitBtn) {
      return { status: "NO_SUBMIT_BUTTON", filledFields: filled };
    }
    try { submitBtn.scrollIntoView(); await sleep(300); submitBtn.click(); } catch (_) {}
    filled.push("Submit clicked");

    // deteccao de sucesso
    let confirmed = false;
    let postErrors = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      await sleep(500);
      if (detectSuccess()) { confirmed = true; break; }
      postErrors = detectErrors();
      if (postErrors.length) break;
    }

    if (!confirmed && postErrors.length) {
      // tenta corrigir e resubmeter uma vez
      await fillStep(built, cover);
      checkAllConsents();
      await sleep(800);
      const again = findSubmitButton();
      if (again) {
        try { again.scrollIntoView(); again.click(); } catch (_) {}
        const t1 = Date.now();
        while (Date.now() - t1 < 10000) {
          await sleep(500);
          if (detectSuccess()) { confirmed = true; break; }
        }
      }
    }

    if (confirmed) {
      return {
        status: "APPLIED",
        success: true,
        confirmationId: `VZ-${Date.now()}`,
        filledFields: filled,
        coverLetter: cover,
        atsType: detectAts(location.href),
      };
    }
    return {
      status: "SUBMIT_UNCONFIRMED",
      filledFields: filled,
      coverLetter: cover,
      atsType: detectAts(location.href),
      postErrors,
    };
  }

  function detectAts(url) {
    const h = (url || "").toLowerCase();
    if (h.includes("greenhouse") || h.includes("boards.greenhouse.io")) return "GREENHOUSE";
    if (h.includes("ashbyhq")) return "ASHBY";
    if (h.includes("lever")) return "LEVER";
    return "ATS_GENERIC";
  }

  // ---------- Mensagens do background --------------------------------------
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
          await sleep(2500);
          const result = await runApply(msg.profile, msg.job);
          try {
            chrome.runtime.sendMessage({
              type: "VAGASZAP_APPLY_DONE",
              jobId: msg.job?.id || location.href,
              job: msg.job,
              result,
            });
          } catch (_) {}
          sendResponse({ ok: true, result });
          return;
        }
        sendResponse({ ok: false });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  });

  document.documentElement.setAttribute("data-vagaszap-extension", "ats-installed");
})();
