"use strict";
/* ============================ ADMIN: user management ============================ */
function _admUsersPanelHTML(active, ME){
  return `
    <div class="adash-panel-head">
      <div><div class="adash-eyebrow">${esc(t("adm_nav_users"))}</div><h2 class="adash-h2">${esc(t("adm_users"))} <span class="adash-count">${active.length}</span></h2></div>
      <button class="btn primary" id="createUserBtn">+ ${esc(t("adm_new_user"))}</button>
    </div>
    <div class="adash-list">
      ${active.map(u=>`
        <div class="adash-rowcard">
          <div class="adash-rowmain">
            ${avatar({name:u.username, avatar:u.avatar}, "adash-uava")}
            <div>
              <div class="adash-rowtitle">${esc(u.username)}${u.identity_label?` <span class="adash-tag ident" title="Admin identity note">${esc(u.identity_label)}</span>`:""}${u.id===ME.id?` <span class="adash-tag">${esc(t("adm_you"))}</span>`:""}${u.is_admin?` <span class="adash-tag gold">${esc(u.role==="dev"?"Dev":t("adm_admin"))}</span>`:""}${u.status==="suspended"?` <span class="adash-tag" style="background:var(--danger,#b42318);color:#fff;">suspended</span>`:""}</div>
              <div class="adash-rowsub mono">${esc(u.id.slice(0,8))}…</div>
              ${u.status==="suspended"&&u.suspension_reason?`<div class="adash-rowsub">Reason: ${esc(u.suspension_reason)}</div>`:""}
            </div>
          </div>
          <div class="adash-rowactions">
            <button class="btn" data-notes="${u.id}">Notes</button>
            <button class="btn" data-resetpw="${u.id}">${esc(t("adm_reset_pw"))}</button>
            ${u.is_admin
              ? (u.id!==ME.id ? `<button class="btn" data-role="${u.id}" data-toadmin="false">${esc(t("adm_demote"))}</button>` : "")
              : `<button class="btn" data-role="${u.id}" data-toadmin="true">${esc(t("adm_make_admin"))}</button>`}
            ${ME.role==="dev" && u.is_admin && u.id!==ME.id
              ? (u.role==="dev"
                  ? `<button class="btn" data-devrole="${u.id}" data-todev="false">Revoke Dev</button>`
                  : `<button class="btn" data-devrole="${u.id}" data-todev="true">Grant Dev</button>`)
              : ""}
            ${u.id!==ME.id ? (u.status==="suspended"
              ? `<button class="btn" data-unsuspend="${u.id}">Unsuspend</button>`
              : `<button class="btn" data-suspend="${u.id}">Suspend</button>`) : ""}
            ${u.id!==ME.id?`<button class="btn danger" data-delusr="${u.id}">${esc(t("adm_delete"))}</button>`:""}
          </div>
        </div>`).join("")}
    </div>`;
}

function _admWireUsers(main, allUsers, ME, render){
  const openCreateUser = () => {
    openModal(`<h3>${esc(t("adm_create_user"))}</h3>
      <div class="field"><label>${esc(t("li_username"))}</label><input type="text" id="nu_name" autocomplete="off"></div>
      <div class="field"><label>${esc(t("li_password"))} <span class="hint">${esc(t("li_min8"))}</span></label><input type="password" id="nu_pass" autocomplete="new-password"></div>
      <label class="switch" style="margin-bottom:14px;"><input type="checkbox" id="nu_admin"> ${esc(t("adm_grant"))}</label>
      <div class="modal-foot"><button class="btn" id="nu_cancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="nu_save">${esc(t("adm_create"))}</button></div>`);
    document.getElementById("nu_cancel").onclick = closeModal;
    const nuName=document.getElementById("nu_name");
    nuName.addEventListener("input", ()=>{
      const pos=nuName.selectionStart;
      const clean=nuName.value.replace(/\s+/g,"-").replace(/[^A-Za-z0-9_-]/g,"");
      if(clean!==nuName.value){ nuName.value=clean; nuName.setSelectionRange(pos,pos); }
    });
    document.getElementById("nu_save").onclick = async () => {
      const username = document.getElementById("nu_name").value.trim();
      const password = document.getElementById("nu_pass").value;
      const is_admin = document.getElementById("nu_admin").checked;
      if(!username||!password){ toast("Username and password required."); return; }
      if(password.length<8){ toast("Password must be at least 8 characters."); return; }
      try{ await api("/api/admin/users", j("POST",{username,password,is_admin})); closeModal(); toast("User created."); render(); }
      catch(e){ errorToast("Failed: "+e.message); }
    };
  };
  const cub=document.getElementById("createUserBtn"); if(cub) cub.onclick = openCreateUser;

  main.querySelectorAll("[data-delusr]").forEach(b=>b.onclick=async()=>{
    const u=allUsers.find(x=>x.id===b.dataset.delusr);
    if(!(await confirmAction(b, `Delete user "${u?.username}"? This cannot be undone.`))) return;
    try{ await api("/api/admin/users/"+b.dataset.delusr,{method:"DELETE"}); toast("User deleted."); render(); }
    catch(e){ errorToast("Failed: "+e.message); }
  });
  main.querySelectorAll("[data-resetpw]").forEach(b=>b.onclick=()=>{
    const uid=b.dataset.resetpw;
    const u=allUsers.find(x=>x.id===uid);
    openModal(`<h3>New password for "${esc(u?.username||"")}"</h3>
      <div class="field"><label>${esc(t("li_password"))} <span class="hint">${esc(t("li_min8"))}</span></label><input type="password" id="rp_pass" autocomplete="new-password"></div>
      <div class="modal-foot"><button class="btn" id="rp_cancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="rp_save">${esc(t("adm_reset_pw"))}</button></div>`);
    document.getElementById("rp_cancel").onclick = closeModal;
    document.getElementById("rp_save").onclick = async () => {
      const pw = document.getElementById("rp_pass").value;
      if(pw.length<8){ toast("Password must be at least 8 characters."); return; }
      try{ await api("/api/admin/users/"+uid+"/password", j("PUT",{username:u?.username||"_",password:pw})); closeModal(); toast("Password updated."); }
      catch(e){ errorToast("Failed: "+e.message); }
    };
  });
  main.querySelectorAll("[data-role]").forEach(b=>b.onclick=async()=>{
    const uid=b.dataset.role, toAdmin=b.dataset.toadmin==="true";
    const u=allUsers.find(x=>x.id===uid);
    try{ await api("/api/admin/users/"+uid+"/role", j("PUT",{username:u?.username||"_",password:"_",is_admin:toAdmin})); render(); }
    catch(e){ errorToast("Failed: "+e.message); }
  });
  main.querySelectorAll("[data-devrole]").forEach(b=>b.onclick=async()=>{
    const uid=b.dataset.devrole, toDev=b.dataset.todev==="true";
    const u=allUsers.find(x=>x.id===uid);
    const msg=toDev?`Grant Dev status to "${u?.username}"? They'll see raw model-request download material (curl commands, API keys) and become protected from suspension/deletion.`
                   :`Revoke Dev status from "${u?.username}"? They stay a regular admin.`;
    if(!(await confirmAction(b, msg, toDev?"Grant Dev":"Revoke Dev"))) return;
    try{ await api("/api/admin/users/"+uid+"/dev-role", j("PUT",{is_dev:toDev})); toast(toDev?"Dev granted.":"Dev revoked."); render(); }
    catch(e){ errorToast("Failed: "+e.message); }
  });
  main.querySelectorAll("[data-suspend]").forEach(b=>b.onclick=()=>{
    const uid=b.dataset.suspend;
    const u=allUsers.find(x=>x.id===uid);
    openSuspendModal(uid, u?.username||"", render);
  });
  main.querySelectorAll("[data-unsuspend]").forEach(b=>b.onclick=async()=>{
    const u=allUsers.find(x=>x.id===b.dataset.unsuspend);
    if(!(await confirmAction(b, `Unsuspend "${u?.username}"?`+(u?.suspension_reason?` (reason: ${u.suspension_reason})`:""), "Unsuspend"))) return;
    try{ await api("/api/admin/users/"+b.dataset.unsuspend+"/unsuspend",{method:"POST"}); toast(`${u?.username} unsuspended.`); render(); }
    catch(e){ errorToast("Failed: "+e.message); }
  });
  main.querySelectorAll("[data-notes]").forEach(b=>b.onclick=()=>{
    const u=allUsers.find(x=>x.id===b.dataset.notes);
    openAdminNotesModal(u, render);
  });
}
