"use strict";

// Fixed default steps/cfg for admin checkpoint/LoRA/sampler/scheduler preview
// generations — a shared, consistent baseline so every model/style gets a
// fair, comparable-quality sample instead of whatever the last admin left the
// (nonexistent, this modal has none) sliders at.
const IG_ADMIN_DEFAULT_STEPS=20, IG_ADMIN_DEFAULT_CFG=6;
const IG_ADMIN_DEFAULT_CHECKPOINT="animayume.safetensors";
const IG_ADMIN_DEFAULT_SAMPLER="dpmpp_2m_sde_gpu", IG_ADMIN_DEFAULT_SCHEDULER="karras";
// Anima's own recommended settings (ComfyUI's bundled reference workflow) —
// unrelated to and much lower than the SDXL cfg default above.
const ANIMA_DEFAULT_SAMPLER="er_sde", ANIMA_DEFAULT_SCHEDULER="simple", ANIMA_DEFAULT_CFG=4;
const IG_ADMIN_DEFAULT_POSITIVE='score_9, score_8, 1girl, solo, beautiful, anime, anime_realism, sexy, highly_detailed, detailed face, masterpiece, best quality, absurdres, extremely detailed eyes, sharp focus, (wolf girl:1.4), (silver wolf ears:1.4), long (silver hair:1.4), black streaks, (streaked hair:1.1), messy hair flowing in wind, silver eyes, detailed eyes, blood on face, silver eyes, blood on face, blood splatter, blood on clothes, sadistic smirk, fangs, detailed_hands, blood, bleeding, blood from mouth, holding gun, (gun:1.2), (revolver:1.4), athletic build, (small breasts:1.5), (aiming at viewer:1.2), heavily injured, slim waist, seductive yet dangerous expression, black pinstripe suit jacket, white dress shirt unbuttoned exposing cleavage and midriff, loose red necktie, torn clothes, standing in dark cyberpunk alley, neon signs, night city, dramatic rim lighting, red neon glow, cinematic lighting, depth of field, atmospheric particles, lightning_eyes';
const IG_ADMIN_DEFAULT_NEGATIVE='score_1, score_2, score_3, score_4, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, jpeg artifacts, signature, watermark, username, blurry, artist name, multiple girls, child, loli, deformed, ugly, mutilated, out of frame, extra limbs, bad proportions, gross proportions, malformed limbs, missing arms, missing legs, extra arms, extra legs, fused fingers, too many fingers, long neck, mutated, poorly drawn face, bad face, bad eyes, deformed eyes, ugly eyes, dead eyes, empty eyes, crossed eyes, extra eyes, missing eyes, asymmetrical eyes, poorly drawn eyes, blurry eyes, low detail eyes, text on eyes, heart-shaped pupils, symbol-shaped pupils, young, huge breasts, flat chest, deformed, ugly, mutated, extra limbs, bad proportions, simple background, plain background, overexposed, underexposed, monochrome, realistic, hyper_realistic';
// Used specifically as the fallback negative prompt when generating a lore
// entry's image and the entry's own "appearance tags — negative" field is
// blank — distinct from IG_ADMIN_DEFAULT_NEGATIVE above (the admin quick-
// generate panel's own default), per an exact list the user specified.
const LORE_DEFAULT_NEGATIVE_TAGS='lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, jpeg artifacts, signature, watermark, username, blurry, artist name, multiple girls, child, loli, deformed, ugly, mutilated, out of frame, extra limbs, bad proportions, gross proportions, malformed limbs, missing arms, missing legs, extra arms, extra legs, fused fingers, too many fingers, long neck, mutated, poorly drawn face, bad face, bad eyes, deformed eyes, ugly eyes, dead eyes, empty eyes, crossed eyes, mismatched eyes, heterochromia, extra eyes, missing eyes, asymmetrical eyes, poorly drawn eyes, blurry eyes, low detail eyes, text on eyes, heart-shaped pupils, symbol-shaped pupils, glowing eyes';

function callno(c){ const n=(c.name||"??").replace(/[^A-Za-z]/g,"").slice(0,3).toUpperCase().padEnd(3,"X"); return "PRS · "+n+"-"+String(c.id||"").slice(-4).toUpperCase(); }

const SOCIAL_PLATFORMS = [
  {key:"twitter", color:"#000000", host:"x.com", ph:"username", icon:'<path d="M18.9 2H22l-7.6 8.7L23.3 22h-7l-5.5-6.9L4.4 22H1.3l8.1-9.3L1 2h7.2l5 6.3L18.9 2Zm-1.2 18h1.7L6.4 4H4.6l13.1 16Z"/>'},
  {key:"twitch", color:"#9146FF", host:"twitch.tv", ph:"username", icon:'<path d="M4 2 2 6v14h6v2h4l2-2h4l4-4V2H4Zm18 12-3 3h-5l-2 2h-2v-2H6V4h16v10Z"/><path d="M14 7h2v5h-2zM9 7h2v5H9z"/>'},
  {key:"instagram", color:"#E4405F", host:"instagram.com", ph:"username", icon:'<path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7Zm5 3.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 0 1 12 7.5Zm0 2A2.5 2.5 0 1 0 14.5 12 2.5 2.5 0 0 0 12 9.5ZM17.8 6a1 1 0 1 1-1 1 1 1 0 0 1 1-1Z"/>'},
  {key:"discord", color:"#5865F2", host:"discord.gg", ph:"https://discord.gg/example", icon:'<path d="M20.3 5.4A18 18 0 0 0 15.9 4l-.3.6a13 13 0 0 1 3.9 1.5 15 15 0 0 0-11 0A13 13 0 0 1 12.4 4l-.3-.6a18 18 0 0 0-4.4 1.4C3.5 10 2.7 14.4 3.1 18.8a18 18 0 0 0 5.5 2.8l1-1.6a11 11 0 0 1-1.9-.9l.5-.4a13 13 0 0 0 11.6 0l.5.4a11 11 0 0 1-1.9.9l1 1.6a18 18 0 0 0 5.5-2.8c.5-5.2-.8-9.6-4.1-13.4ZM9.7 15.7c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1Zm6.6 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1Z"/>'},
  {key:"pixiv", color:"#0096FA", host:"pixiv.net", ph:"user ID, e.g. 123456", icon:'<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm5 6-3.6 4.2L17 16h-2.8l-2.5-3-1.2 1.4V16H8.2V8h2.3v3.6L13.7 8H17Z"/>'},
  {key:"youtube", color:"#FF0000", host:"youtube.com", ph:"@handle", icon:'<path d="M23 12s0-3.5-.5-5.2a2.8 2.8 0 0 0-2-2C18.9 4.3 12 4.3 12 4.3s-6.9 0-8.5.5a2.8 2.8 0 0 0-2 2C1 8.5 1 12 1 12s0 3.5.5 5.2a2.8 2.8 0 0 0 2 2c1.6.5 8.5.5 8.5.5s6.9 0 8.5-.5a2.8 2.8 0 0 0 2-2C23 15.5 23 12 23 12ZM9.8 15.5v-7l6 3.5Z"/>'},
  {key:"patreon", color:"#FF424D", host:"patreon.com", ph:"username", icon:'<circle cx="15" cy="9.5" r="6.5"/><rect x="3" y="2" width="3" height="20"/>'},
  {key:"kofi", color:"#FF5E5B", host:"ko-fi.com", ph:"username", icon:'<path d="M4 3h13a3 3 0 0 1 0 6h-.3A6 6 0 0 1 11 15H8v3H4V3Zm4 4v6h3a3 3 0 0 0 0-6H8Zm9 0a1 1 0 1 0 0 2h.3a1 1 0 0 0 0-2Z"/>'},
];
function avatar(c, cls){
  const url=mediaURL(c.avatar);
  const pos=(c.assets&&c.assets.avatar_pos)?` style="object-position:${esc(c.assets.avatar_pos)}"`:"";
  const nb=nsfwCls(c);
  if(url) return `<img class="ava ${cls||""}${nb}" src="${esc(url)}"${pos} alt="">`;
  return `<div class="ava mono ${cls||""}">${esc((c.name||"?")[0].toUpperCase())}</div>`;
}
/* Samples the character art's dominant color and feeds it to the card's
   bottom-fade gradient (--dom), so the image blends into the text panel
   using the art's own palette instead of a flat black scrim. Falls back
   silently (leaves the CSS default) for cross-origin images without CORS
   headers, since sampling those taints the canvas. */
const _domColorCache = new Map();
function tintCardMedia(img){
  const media = img.closest(".card-media");
  if(!media) return;
  const apply = url => {
    if(_domColorCache.has(url)){ media.style.setProperty("--dom", _domColorCache.get(url)); return; }
    const probe = new Image();
    probe.crossOrigin = "anonymous";
    probe.onload = () => {
      try{
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 24;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(probe, 0, 0, 24, 24);
        const data = ctx.getImageData(0, 0, 24, 24).data;
        let r=0, g=0, b=0, n=0;
        for(let i=0; i<data.length; i+=4){
          r+=data[i]; g+=data[i+1]; b+=data[i+2]; n++;
        }
        const color = `rgb(${Math.round(r/n)}, ${Math.round(g/n)}, ${Math.round(b/n)})`;
        _domColorCache.set(url, color);
        media.style.setProperty("--dom", color);
      }catch(e){ /* tainted canvas (no CORS) — keep the default gradient color */ }
    };
    probe.src = url;
  };
  if(img.complete && img.naturalWidth) apply(img.src);
  else img.addEventListener("load", ()=>apply(img.src), {once:true});
}

function logline(c){ return (c.description||"").split("\n").find(l=>l.trim()) || "No description yet."; }
function substMacros(text, charName, userName){ return (text||"").replace(/\{\{char\}\}/gi,charName).replace(/\{\{user\}\}/gi,userName); }
let _defaultPersonaName=null;
async function getDefaultPersonaName(){
  if(_defaultPersonaName) return _defaultPersonaName;
  try{ const ps=await api("/api/personas"); const d=ps.find(p=>p.is_default)||ps[0];
    _defaultPersonaName = (d && d.name) || "You"; }
  catch(e){ _defaultPersonaName="You"; }
  return _defaultPersonaName;
}

function previewGreeting(c){ return md(substMacros(c.greeting, c.name, "You")); }
async function previewGreetingsModal(c){
  const greetings=[c.greeting, ...(c.alt_greetings||[])].filter(g=>(g||"").trim());
  if(!greetings.length){ toast(t("doss_preview_empty")); return; }
  const userName = await getDefaultPersonaName();
  let idx=0;
  const bubble=(g,i)=>`<div class="turn ai">
    <div class="name">${esc(c.name)}${greetings.length>1?` <span class="ooc-tag">${esc(t("doss_preview_variant"))} ${i+1}/${greetings.length}</span>`:""}</div>
    <div class="md">${md(substMacros(g, c.name, userName))}</div>
  </div>`;
  const pagerHTML = greetings.length>1 ? `
    <div class="preview-pager">
      <button type="button" class="btn" id="pgPrev" aria-label="${esc(t("doss_preview_prev"))}">‹</button>
      <span class="preview-dots" id="pgDots">${greetings.map((_,i)=>
        `<button type="button" class="pg-dot${i===0?' on':''}" data-i="${i}" aria-label="${esc(t("doss_preview_variant"))} ${i+1}"></button>`).join("")}</span>
      <button type="button" class="btn" id="pgNext" aria-label="${esc(t("doss_preview_next"))}">›</button>
    </div>` : "";
  openModal(`
    <button class="modal-close" id="pgClose">${esc(t("btn_close"))}</button>
    <h3>${esc(t("doss_preview_title"))}</h3>
    <div class="preview-thread" id="pgThread">${bubble(greetings[0],0)}</div>
    ${pagerHTML}`);
  $("#pgClose").onclick=closeModal;
  if(greetings.length>1){
    const render=()=>{
      $("#pgThread").innerHTML=bubble(greetings[idx],idx);
      $("#pgDots").querySelectorAll(".pg-dot").forEach((d,i)=>d.classList.toggle("on", i===idx));
    };
    $("#pgPrev").onclick=()=>{ idx=(idx-1+greetings.length)%greetings.length; render(); };
    $("#pgNext").onclick=()=>{ idx=(idx+1)%greetings.length; render(); };
    $("#pgDots").addEventListener("click", e=>{
      const d=e.target.closest(".pg-dot"); if(!d) return;
      idx=parseInt(d.dataset.i,10); render();
    });
  }
}

