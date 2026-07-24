"use strict";

function findExternalCardLink(html) {
  const withoutStyle = String(html || "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  const hrefRe = /\bhref\s*=\s*(['"])([^'"]*)\1/gi;
  let m;
  while ((m = hrefRe.exec(withoutStyle))) {
    const url = m[2].trim();
    if (!url || url.startsWith("#") || /^(mailto|tel):/i.test(url)) continue;
    if (isAllowedFontHost(url)) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) {
      try {
        const u = new URL(url.replace(/^\/\//, "https://"), location.origin);
        if (u.origin === location.origin) continue;
      } catch {}
      return url;
    }
  }
  return null;
}

function cardComplianceIssues(html) {
  const raw = html || "";
  const issues = [];
  if (!raw.trim()) return issues;
  const badUrl = findExternalCardLink(raw);
  if (badUrl) issues.push(`${t("compliance_external_link_not_allowed_prefix")} ${badUrl}`);
  if (/\b(?:html|body)\s*\{[^}]*height\s*:\s*100%/i.test(raw)) {
    issues.push(t("compliance_forces_full_height_warning"));
  }
  return issues;
}

const REQUIRED_PROFILE_PLACEHOLDERS = ["{{share}}", "{{edit}}", "{{comments}}", "{{block}}", "{{report}}", "{{follow}}"];

function profileComplianceIssues(p) {
  const issues = [];
  const html = p.profile_html || "";
  if (html.trim()) {
    for (const ph of REQUIRED_PROFILE_PLACEHOLDERS) {
      if (!html.includes(ph)) issues.push(`${t("compliance_missing_placeholder", "Your page is missing a required button:")} ${ph}`);
    }
    issues.push(...cardComplianceIssues(html));
  }
  const card = p.card_html || "";
  if (card.trim()) {
    const badUrl = findExternalCardLink(card);
    if (badUrl) issues.push(`${t("compliance_card_external_link", "Your card links off-site:")} ${badUrl}`);
  }
  return issues;
}

let _complianceCheckedThisBoot = false;

async function checkOwnProfileComplianceOnBoot() {
  if (_complianceCheckedThisBoot || !ME?.username) return;
  _complianceCheckedThisBoot = true;
  let p;
  try {
    p = await api("/api/users/" + encodeURIComponent(ME.username));
  } catch {
    return;
  }
  const issues = profileComplianceIssues(p);
  if (!issues.length) return;
  showComplianceGate(p, issues);
}

function _cmpIcon(paths) {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

function showComplianceGate(p, issues) {
  const bullets = issues.map((r) => `<li>${_esc(r)}</li>`).join("");
  const gate = document.createElement("div");
  gate.id = "complianceGate";
  gate.style.cssText = "position:fixed;inset:0;z-index:100000;background:var(--color-paper);display:flex;align-items:center;justify-content:center;padding:22px;overflow-y:auto";
  gate.innerHTML = `
    <div style="max-width:460px;width:100%;background:var(--color-surface);border:1px solid var(--color-line-2);border-radius:16px;padding:24px">
      <div style="color:var(--color-warn);font-size:26px;margin-bottom:6px">&#9888;</div>
      <h2 style="margin:0 0 6px;font-family:var(--font-display);font-size:19px;color:var(--color-ink)">${t("compliance_gate_title", "Your custom page needs fixing")}</h2>
      <p style="margin:0 0 10px;font-size:13px;color:var(--color-sec)">${t("compliance_gate_body", "Your saved custom HTML/CSS breaks the rules, so the rest of the site is locked until it's fixed. Pick an option below.")}</p>
      <ul style="margin:0 0 16px;padding-left:20px;font-size:13px;color:var(--color-warn)">${bullets}</ul>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button type="button" id="cmp_edit" style="display:flex;align-items:center;gap:9px;padding:11px 14px;border-radius:11px;border:none;background:var(--color-accent);color:var(--color-paper-base);font-weight:600;font-size:14px;cursor:pointer">
          ${_cmpIcon('<path d="M17 3a2.8 2.8 0 0 1 4 4L7 21l-4 1 1-4z"/>')} ${t("compliance_gate_edit", "Edit and fix it")}
        </button>
        <button type="button" id="cmp_delete" style="display:flex;align-items:center;gap:9px;padding:11px 14px;border-radius:11px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:14px;cursor:pointer">
          ${_cmpIcon('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>')} ${t("compliance_gate_delete", "Delete my custom HTML/CSS")}
        </button>
        <button type="button" id="cmp_signout" style="display:flex;align-items:center;gap:9px;padding:11px 14px;border-radius:11px;border:1px solid var(--color-line-2);background:none;color:var(--color-sec);font-size:14px;cursor:pointer">
          ${_cmpIcon('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>')} ${t("compliance_gate_signout", "Sign out")}
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(gate);
  document.body.style.overflow = "hidden";
  const dismiss = () => { gate.remove(); document.body.style.overflow = ""; };
  gate.querySelector("#cmp_edit").onclick = () => {
    dismiss();
    navigate("/u/" + p.username);
    openProfileEditor(p, () => { _complianceCheckedThisBoot = false; checkOwnProfileComplianceOnBoot(); });
  };
  gate.querySelector("#cmp_delete").onclick = async () => {
    if (!(await confirmDialog(t("compliance_gate_delete_confirm", "Delete your custom page and card CSS? Your profile stays, it just goes back to the default look.")))) return;
    try {
      await api("/api/me/profile", { method: "PUT", body: JSON.stringify({ profile_html: "", card_html: "" }) });
      location.reload();
    } catch (err) {
      errorToast(err.message || t("compliance_gate_delete_failed", "Couldn't delete it - try again."));
    }
  };
  gate.querySelector("#cmp_signout").onclick = () => confirmSignOut();
}

if (typeof window !== "undefined") {
  window.cardComplianceIssues = cardComplianceIssues;
  window.checkOwnProfileComplianceOnBoot = checkOwnProfileComplianceOnBoot;
}
