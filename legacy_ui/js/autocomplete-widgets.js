"use strict";

const PRIORITY_LANGS=["English","Chinese","Turkish","Spanish","Tagalog","Russian","French","German","Japanese","Korean","Portuguese","Italian","Arabic"];
// Only one of these dropdown-style autocomplete lists should be open at a
// time — showing a new one closes whatever else is open, like an accordion.
function _acShow(list){
  document.querySelectorAll(".lang-ac-list").forEach(l=>{ if(l!==list) l.hidden=true; });
  list.hidden=false;
}
function attachLangAC(inp){
  if(!inp) return;
  inp.removeAttribute("list");
  const wrap=document.createElement("div"); wrap.className="lang-ac";
  inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(inp);
  const list=document.createElement("div"); list.className="lang-ac-list"; list.hidden=true; wrap.appendChild(list);
  const all=[...new Set([...PRIORITY_LANGS, ...worldLanguages()])];
  const render=()=>{
    const q=inp.value.trim().toLowerCase();
    const starts=all.filter(l=>l.toLowerCase().startsWith(q));
    const has=q?all.filter(l=>!l.toLowerCase().startsWith(q)&&l.toLowerCase().includes(q)):[];
    const items=(q?[...starts,...has]:PRIORITY_LANGS).slice(0,9);
    if(!items.length){ list.hidden=true; return; }
    list.innerHTML=items.map(l=>`<div data-l="${esc(l)}">${esc(l)}</div>`).join("");
    _acShow(list);
    list.querySelectorAll("div").forEach(d=>d.onmousedown=e=>{ e.preventDefault(); inp.value=d.dataset.l; list.hidden=true; });
  };
  inp.addEventListener("input",render);
  inp.addEventListener("focus",render);
  inp.addEventListener("blur",()=>setTimeout(()=>list.hidden=true,150));
  inp.addEventListener("keydown",e=>{ if(e.key==="Escape") list.hidden=true; });
}

const FONT_SUGGESTIONS=["Georgia, serif","'Iowan Old Style', serif","'Times New Roman', serif",
  "Inter, system-ui, sans-serif","'Comic Sans MS', cursive","ui-monospace, monospace","'Courier New', monospace",
  "Lora","Playfair Display","Merriweather","Crimson Text","EB Garamond","Cormorant Garamond","Nunito","Poppins","Roboto Slab"];
function attachFontAC(inp){
  if(!inp) return;
  inp.removeAttribute("list");
  const wrap=document.createElement("div"); wrap.className="lang-ac";
  inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(inp);
  const list=document.createElement("div"); list.className="lang-ac-list"; list.hidden=true; wrap.appendChild(list);
  const render=()=>{
    const q=inp.value.trim().toLowerCase();
    const items=(q?FONT_SUGGESTIONS.filter(f=>f.toLowerCase().includes(q)):FONT_SUGGESTIONS).slice(0,9);
    if(!items.length){ list.hidden=true; return; }
    list.innerHTML=items.map(f=>`<div data-f="${esc(f)}" style="font-family:${esc(f)}">${esc(f)}</div>`).join("");
    _acShow(list);
    list.querySelectorAll("div").forEach(d=>d.onmousedown=e=>{ e.preventDefault(); inp.value=d.dataset.f; inp.dispatchEvent(new Event("input")); list.hidden=true; });
  };
  inp.addEventListener("input",render);
  inp.addEventListener("focus",render);
  inp.addEventListener("blur",()=>setTimeout(()=>list.hidden=true,150));
  inp.addEventListener("keydown",e=>{ if(e.key==="Escape") list.hidden=true; });
}

// Curated CSS named colors — the actual set of keyword colors browsers support,
// not an open free-text field where a typo like "Light Purple" silently no-ops.
const CSS_COLOR_NAMES=["black","white","gray","silver","gold","ivory","beige","brown","chocolate","maroon",
  "red","crimson","tomato","coral","salmon","orange","darkorange","yellow","khaki","olive",
  "green","forestgreen","seagreen","teal","turquoise","cyan","navy","blue","steelblue","skyblue","indigo",
  "purple","orchid","plum","violet","magenta","pink","hotpink","slateblue","slategray"];
function attachColorAC(inp){
  if(!inp) return;
  inp.removeAttribute("list");
  const swatch=inp.parentNode.querySelector(".ap-swatch");
  const wrap=document.createElement("div"); wrap.className="lang-ac";
  inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(inp);
  const list=document.createElement("div"); list.className="lang-ac-list"; list.hidden=true; wrap.appendChild(list);
  const render=()=>{
    const q=inp.value.trim().toLowerCase();
    // Keep the preview swatch in sync with whatever's actually typed, not
    // just picks from the autocomplete dropdown below — otherwise typing a
    // hex directly (the common case) leaves the swatch showing a stale
    // color while every other themed element already picked up the change.
    if(swatch && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(inp.value.trim())){
      swatch.style.background=inp.value.trim();
      swatch.dataset.value=inp.value.trim();
    }
    const items=(q?CSS_COLOR_NAMES.filter(c=>c.includes(q)):CSS_COLOR_NAMES).slice(0,9);
    if(!items.length){ list.hidden=true; return; }
    list.innerHTML=items.map(c=>`<div data-c="${c}"><span class="ac-color-dot" style="background:${c}"></span>${c}</div>`).join("");
    _acShow(list);
    list.querySelectorAll("div").forEach(d=>d.onmousedown=e=>{
      e.preventDefault(); inp.value=d.dataset.c; inp.dispatchEvent(new Event("input"));
      if(swatch){ swatch.style.background=d.dataset.c; swatch.dataset.value=d.dataset.c; }
      list.hidden=true;
    });
  };
  inp.addEventListener("input",render);
  inp.addEventListener("focus",render);
  inp.addEventListener("blur",()=>setTimeout(()=>list.hidden=true,150));
  inp.addEventListener("keydown",e=>{ if(e.key==="Escape") list.hidden=true; });
}

/* Custom in-app color picker (hue slider + saturation/value square + hex box)
   used instead of the OS-native <input type=color> dialog so it matches the
   app's own dark chrome instead of popping the browser/OS's own picker. */
function _hexToRgb(hex){
  hex=(hex||"#000000").replace("#","");
  if(hex.length===3) hex=hex.split("").map(c=>c+c).join("");
  const n=parseInt(hex,16)||0;
  return {r:(n>>16)&255, g:(n>>8)&255, b:n&255};
}
function _rgbToHsv(r,g,b){
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  let h=0;
  if(d!==0){
    if(max===r) h=((g-b)/d)%6;
    else if(max===g) h=(b-r)/d+2;
    else h=(r-g)/d+4;
    h*=60; if(h<0) h+=360;
  }
  return {h, s:max===0?0:d/max, v:max};
}
function _hsvToRgb(h,s,v){
  const c=v*s, x=c*(1-Math.abs((h/60)%2-1)), m=v-c;
  let r=0,g=0,b=0;
  if(h<60){r=c;g=x;b=0;} else if(h<120){r=x;g=c;b=0;} else if(h<180){r=0;g=c;b=x;}
  else if(h<240){r=0;g=x;b=c;} else if(h<300){r=x;g=0;b=c;} else {r=c;g=0;b=x;}
  return {r:Math.round((r+m)*255), g:Math.round((g+m)*255), b:Math.round((b+m)*255)};
}
function _rgbToHex(r,g,b){ return "#"+[r,g,b].map(v=>v.toString(16).padStart(2,"0")).join(""); }

let _cpPop=null;
function _ensureColorPopover(){
  if(_cpPop) return _cpPop;
  const pop=document.createElement("div");
  pop.className="cp-pop"; pop.hidden=true;
  pop.innerHTML=`<div class="cp-sv" id="cpSV"><div class="cp-sv-thumb" id="cpSVThumb"></div></div>
    <input type="range" id="cpHue" class="cp-hue" min="0" max="360" step="1" value="0">
    <div class="cp-hexrow"><span>#</span><input type="text" id="cpHex" maxlength="6" autocomplete="off" spellcheck="false"></div>`;
  document.body.appendChild(pop);
  _cpPop=pop;
  return pop;
}
function openColorPicker(anchor, initialHex, onChange){
  const pop=_ensureColorPopover();
  const sv=pop.querySelector("#cpSV"), thumb=pop.querySelector("#cpSVThumb"),
        hue=pop.querySelector("#cpHue"), hexInp=pop.querySelector("#cpHex");
  const start=_hexToRgb(initialHex||"#E3BD6C");
  let {h,s,v}=_rgbToHsv(start.r,start.g,start.b);
  const paint=()=>{
    sv.style.backgroundColor=`hsl(${h},100%,50%)`;
    thumb.style.left=(s*100)+"%"; thumb.style.top=((1-v)*100)+"%";
    hue.value=h;
    const {r,g,b}=_hsvToRgb(h,s,v);
    hexInp.value=_rgbToHex(r,g,b).slice(1);
  };
  const commit=()=>{ const {r,g,b}=_hsvToRgb(h,s,v); onChange(_rgbToHex(r,g,b)); };
  paint();
  pop.style.visibility="hidden"; pop.hidden=false;
  const rect=anchor.getBoundingClientRect();
  const popH=pop.offsetHeight;
  const fitsBelow=rect.bottom+6+popH <= window.innerHeight;
  pop.style.left=Math.max(8,Math.min(rect.left, window.innerWidth-236))+"px";
  pop.style.top=(fitsBelow ? rect.bottom+6 : Math.max(8,rect.top-popH-6))+window.scrollY+"px";
  pop.style.visibility="";
  const svDrag=e=>{
    const r=sv.getBoundingClientRect();
    let x=(e.clientX-r.left)/r.width, y=(e.clientY-r.top)/r.height;
    x=Math.max(0,Math.min(1,x)); y=Math.max(0,Math.min(1,y));
    s=x; v=1-y; paint(); commit();
  };
  sv.onpointerdown=e=>{ svDrag(e); sv.setPointerCapture(e.pointerId); sv.onpointermove=svDrag; };
  sv.onpointerup=sv.onpointercancel=()=>{ sv.onpointermove=null; };
  hue.oninput=()=>{ h=parseFloat(hue.value); paint(); commit(); };
  hexInp.oninput=()=>{
    const val=hexInp.value.trim();
    if(/^[0-9a-f]{6}$/i.test(val)){ const rgb=_hexToRgb("#"+val); ({h,s,v}=_rgbToHsv(rgb.r,rgb.g,rgb.b)); paint(); commit(); }
  };
  const close=()=>{ pop.hidden=true; document.removeEventListener("mousedown",onOutside); document.removeEventListener("keydown",onEsc); };
  const onOutside=e=>{ if(!pop.contains(e.target) && e.target!==anchor) close(); };
  const onEsc=e=>{ if(e.key==="Escape") close(); };
  setTimeout(()=>{ document.addEventListener("mousedown",onOutside); document.addEventListener("keydown",onEsc); },0);
}

