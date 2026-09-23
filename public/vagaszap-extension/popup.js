// popup.js - controla o popup da extensão

function $(sel) { return document.querySelector(sel); }

async function loadStatus() {
  const resp = await chrome.runtime.sendMessage({ type: "VAGASZAP_GET_STATUS" });
  if (!resp?.ok) return;
  const profile = resp.profile;
  const completed = resp.completed || {};
  if (profile && profile.full_name) {
    $("#profilePill").className = "pill ok";
    $("#profilePill").textContent = "Pronto";
    $("#profileInfo").innerHTML =
      `<b style="color: var(--navy)">${profile.full_name}</b><br>` +
      `${profile.email || ""} ${profile.phone ? "· " + profile.phone : ""}<br>` +
      `<span style="color: var(--green); font-weight: 700;">Sincronizado com a extensão</span>`;
  } else {
    $("#profilePill").className = "pill warn";
    $("#profilePill").textContent = "Sem perfil";
  }
  let applied = 0, errors = 0;
  for (const id of Object.keys(completed)) {
    const r = completed[id];
    if (r?.result?.status === "APPLIED" || r?.success === true) applied++;
    else errors++;
  }
  $("#statApplied").textContent = applied;
  $("#statError").textContent = errors;
}

async function syncFromSite() {
  // Tenta pegar perfil do content_bridge da página ativa
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) return;
  await chrome.tabs.sendMessage(tabs[0].id, { type: "VAGASZAP_GET_PROFILE" });
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadStatus();

  $("#btnLinkedin").addEventListener("click", async () => {
    const resp = await chrome.runtime.sendMessage({ type: "VAGASZAP_LINKEDIN_BATCH", maxJobs: 999 });
    if (!resp?.ok) alert(resp?.error || "Falha ao iniciar. Sincronize seu perfil primeiro.");
    window.close();
  });

  $("#btnGuide").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "VAGASZAP_OPEN_ATS_GUIDE" });
    window.close();
  });

  $("#btnReset").addEventListener("click", async () => {
    if (!confirm("Limpar histórico de candidaturas salvas na extensão?")) return;
    await chrome.storage.local.remove("vagaszap_completed_jobs_v1");
    await loadStatus();
  });
});
