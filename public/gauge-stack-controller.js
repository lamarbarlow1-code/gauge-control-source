const rows = document.getElementById("assetRows");
const syncButton = document.getElementById("syncButton");
const reloadButton = document.getElementById("reloadButton");
const syncStatus = document.getElementById("syncStatus");
const nextActions = document.getElementById("nextActions");
const proofLog = document.getElementById("proofLog");

let allAssets = [];
let allActions = [];
let allProof = [];
let currentFilter = "All";

function safeText(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function escapeHtml(value) {
  return safeText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  const raw = value === null || value === undefined ? "" : String(value).trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw, window.location.origin);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.href;
  } catch {
    return "";
  }
}

function ownerKey() {
  let key = sessionStorage.getItem("gaugeOwnerKey") || "";
  if (!key) {
    key = prompt("Owner key, if configured in Netlify. Leave blank only for first test deploy.") || "";
    sessionStorage.setItem("gaugeOwnerKey", key);
  }
  return key;
}

function statusClass(status) {
  return safeText(status).replaceAll(" ", "");
}

function renderAssets() {
  const assets = currentFilter === "All"
    ? allAssets
    : allAssets.filter((asset) => asset.asset_type === currentFilter);

  if (!assets.length) {
    rows.innerHTML = `<tr><td colspan="6">No assets found for ${currentFilter}.</td></tr>`;
    return;
  }

  rows.innerHTML = assets.map((asset) => {
    const cleanedUrl = safeUrl(asset.asset_url);
    const url = cleanedUrl
      ? `<a href="${cleanedUrl}" target="_blank" rel="noreferrer">Open</a>`
      : "—";

    return `
      <tr>
        <td>${escapeHtml(asset.asset_name)}</td>
        <td>${escapeHtml(asset.asset_type)}</td>
        <td><span class="badge ${statusClass(asset.status)}">${escapeHtml(asset.status)}</span></td>
        <td>${url}</td>
        <td>${escapeHtml(asset.notes)}</td>
        <td>${asset.last_checked_at ? new Date(asset.last_checked_at).toLocaleString() : "Not checked"}</td>
      </tr>
    `;
  }).join("");
}

function renderActions(actions = allActions) {
  if (!actions.length) {
    nextActions.innerHTML = "<li>No next actions yet. Press Sync Gauge Stack.</li>";
    return;
  }

  nextActions.innerHTML = actions.slice(0, 30).map((item) => `
    <li>
      <strong>${escapeHtml(item.status)}</strong> —
      ${escapeHtml(item.action_text)}
    </li>
  `).join("");
}

function renderProof() {
  if (!allProof.length) {
    proofLog.innerHTML = "<li>No proof log yet. Press Sync Gauge Stack.</li>";
    return;
  }

  proofLog.innerHTML = allProof.slice(0, 25).map((item) => `
    <li>
      <strong>${new Date(item.created_at).toLocaleString()}</strong> —
      ${escapeHtml(item.asset_type)} / ${escapeHtml(item.asset_name)} —
      ${escapeHtml(item.status)}
    </li>
  `).join("");
}

async function loadRegistry() {
  syncStatus.textContent = "Reading registry…";

  const response = await fetch("/api/gauge-stack-agent");
  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.error || "Could not read Gauge registry.");
  }

  allAssets = data.assets || [];
  allActions = data.actions || [];
  allProof = data.proof_log || [];

  renderAssets();
  renderActions();
  renderProof();

  syncStatus.textContent = `Loaded ${allAssets.length} assets.`;
}

async function syncGaugeStack() {
  syncButton.disabled = true;
  syncStatus.textContent = "Syncing Gauge Stack…";

  try {
    const response = await fetch("/api/gauge-stack-agent", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gauge-owner-key": ownerKey(),
      },
      body: JSON.stringify({ action: "sync" }),
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || "Gauge sync failed.");
    }

    syncStatus.textContent = `${data.message} Checked ${data.checked_count} assets.`;
    renderActions(data.results || []);
    await loadRegistry();
  } catch (error) {
    syncStatus.textContent = error.message || "Gauge sync failed.";
  } finally {
    syncButton.disabled = false;
  }
}

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    renderAssets();
  });
});

syncButton.addEventListener("click", syncGaugeStack);
reloadButton.addEventListener("click", () => loadRegistry().catch((error) => {
  syncStatus.textContent = error.message;
}));

loadRegistry().catch((error) => {
  rows.innerHTML = `<tr><td colspan="6">${error.message}</td></tr>`;
  syncStatus.textContent = error.message;
});
