"use strict";
/* ===================== CUSTOM-CARD COMPLIANCE =====================
   Custom presentation_html/profile_html renders inside a sandboxed
   <iframe srcdoc>, so its CSS is fully scoped to that iframe document and
   cannot reach the parent page's mandatory action buttons. Only the
   card's OWNER is ever shown the enforcement modal. */
function cardComplianceReasons(rawHtml, doc, targetType){
  const raw=(rawHtml||"");
  const reasons=[];
  const badUrl=findExternalCardLink(raw);
  if(badUrl)
    reasons.push(t("compliance_reason_external_link").replace("{url}", badUrl));
  /* {{comments}} is only required for profiles — profile_html can be a full-
     page takeover with no guaranteed persistent header, so it's the only
     place the Comments button could actually disappear. A character's custom
     presentation_html only ever replaces the lower doss-main/lore section;
     the header row above it (with its own always-present #cmtBtn, alongside
     Start/Preview/Share/Edit/Export/Delete) is structurally untouched. */
  if(targetType!=="character" && raw.trim() && !raw.includes("{{comments}}"))
    reasons.push(t("compliance_reason_missing_comments"));
  /* {{block}} is only required for profiles, same reasoning as {{comments}}
     above — a character page's persistent header row has no block affordance
     at all (blocking blocks the CREATOR, which only makes sense from their
     profile), so this only applies to profile_html. */
  if(targetType!=="character" && raw.trim() && !raw.includes("{{block}}"))
    reasons.push(t("compliance_reason_missing_block"));
  /* {{report}} is only required for profile_html, same reasoning as
     {{comments}}/{{block}} above — the character dossier's persistent header
     (Start/Preview/Share/Edit/Export/Delete/Comments) already carries its own
     report button on the hero image regardless of what presentation_html
     does, so there's nothing for a character card to be missing here. */
  if(targetType!=="character" && raw.trim() && !raw.includes("{{report}}"))
    reasons.push(t("compliance_reason_missing_report"));
  /* The sandboxed frame auto-sizes to its content's scrollHeight after load —
     forcing html/body to height:100% traps the whole page inside the frame's
     tiny pre-resize starting height, silently clipping everything past the
     fold. Confirmed real-world bug, not theoretical — flag existing saves
     written before this check existed. */
  if(raw.trim() && /\b(?:html|body)\s*\{[^}]*height\s*:\s*100%/i.test(raw))
    reasons.push(t("compliance_reason_forced_height"));
  return reasons;
}
let _complianceLock=false;
/* Set once the global (or the profile page's own local) compliance modal has
   fired for this page load, so the two checks — the global one that runs
   once at boot regardless of what page you're on, and viewProfile's own
   local one when you happen to be on your own profile page — never stack a
   second openModal() on top of the first. */
let _complianceShownThisLoad=false;
/* Global, once-per-page-load check: if the signed-in user's OWN profile_html
   is non-compliant, the enforcement modal must appear and block them no
   matter what page of the app they're on — not only when they happen to
   navigate to their own /u/{username}. Runs off-screen (never inserted into
   the visible page) purely to get a real rendered height via the same
   mountSandboxedHTML/cardComplianceReasons pipeline every other compliance
   check uses, then discards the scratch iframe either way. */
async function checkOwnProfileComplianceGlobally(){
  if(_complianceShownThisLoad || !ME) return;
  let p;
  try{ p=await api("/api/users/"+encodeURIComponent(ME.username)); }
  catch(e){ return; }
  if(!p.profile_html || !p.profile_html.trim()) return;
  const scratch=document.createElement("div");
  scratch.style.cssText="position:fixed;left:-99999px;top:-99999px;width:1200px;visibility:hidden;pointer-events:none;";
  document.body.appendChild(scratch);
  mountSandboxedHTML(scratch, substituteProfileTemplate(p.profile_html, p, null, true), {onReady:doc=>{
    scratch.remove();
    if(_complianceShownThisLoad) return;
    const reasons=cardComplianceReasons(p.profile_html, doc, "user");
    if(!reasons.length) return;
    _complianceShownThisLoad=true;
    openComplianceModal({
      html: p.profile_html,
      filename: `${(p.username||"profile").replace(/[^a-z0-9]+/gi,"-")}-profile.html`,
      reasons,
      onEdit: ()=>{ navigate("/u/"+p.username); openProfileEditor(p, ()=>{}); },
      onClear: async()=>{
        await api("/api/me/profile", j("PUT", {profile_html:""}));
      },
    });
  }});
}
function complianceDownload(html, filename){
  const blob=new Blob([html||""],{type:"text/html"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}
/* Non-dismissible enforcement modal: no close/X, Escape is neutralised via
   _complianceLock (closeModal early-returns), and backdrop clicks are
   swallowed. Only Edit (navigate away to fix) or Leave→confirm→delete exit. */
function openComplianceModal({html, filename, reasons, onEdit, onClear}){
  _complianceLock=true;
  const s=$("#scrim");
  const bullets=(reasons&&reasons.length?reasons:[t("compliance_reason_generic")])
    .map(r=>`<li>${esc(r)}</li>`).join("");
  const showNotice=()=>{
    s.innerHTML=`<div class="modal compliance-modal">
      <h3>⚠ ${esc(t("compliance_title"))}</h3>
      <p>${esc(t("compliance_body"))}</p>
      <ul class="compliance-reasons">${bullets}</ul>
      <p class="compliance-halt">${esc(t("compliance_halt"))}</p>
      <div class="modal-actions">
        <button class="btn primary" id="cmpEdit">✎ ${esc(t("compliance_edit"))}</button>
        <button class="btn danger" id="cmpLeave">${esc(t("compliance_leave"))}</button>
        <button class="btn" id="cmpLogout">⎋ ${esc(t("sign_out"))}</button>
      </div>
    </div>`;
    $("#cmpEdit").onclick=()=>{ _complianceLock=false; closeModal(); onEdit(); };
    $("#cmpLeave").onclick=showConfirm;
    $("#cmpLogout").onclick=()=>{ _complianceLock=false; closeModal(); _doLogout(); };
  };
  const showConfirm=()=>{
    s.innerHTML=`<div class="modal compliance-modal">
      <h3>${esc(t("compliance_leave_title"))}</h3>
      <p>${esc(t("compliance_leave_body"))}</p>
      <div class="modal-actions">
        <button class="btn" id="cmpDownload">⤓ ${esc(t("compliance_download"))}</button>
        <button class="btn" id="cmpBack">${esc(t("compliance_back"))}</button>
        <button class="btn danger" id="cmpConfirm">${esc(t("compliance_confirm_leave"))}</button>
      </div>
    </div>`;
    $("#cmpDownload").onclick=()=>complianceDownload(html, filename);
    $("#cmpBack").onclick=showNotice;
    $("#cmpConfirm").onclick=async()=>{
      const b=$("#cmpConfirm"); b.disabled=true;
      try{ await onClear(); _complianceLock=false; closeModal(); }
      catch(e){ b.disabled=false; errorToast(e.message||"Failed to clear."); }
    };
  };
  showNotice();
  s.classList.add("open");
  s.onclick=e=>{ /* non-dismissible — swallow backdrop clicks */ };
}
