// content_bridge.js
// Roda dentro do site VagasZap. Faz a ponte entre o React (page.tsx)
// e o background.js da extensao. Recebe TAMBÉM mensagens vindas do background
// (chrome.runtime.sendMessage) e as reencaminha para o app via window.postMessage.

(function () {
  if (window.__VAGASZAP_BRIDGE_LOADED__) return;
  window.__VAGASZAP_BRIDGE_LOADED__ = true;

  function isExtAvailable() {
    return !!(window).__VAGASZAP_EXTENSION_READY__
      || document.documentElement.getAttribute("data-vagaszap-extension") === "installed"
      || document.documentElement.getAttribute("data-vagaszap-bridge") === "loaded";
  }

  // ---- Mensagens vindas DO EXTENSAO → propagar para a pagina -------------
  // Em MV3, extensões usam chrome.tabs.sendMessage. O content_bridge recebe
  // e repassa via window.postMessage para o React escutar.
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || typeof msg !== "object") return false;
      // Mensagens de atualização da própria extensão → repassar
      const forward = [
        "VAGASZAP_PROFILE_UPDATED",
        "VAGASZAP_TAB_OPENED",
        "VAGASZAP_LINKEDIN_OPENED",
        "VAGASZAP_APPLY_COMPLETED",
        "VAGASZAP_BATCH_COMPLETED",
      ];
      if (forward.includes(msg.type)) {
        window.postMessage(msg, "*");
      }
      sendResponse({ ok: true });
      return true;
    });
  } catch (_) {}

  // ---- Mensagens vindas DA PAGINA → propagar para a extensao -----------
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || typeof d !== "object") return;

    if (d.type === "VAGASZAP_PING") {
      if (isExtAvailable()) window.postMessage({ type: "VAGASZAP_EXTENSION_READY" }, "*");
      return;
    }
    if (d.type === "VAGASZAP_SYNC_PROFILE") {
      try { chrome.runtime.sendMessage({ type: "VAGASZAP_SAVE_PROFILE", profile: d.profile }, () => void chrome.runtime.lastError); } catch (_) {}
      return;
    }
    if (d.type === "VAGASZAP_TRIGGER_APPLY") {
      try { chrome.runtime.sendMessage({ type: "VAGASZAP_AUTO_APPLY_JOB", job: d.job }, () => void chrome.runtime.lastError); } catch (_) {}
      return;
    }
    if (d.type === "VAGASZAP_TRIGGER_LINKEDIN_BATCH") {
      try {
        chrome.runtime.sendMessage({
          type: "VAGASZAP_LINKEDIN_BATCH",
          profile: d.profile,
          maxJobs: d.maxJobs,
          searchUrl: d.searchUrl,
        }, () => void chrome.runtime.lastError);
      } catch (_) {}
      return;
    }
    if (d.type === "VAGASZAP_GET_PROFILE") {
      try {
        chrome.runtime.sendMessage({ type: "VAGASZAP_GET_PROFILE" }, (resp) => {
          if (resp?.ok) window.postMessage({ type: "VAGASZAP_PROFILE_RESPONSE", profile: resp.profile }, "*");
        });
      } catch (_) {}
      return;
    }
    if (d.type === "VAGASZAP_GET_COMPLETED") {
      try {
        chrome.runtime.sendMessage({ type: "VAGASZAP_GET_COMPLETED" }, (resp) => {
          if (resp?.ok) window.postMessage({ type: "VAGASZAP_COMPLETED_RESPONSE", completed: resp.completed }, "*");
        });
      } catch (_) {}
      return;
    }
  });

  document.documentElement.setAttribute("data-vagaszap-bridge", "loaded");
  // Anuncia imediatamente para o app que a ponte está pronta
  window.postMessage({ type: "VAGASZAP_EXTENSION_READY" }, "*");
})();
