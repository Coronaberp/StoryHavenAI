"use strict";
/* ============================ BOOT ============================ */
if(typeof marked!=="undefined") marked.setOptions({gfm:true,breaks:true});
init();
startVersionWatch();
_loadEmbedLinkHosts();
_loadCustomEmojis();
