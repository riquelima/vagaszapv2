// background.js - Service Worker (MV3)
//
// Coordena:
// - Recebe o perfil sincronizado do site VagasZap via window.postMessage
// - Recebe pedido de auto-apply do site e abre nova aba na plataforma certa
// - Repassa para o site (via tabs.sendMessage para localhost) o resultado de cada candidatura
//   para fechar o modal do site com o status final.

const PROFILE_KEY = "vagaszap_profile_v1";
const RUNNING_KEY = "vagaszap_running_jobs_v1";
const COMPLETED_KEY = "vagaszap_completed_jobs_v1";

function storageGet(key) {
  return new Promise((resolve) => chrome.storage.local.get(key, (data) => resolve(data[key])));
}
function storageSet(key, value) {
  return new Promise((resolve) => chrome.storage.local.set({ [key]: value }, () => resolve()));
}

async function getProfile() { return (await storageGet(PROFILE_KEY)) || null; }
async function getCompleted() { return (await storageGet(COMPLETED_KEY)) || {}; }

async function markCompleted(jobId, info) {
  const all = await getCompleted();
  all[jobId] = { ...(all[jobId] || {}), ...info, at: Date.now() };
  await storageSet(COMPLETED_KEY, all);
}

// Envia update para o site vagaszap (localhost / dominio configurado) com o resumo
async function notifySite(payload) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (!t.id || !t.url) continue;
      if (
        t.url.startsWith("http://localhost") ||
        t.url.startsWith("http://127.0.0.1") ||
        t.url.includes("vagaszap") ||
        t.url.includes("3000")
      ) {
        try {
          await chrome.tabs.sendMessage(t.id, payload);
        } catch (_) {}
      }
    }
  } catch (_) {}
}

function isAtsUrl(url) {
  const h = (url || "").toLowerCase();
  return h.includes("greenhouse.io") || h.includes("boards.greenhouse.io")
      || h.includes("ashbyhq.com") || h.includes("lever.co") || h.includes("workable.com");
}

function isLinkedinJobUrl(url) {
  const h = (url || "").toLowerCase();
  return h.includes("linkedin.com/jobs/");
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "VAGASZAP_SAVE_PROFILE") {
        await storageSet(PROFILE_KEY, msg.profile);
        broadcastProfile(msg.profile);
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "VAGASZAP_GET_PROFILE") {
        sendResponse({ ok: true, profile: await getProfile() });
        return;
      }
      if (msg?.type === "VAGASZAP_GET_COMPLETED") {
        sendResponse({ ok: true, completed: await getCompleted() });
        return;
      }
      if (msg?.type === "VAGASZAP_GET_STATUS") {
        sendResponse({
          ok: true,
          profile: await getProfile(),
          completed: await getCompleted(),
          running: (await storageGet(RUNNING_KEY)) || {},
        });
        return;
      }

      // ===== AUTO-APPLY UMA VAGA ATS (clique em card do site) =====
      if (msg?.type === "VAGASZAP_AUTO_APPLY_JOB") {
        const profile = await getProfile();
        if (!profile) { sendResponse({ ok: false, error: "Perfil ausente" }); return; }
        const job = msg.job || {};
        const url = job.applicationLink || job.link || "";
        if (!url) { sendResponse({ ok: false, error: "Vaga sem URL" }); return; }
        const tab = await chrome.tabs.create({ url, active: true });
        await new Promise((r) => setTimeout(r, 2500));
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: "VAGASZAP_START_APPLY",
            job,
            profile,
            originTabId: sender?.tab?.id,
          });
        } catch (e) {
          // A aba ainda está carregando. Tenta em background.
          setTimeout(async () => {
            try { await chrome.tabs.sendMessage(tab.id, { type: "VAGASZAP_START_APPLY", job, profile, originTabId: sender?.tab?.id }); } catch (_) {}
          }, 4000);
        }
        // Notifica IMEDIATAMENTE o site que a aba está aberta
        if (sender?.tab?.id) {
          try {
            await chrome.tabs.sendMessage(sender.tab.id, {
              type: "VAGASZAP_TAB_OPENED",
              atsType: isAtsUrl(url) ? "ATS" : "OTHER",
              url,
            });
          } catch (_) {}
        }
        sendResponse({ ok: true, tabId: tab.id });
        return;
      }

      // ===== LINKEDIN BATCH =====
      if (msg?.type === "VAGASZAP_LINKEDIN_BATCH") {
        const profile = await getProfile();
        if (!profile) { sendResponse({ ok: false, error: "Perfil ausente." }); return; }
        const maxJobs = msg.maxJobs || 999;
        const searchUrl = msg.searchUrl
          || "https://www.linkedin.com/jobs/search/?keywords=QA+Engineer&location=Brazil&f_AL=true&f_WT=2";
        const tab = await chrome.tabs.create({ url: searchUrl, active: true });
        // Notifica o site imediatamente
        if (sender?.tab?.id) {
          try {
            await chrome.tabs.sendMessage(sender.tab.id, {
              type: "VAGASZAP_LINKEDIN_OPENED",
              tabId: tab.id,
              url: searchUrl,
            });
          } catch (_) {}
        }
        // Aguarda aba carregar e dispara o batch
        await new Promise((r) => setTimeout(r, 3000));
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: "VAGASZAP_START_BATCH",
            profile,
            maxJobs,
          });
        } catch (e) {
          setTimeout(async () => {
            try {
              await chrome.tabs.sendMessage(tab.id, { type: "VAGASZAP_START_BATCH", profile, maxJobs });
            } catch (_) {}
          }, 4000);
        }
        sendResponse({ ok: true, tabId: tab.id });
        return;
      }

      // ===== FIM DE UMA APLICACAO (vindo do content script) =====
      if (msg?.type === "VAGASZAP_APPLY_DONE") {
        await markCompleted(msg.jobId || msg.job?.id || "unknown", msg.result || {});
        // Repassa para o site (localhost) para fechar o modal
        const atsType = isAtsUrl(msg.job?.applicationLink || "")
          ? "ATS"
          : (msg.job?.applicationLink || "").toLowerCase().includes("linkedin.com") ? "LINKEDIN" : "OTHER";
        await notifySite({
          type: "VAGASZAP_APPLY_COMPLETED",
          data: {
            confirmationId: msg.result?.confirmationId || `VZ-${Date.now()}`,
            company: msg.job?.company || "",
            title: msg.job?.title || "",
            atsType,
            status: msg.result?.status || "DONE",
            success: msg.result?.success !== false,
            filledFields: msg.result?.filledFields || [],
            coverLetter: msg.result?.coverLetter || "",
          },
        });
        sendResponse({ ok: true });
        return;
      }

      // ===== FIM DO BATCH =====
      if (msg?.type === "VAGASZAP_BATCH_DONE") {
        await notifySite({
          type: "VAGASZAP_BATCH_COMPLETED",
          data: { applied: msg.applied || 0, skipped: msg.skipped || 0, errors: msg.errors || 0 },
        });
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "VAGASZAP_OPEN_LINKEDIN_SEARCH") {
        await chrome.tabs.create({ url: "https://www.linkedin.com/jobs/search/?keywords=QA+Engineer&location=Brazil&f_AL=true&f_WT=2", active: true });
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "VAGASZAP_OPEN_ATS_GUIDE") {
        await chrome.tabs.create({ url: chrome.runtime.getURL("guide.html"), active: true });
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: "Mensagem desconhecida: " + msg?.type });
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();
  return true;
});

async function broadcastProfile(profile) {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.id) continue;
    chrome.tabs.sendMessage(t.id, { type: "VAGASZAP_PROFILE_UPDATED", profile }).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("guide.html") });
});
