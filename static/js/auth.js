"use strict";
/* ============================ AUTH ============================ */
function showLoginScreen(){
  if(_showingLogin) return;
  _showingLogin = true;
  document.body.classList.add("unauthed");
  document.getElementById("main").innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;min-height:100dvh;padding:20px;">
      <div style="width:100%;max-width:380px;">
        <div class="brand" style="justify-content:center;margin:0 0 28px;">
          <span class="glyph" style="font-size:28px;">❖</span>
          <div class="brand-text">
            <span class="name" style="font-size:17px;">StoryHaven AI</span>
            <span class="tagline">${esc(t("tagline"))}</span>
          </div>
        </div>
        <div id="li_card"></div>
        <div style="text-align:center;margin-top:18px;"><a href="/explore" style="color:var(--muted);font-size:13px;">${esc(t("explore_link"))}</a></div>
      </div>
    </div>`;

  const cardLink = (id, text) =>
    `<div style="text-align:center;margin-top:18px;font-size:13px;color:var(--sec);">${text} <a href="#" id="${id}" style="color:var(--accent);text-decoration:none;font-weight:500;">${id==="li_toreg"?esc(t("li_request")):esc(t("li_signin"))}</a></div>`;

  const cardWrap = inner =>
    `<div style="background:var(--surface);border:1px solid var(--line-2);border-radius:16px;padding:28px 26px;">${inner}</div>`;

  function renderSignIn(){
    document.getElementById("li_card").innerHTML = cardWrap(`
      <div class="field"><label>${esc(t("li_username"))}</label><input type="text" id="li_user" autocomplete="username"></div>
      <div class="field" style="margin-bottom:6px;"><label>${esc(t("li_password"))}</label><input type="password" id="li_pass" autocomplete="current-password"></div>
      <div id="li_err" style="color:var(--warn);font-size:13px;margin-bottom:14px;min-height:18px;"></div>
      <button class="btn primary" id="li_btn" style="width:100%;padding:12px;font-size:15px;justify-content:center;">${esc(t("li_signin"))}</button>
      ${cardLink("li_toreg",esc(t("li_noacct")))}
      <div style="text-align:center;margin-top:8px;font-size:13px;"><a href="#" id="li_forgot" style="color:var(--sec);text-decoration:none;">${esc(t("li_forgot"))}</a></div>
    `);
    document.getElementById("li_btn").addEventListener("click", doLogin);
    document.getElementById("li_pass").addEventListener("keydown", e=>{ if(e.key==="Enter") doLogin(); });
    document.getElementById("li_toreg").addEventListener("click", e=>{ e.preventDefault(); renderRegister(); });
    document.getElementById("li_forgot").addEventListener("click", e=>{ e.preventDefault(); openForgotPassword(); });
    document.getElementById("li_user").focus();
  }

  function renderRegister(){
    document.getElementById("li_card").innerHTML = cardWrap(`
      <div class="field"><label>${esc(t("li_username"))}</label><input type="text" id="li_ruser" autocomplete="username"></div>
      <div class="field"><label>${esc(t("li_password"))} <span class="hint">${esc(t("li_min8"))}</span></label><input type="password" id="li_rpass" autocomplete="new-password"></div>
      <div class="field" style="margin-bottom:6px;"><label>${esc(t("li_confirm_pw"))}</label><input type="password" id="li_rpass2" autocomplete="new-password"></div>
      <div id="li_err" style="color:var(--warn);font-size:13px;margin-bottom:14px;min-height:18px;"></div>
      <button class="btn primary" id="li_rbtn" style="width:100%;padding:12px;font-size:15px;justify-content:center;">${esc(t("li_request"))}</button>
      ${cardLink("li_tologin",esc(t("li_haveacct")))}
    `);
    document.getElementById("li_rbtn").addEventListener("click", doRegister);
    document.getElementById("li_rpass2").addEventListener("keydown", e=>{ if(e.key==="Enter") doRegister(); });
    document.getElementById("li_tologin").addEventListener("click", e=>{ e.preventDefault(); renderSignIn(); });
    const ruser=document.getElementById("li_ruser");
    // Mirror the backend's username rule live: spaces silently become hyphens
    // as you type (rather than surprising you after submit), everything else
    // not in [A-Za-z0-9_-] is just dropped rather than blocking you mid-type.
    ruser.addEventListener("input", ()=>{
      const pos=ruser.selectionStart;
      const clean=ruser.value.replace(/\s+/g,"-").replace(/[^A-Za-z0-9_-]/g,"");
      if(clean!==ruser.value){ ruser.value=clean; ruser.setSelectionRange(pos,pos); }
    });
    ruser.focus();
  }

  function renderPending(username){
    document.getElementById("li_card").innerHTML = cardWrap(`
      <div style="text-align:center;padding:10px 0 6px;">
        <div style="font-size:36px;margin-bottom:14px;">⏳</div>
        <div style="font-weight:600;font-size:16px;margin-bottom:8px;">${esc(t("li_pending_t"))}</div>
        <p style="color:var(--sec);font-size:14px;line-height:1.6;margin:0 0 20px;">
          <strong>${esc(username)}</strong> ${esc(t("li_pending_p"))}<br>
          ${esc(t("li_pending_p2"))}
        </p>
        <button class="btn" id="li_backbtn" style="width:100%;justify-content:center;">${esc(t("li_back"))}</button>
      </div>
    `);
    document.getElementById("li_backbtn").addEventListener("click", renderSignIn);
  }

  const doLogin = async () => {
    const u = document.getElementById("li_user")?.value.trim();
    const p = document.getElementById("li_pass")?.value;
    const errEl = document.getElementById("li_err");
    if(!u || !p){ if(errEl) errEl.textContent=t("li_err_req"); return; }
    const btn = document.getElementById("li_btn");
    if(btn){ btn.disabled=true; btn.textContent="Signing in…"; }
    try {
      const r = await fetch(API+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u,password:p})});
      if(!r.ok){
        const d=await r.json().catch(()=>({detail:"Login failed"}));
        if(d && d.detail && typeof d.detail==="object" && d.detail.code==="suspended"){ showSuspendedModal(d.detail.reason); return; }
        if(errEl) errEl.textContent=(typeof d.detail==="string" && d.detail)||"Login failed"; return;
      }
      ME = await r.json();
      _showingLogin = false;
      document.body.classList.remove("unauthed");
      renderUserMenu();
      route();
    } catch(e){ if(errEl) errEl.textContent=e.message; }
    finally{ if(document.getElementById("li_btn")){ document.getElementById("li_btn").disabled=false; document.getElementById("li_btn").textContent=t("li_signin"); } }
  };

  const doRegister = async () => {
    const u = document.getElementById("li_ruser")?.value.trim();
    const p = document.getElementById("li_rpass")?.value;
    const p2 = document.getElementById("li_rpass2")?.value;
    const errEl = document.getElementById("li_err");
    if(!u || !p){ if(errEl) errEl.textContent=t("li_err_req"); return; }
    if(p !== p2){ if(errEl) errEl.textContent=t("li_err_match"); return; }
    if(p.length < 8){ if(errEl) errEl.textContent="Password must be at least 8 characters."; return; }
    const btn = document.getElementById("li_rbtn");
    if(btn){ btn.disabled=true; btn.textContent="Submitting…"; }
    try {
      const r = await fetch(API+"/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u,password:p})});
      const d = await r.json().catch(()=>({detail:"Registration failed"}));
      if(!r.ok){ if(errEl) errEl.textContent=d.detail||"Registration failed"; return; }
      renderPending(u);
    } catch(e){ if(errEl) errEl.textContent=e.message; }
    finally{ if(document.getElementById("li_rbtn")){ document.getElementById("li_rbtn").disabled=false; document.getElementById("li_rbtn").textContent="Request access"; } }
  };

  renderSignIn();
}

function showSuspendedModal(reason){
  const r = (reason||"").trim();
  openModal(`
    <div style="font-weight:600;font-size:18px;margin-bottom:12px;">You have been suspended</div>
    ${r ? `<p style="color:var(--sec);font-size:14px;line-height:1.6;margin:0 0 12px;">for: ${esc(r)}</p>` : `<p style="color:var(--sec);font-size:14px;line-height:1.6;margin:0 0 12px;">Your account access has been suspended.</p>`}
    <p style="color:var(--sec);font-size:14px;line-height:1.6;margin:0 0 16px;">For appeals or questions, contact <a href="https://discord.com/users/1522974375802835144" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:underline;text-underline-offset:2px;">@zukaarimot0 on Discord</a>.</p>
    <div class="modal-foot" style="justify-content:flex-end;">
      <button class="btn primary" id="susp_ok">OK</button>
    </div>`);
  document.getElementById("susp_ok").addEventListener("click", closeModal);
}

function openSuspendModal(uid, username, onDone){
  openModal(`
    <h3 style="margin:0 0 8px;font-size:16px;">Suspend ${esc(username)}</h3>
    <p style="color:var(--sec);font-size:14px;line-height:1.6;margin:0 0 12px;">Optionally give a reason — it's shown to the user when they try to sign in.</p>
    <div class="field"><label>Reason (optional)</label><input type="text" id="suspm_reason" placeholder="e.g. spam / abuse" autocomplete="off"></div>
    <div id="suspm_msg" style="font-size:13px;margin:4px 0 12px;min-height:18px;"></div>
    <div class="modal-foot" style="justify-content:flex-end;gap:8px;">
      <button class="btn" id="suspm_cancel">${esc(t("btn_cancel"))}</button>
      <button class="btn primary" id="suspm_go">Suspend</button>
    </div>`);
  const msg=document.getElementById("suspm_msg");
  document.getElementById("suspm_cancel").onclick=closeModal;
  const go=async()=>{
    const reason=document.getElementById("suspm_reason").value.trim();
    const btn=document.getElementById("suspm_go");
    btn.disabled=true;
    try{
      await api("/api/admin/users/"+uid+"/suspend", j("POST",{reason}));
      closeModal();
      toast(`${username} suspended.`);
      if(onDone) onDone();
    }catch(e){ btn.disabled=false; msg.style.color="var(--warn)"; msg.textContent="Failed: "+e.message; }
  };
  document.getElementById("suspm_go").onclick=go;
  const inp=document.getElementById("suspm_reason");
  inp.addEventListener("keydown", e=>{ if(e.key==="Enter") go(); });
  inp.focus();
}

function openForgotPassword(){
  openModal(`
    <div style="font-weight:600;font-size:16px;margin-bottom:8px;">${esc(t("li_forgot_t"))}</div>
    <p style="color:var(--sec);font-size:14px;line-height:1.6;margin:0 0 16px;">${esc(t("li_forgot_p"))}</p>
    <div class="field"><label>${esc(t("li_username"))}</label><input type="text" id="fp_user" autocomplete="username"></div>
    <div id="fp_msg" style="font-size:13px;margin:4px 0 12px;min-height:18px;"></div>
    <div class="modal-foot" style="justify-content:flex-end;gap:8px;">
      <button class="btn" id="fp_cancel">${esc(t("btn_cancel"))}</button>
      <button class="btn primary" id="fp_send">${esc(t("li_forgot_t"))}</button>
    </div>`);
  const msg = document.getElementById("fp_msg");
  document.getElementById("fp_cancel").onclick = closeModal;
  const send = async () => {
    const u = document.getElementById("fp_user").value.trim();
    if(!u){ msg.style.color="var(--warn)"; msg.textContent=t("li_err_req"); return; }
    const btn = document.getElementById("fp_send");
    btn.disabled = true;
    try {
      await fetch(API+"/api/auth/request-password-reset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u})});
    } catch(e){ /* generic response regardless */ }
    msg.style.color="var(--sec)"; msg.textContent=t("li_forgot_sent");
    document.getElementById("fp_user").disabled = true;
    document.getElementById("fp_send").style.display = "none";
    document.getElementById("fp_cancel").textContent = t("li_back");
  };
  document.getElementById("fp_send").onclick = send;
  document.getElementById("fp_user").addEventListener("keydown", e=>{ if(e.key==="Enter") send(); });
  document.getElementById("fp_user").focus();
}

async function _doLogout(){
  await fetch(API+"/api/auth/logout",{method:"POST"}).catch(()=>{});
  ME = null; renderUserMenu(); _showingLogin=false; showLoginScreen();
}
function openAccountModal(){
  openModal(`
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
      ${ME.avatar?`<img src="${esc(mediaURL(ME.avatar))}" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover;">`:`<div class="rail-ava-mono" style="width:48px;height:48px;font-size:20px;">${esc((ME.username||"?")[0].toUpperCase())}</div>`}
      <div>
        <div style="font-weight:600;font-size:16px;">${esc(ME.username)}</div>
        ${ME.is_admin?`<span class="badge always" style="font-size:9px;">${ME.role==="dev"?"dev":"admin"}</span>`:""}
      </div>
    </div>
    <div style="margin-bottom:14px;">
      <button class="btn" id="acctBlockedBtn" style="width:100%;justify-content:flex-start;">🚫 Blocked users</button>
    </div>
    <div class="modal-foot" style="justify-content:space-between;">
      <a class="btn" href="/u/${encodeURIComponent(ME.username)}" onclick="closeModal()">${esc(t("nav_profile"))}</a>
      <button class="btn danger" id="railModalLogout">⎋ ${esc(t("sign_out"))}</button>
    </div>`);
  document.getElementById("railModalLogout").onclick = () => { closeModal(); _doLogout(); };
  document.getElementById("acctBlockedBtn").onclick = () => openBlockedUsersModal();
}
function openBlockUserModal(username, onBlocked){
  openModal(`<h3>Block @${esc(username)}</h3>
    <p class="hint" style="margin:0 0 12px;">You won't see their profile, characters, or comments, and they can't comment on yours.</p>
    <div class="field"><label>Reason <span class="hint">optional — a private note only you can see</span></label>
      <textarea id="blkReason" maxlength="500" style="min-height:70px" placeholder="Why are you blocking this person?"></textarea></div>
    <div class="modal-foot" style="margin-top:14px;">
      <button class="btn danger" id="blkConfirm">🚫 Block</button>
      <button class="btn" id="blkCancel" style="margin-left:auto;">${esc(t("btn_close"))}</button>
    </div>`);
  document.getElementById("blkCancel").onclick=closeModal;
  document.getElementById("blkConfirm").onclick=async()=>{
    const reason=document.getElementById("blkReason").value.trim();
    const btn=document.getElementById("blkConfirm"); btn.disabled=true;
    try{ await api("/api/users/"+encodeURIComponent(username)+"/block", j("POST",{reason}));
      closeModal(); toast("Blocked."); if(onBlocked) onBlocked(); }
    catch(e){ btn.disabled=false; errorToast(e.message||"Failed"); }
  };
}
async function openBlockedUsersModal(){
  openModal(`<h3>🚫 Blocked users</h3><div id="blockedListBox"><div class="hint">Loading…</div></div>
    <div class="modal-foot" style="margin-top:16px;"><button class="btn" id="blockedClose" style="margin-left:auto;">${esc(t("btn_close"))}</button></div>`);
  document.getElementById("blockedClose").onclick = closeModal;
  const box = document.getElementById("blockedListBox");
  const paint = (list)=>{
    if(!list.length){ box.innerHTML = `<div class="empty"><div class="big">You haven't blocked anyone.</div></div>`; return; }
    box.innerHTML = list.map(u=>{
      const ava = mediaURL(u.avatar)
        ? `<img class="blk-ava" src="${esc(mediaURL(u.avatar))}" alt="">`
        : `<div class="blk-ava mono">${esc((u.display_name||u.username||"?")[0].toUpperCase())}</div>`;
      return `<div class="blk-row" data-uname="${esc(u.username)}">
        ${ava}
        <div class="blk-info">
          <div class="blk-name">${esc(u.display_name||u.username)} <span class="blk-handle">@${esc(u.username)}</span></div>
          <div class="blk-reason${u.reason?"":" muted"}">${esc(u.reason||"No reason given")}</div>
        </div>
        <button class="btn" data-unblock="${esc(u.username)}">Unblock</button>
      </div>`;
    }).join("");
    box.querySelectorAll("[data-unblock]").forEach(b=>b.onclick=async()=>{
      b.disabled=true;
      try{ await api("/api/users/"+encodeURIComponent(b.dataset.unblock)+"/unblock",{method:"POST"});
        b.closest(".blk-row").remove();
        if(!box.querySelector(".blk-row")) paint([]);
      }catch(e){ b.disabled=false; errorToast(e.message||"Failed"); }
    });
  };
  try{ paint(await api("/api/me/blocked")); }
  catch(e){ box.innerHTML = `<div class="hint">Failed to load.</div>`; }
}
function renderUserMenu(){
  const info = document.getElementById("userInfo");
  if(!info) return;
  const privacyBtn = document.getElementById("privacyBtn");
  // SFW-only users already have everything blurred regardless — the toggle
  // would just be confusing dead weight for them, so it only appears once
  // someone has actually opted into mature content in the first place.
  if(privacyBtn) privacyBtn.style.display = (ME && ME.nsfw_allowed) ? "" : "none";
  if(!ME){ info.innerHTML=""; info.classList.add("user-info-empty"); return; }
  info.classList.remove("user-info-empty");
  const avaHTML = ME.avatar
    ? `<img src="${esc(mediaURL(ME.avatar))}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex:none;">`
    : `<div style="width:28px;height:28px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;color:var(--accent);background:var(--accent-tint);">${esc((ME.username||"?")[0].toUpperCase())}</div>`;
  info.innerHTML = `
    <button id="userInfoBtn" style="width:100%;font-size:13px;color:var(--sec);padding:4px 10px 6px;display:flex;align-items:center;gap:8px;background:none;border:none;text-align:left;">
      ${avaHTML}
      <span style="flex:1;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(ME.username)}</span>
      ${ME.is_admin?`<span class="badge always" style="font-size:9px;flex:none;">${ME.role==="dev"?"dev":"admin"}</span>`:""}
    </button>
  `;
  document.getElementById("userInfoBtn").onclick = openAccountModal;
  const adminLink = document.getElementById("adminNavLink");
  if(adminLink) adminLink.style.display = ME.is_admin ? "" : "none";
  const avaBtn = document.getElementById("railAvaBtn");
  if(avaBtn){
    avaBtn.innerHTML = ME.avatar
      ? `<img src="${esc(mediaURL(ME.avatar))}" alt="">`
      : `<span class="rail-ava-mono">${esc((ME.username||"?")[0].toUpperCase())}</span>`;
    avaBtn.onclick = openAccountModal;
  }
}

async function init(){
  try {
    const r = await fetch(API+"/api/auth/me");
    ME = r.ok ? await r.json() : null;
  } catch(e){ ME = null; }
  if(!ME){
    const seg0=pathSegments();
    // Shared links (/c/{cid}, /u/{username}) must work for logged-out visitors
    // too, same as /explore — otherwise "sharing" a character/profile link just
    // bounces anyone who isn't already signed in straight to the login screen.
    if(seg0[0]==="explore" || seg0[0]==="c" || seg0[0]==="u") return route();
    showLoginScreen();
    return;
  }
  document.body.classList.remove("unauthed");
  renderUserMenu();
  route();
  checkOwnProfileComplianceGlobally();
  refreshNotifCount();
  setInterval(refreshNotifCount, 15000);
  try{
    const {overrides}=await api("/api/me/settings");
    loadUiTranslations(await effectiveUiLang(overrides?.interface_language||""));
  }catch(e){ /* fall back to whatever the cached-locale bootstrap already applied */ }
}

function errorPage(main, {code="", title="Error", message="", detail=""} = {}){
  const codeClass = code === "404" ? "muted" : "warn";
  main.innerHTML = `<div class="error-page">
    <div class="ep-inner">
      ${code ? `<div class="ep-code ${codeClass}">${esc(code)}</div>` : ""}
      <h2>${esc(trNow(title))}</h2>
      ${message ? `<p class="ep-msg">${esc(trNow(message))}</p>` : ""}
      ${detail  ? `<pre class="ep-detail">${esc(detail)}</pre>` : ""}
      <a class="btn primary" href="/">← ${esc(t("back_to_library"))}</a>
    </div>
  </div>`;
}
