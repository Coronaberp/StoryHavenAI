"use strict";

function commentRowHtml(c) {
  const name = c.author_display_name || c.author_username;
  const when = new Date(c.created * 1000).toLocaleDateString();
  return `
    <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--color-line)">
      <span style="width:30px;height:30px;border-radius:999px;flex:none;overflow:hidden;background:var(--color-surface-2);display:grid;place-items:center">
        ${c.author_avatar ? `<img src="${c.author_avatar}" alt="" style="width:100%;height:100%;object-fit:cover">` : `<span style="font-family:var(--font-mono);font-size:11px">${name[0]?.toUpperCase() || "?"}</span>`}
      </span>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:baseline;gap:6px">
          <span style="font-family:var(--font-display);font-weight:600;font-size:13px;color:var(--color-ink)">${name}</span>
          <span style="font-family:var(--font-mono);font-size:10px;color:var(--color-muted)">${when}</span>
        </div>
        <p style="font-size:13px;color:var(--color-sec);margin:3px 0 0;white-space:pre-wrap;word-break:break-word">${c.content}</p>
      </div>
    </div>
  `;
}

async function openCommentsModal(targetType, targetId) {
  openModal(`
    <h3>Comments</h3>
    <div id="commentsList" style="max-height:50vh;overflow-y:auto">Loading…</div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <input type="text" id="commentInput" placeholder="Write a comment…"
        style="flex:1;padding:9px 11px;border-radius:9px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13px">
      <button type="button" id="commentSend" class="dropdown-item" style="flex:none;border:1px solid var(--color-line-2)">Send</button>
    </div>
  `);
  const layer = document.querySelector(".modal-layer:last-child");
  const list = layer.querySelector("#commentsList");
  const renderList = (comments) => {
    list.innerHTML = comments.length
      ? comments.map(commentRowHtml).join("")
      : `<p style="color:var(--color-sec);font-size:13px;padding:12px 0">No comments yet.</p>`;
  };
  try {
    renderList(await api(`/api/comments?target_type=${targetType}&target_id=${encodeURIComponent(targetId)}`));
  } catch (err) {
    list.innerHTML = `<p style="color:var(--color-warn);font-size:13px">${err.message || "Couldn't load comments."}</p>`;
  }
  const input = layer.querySelector("#commentInput");
  const send = async () => {
    const content = input.value.trim();
    if (!content) return;
    try {
      await api("/api/comments", { method: "POST", body: JSON.stringify({ target_type: targetType, target_id: targetId, content }) });
      input.value = "";
      renderList(await api(`/api/comments?target_type=${targetType}&target_id=${encodeURIComponent(targetId)}`));
    } catch (err) {
      errorToast(err.message || "Couldn't post comment.");
    }
  };
  layer.querySelector("#commentSend").onclick = send;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
}
