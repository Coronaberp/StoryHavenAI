"use strict";

let _recentAt=0;
const RECENT_TTL=30000;
function invalidateRecent(){ _recentAt=0; }
async function loadRecent(force) {
    if(!force && _recentAt && Date.now()-_recentAt < RECENT_TTL) return;
    const box = $("#recent");
    if(!box) return;
    try {
        const ss = await api("/api/sessions?limit=12");
        _recentAt = Date.now();
        box.innerHTML = `
              <div id="sessions">
                  ${ss.length ? ss.map(s => `
                      <div class="session-row" data-id="${s.id}">
                          <div class="go">
                              <div class="t">${esc(s.title || "Chat")}</div>
                              <div class="p">${esc(s.preview || "…")}</div>
                          </div>
                          <div class="x" data-del="${s.id}">✕</div>
                      </div>
                  `).join("") : `<div style="color:var(--muted);font-size:14px;padding:8px 4px;">${esc(t("no_chats_yet"))}</div>`}
              </div>
        `;

        localizeContent([...box.querySelectorAll(".session-row")].flatMap((row,i)=>[
            {el:row.querySelector(".t"), text:ss[i]?.title||""},
            {el:row.querySelector(".p"), text:ss[i]?.preview||""},
        ]));

        // Attach listeners after rendering
        // 1. Click to go to chat
        box.querySelectorAll(".session-row .go").forEach(g =>
            g.onclick = () => navigate("/chat/" + g.parentElement.dataset.id)
        );

        // 2. Click to delete
        box.querySelectorAll("[data-del]").forEach(x =>
            x.onclick = async (ev) => {
                ev.stopPropagation();
                if (!(await confirmAction(x, "Delete this chat?"))) return;
                await api("/api/sessions/" + x.dataset.del, { method: "DELETE" });
                loadRecent(true); // Refresh the list
            }
        );
    } catch (e) { box.innerHTML = ""; _recentAt = 0; }
}

