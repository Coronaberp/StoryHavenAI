"use strict";

function autosize(ta, max){ ta.style.height="auto"; ta.style.height=(max?Math.min(ta.scrollHeight,max):ta.scrollHeight)+"px"; }

const $  = s => document.querySelector(s);
const el = (h) => { const t=document.createElement("template"); t.innerHTML=h.trim(); return t.content.firstElementChild; };
const esc = s => String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const MD_QUOTE_RE=/"([^"\n]+)"/g;
const MD_QUOTE_SKIP={CODE:1,PRE:1,A:1};
const MD_QUOTE_BLOCKS="p,li,h1,h2,h3,h4,h5,h6,blockquote,dd,dt,td,th,figcaption";
function quoteTextNodes(block){
  const out=[];
  const walker=document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(n){
      for(let p=n.parentNode; p; p=p.parentNode){
        if(MD_QUOTE_SKIP[p.nodeName]) return NodeFilter.FILTER_REJECT;
        if(p.nodeType===1 && p.classList && p.classList.contains("md-quote")) return NodeFilter.FILTER_REJECT;
        if(p===block) break;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  while(walker.nextNode()) out.push(walker.currentNode);
  return out;
}
function locateOffset(map,pos){
  for(let i=map.length-1;i>=0;i--) if(pos>=map[i].start) return [map[i].node,pos-map[i].start];
  return map.length ? [map[0].node,0] : null;
}
function wrapQuotesInBlock(block){
  // Wraps quoted dialogue after marked.parse so splicing raw <span> into markdown
  // source can't leak literal tags. A quote may span several text nodes when it
  // contains inline markdown ("I *really* mean it"), so match against the block's
  // concatenated text and wrap the range with surroundContents rather than a
  // single text node — otherwise such dialogue silently loses its styling.
  let guard=0;
  for(let i=0;i<200;i++){
    const nodes=quoteTextNodes(block);
    let s=""; const map=[];
    for(const n of nodes){ map.push({node:n,start:s.length}); s+=n.nodeValue; }
    MD_QUOTE_RE.lastIndex=guard;
    const m=MD_QUOTE_RE.exec(s);
    if(!m) break;
    const a=locateOffset(map,m.index), b=locateOffset(map,m.index+m[0].length);
    if(!a||!b){ guard=m.index+1; continue; }
    const range=document.createRange();
    range.setStart(a[0],a[1]); range.setEnd(b[0],b[1]);
    const span=document.createElement("span");
    span.className="md-quote";
    try{ range.surroundContents(span); guard=0; }
    catch(e){ guard=m.index+1; }
  }
}
function wrapQuotedDialogue(root){
  const blocks=[];
  root.querySelectorAll(MD_QUOTE_BLOCKS).forEach(el=>{ if(!el.querySelector(MD_QUOTE_BLOCKS)) blocks.push(el); });
  if(!blocks.length) blocks.push(root);
  for(const block of blocks) wrapQuotesInBlock(block);
}
function md(text){
  try{
    const div=document.createElement("div");
    div.innerHTML=DOMPurify.sanitize(marked.parse(String(text||""), {gfm:true,breaks:true}));
    wrapQuotedDialogue(div);
    return div.innerHTML;
  }catch(e){ return esc(text); }
}
const AP_PREVIEW_TEXT='*She glances toward the door.* "Are you coming with us?" `I really hope so...` ***This changes everything!*** **We need to move, now.**';
