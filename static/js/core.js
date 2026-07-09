"use strict";

const SPARKLE_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><defs><linearGradient id="geminiGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#4285f4"/><stop offset="45%" stop-color="#9b5de5"/><stop offset="100%" stop-color="#ec4899"/></linearGradient></defs><path fill="url(#geminiGrad)" d="M12 1c.4 4.7 2.3 6.6 7 7-4.7.4-6.6 2.3-7 7-.4-4.7-2.3-6.6-7-7 4.7-.4 6.6-2.3 7-7Z"/></svg>`;

const store = (() => {
  let ok=false; try{localStorage.setItem("_t","1");localStorage.removeItem("_t");ok=true;}catch(e){}
  const m={};
  return {get:(k,d)=>{try{return (ok?localStorage.getItem(k):m[k])??d;}catch(e){return m[k]??d;}},
          set:(k,v)=>{try{ok?localStorage.setItem(k,v):m[k]=v;}catch(e){m[k]=v;}}};
})();

// One-time cleanup: the admin quick-generate panel's "remember last used"
// steps value was saved under the old 30-step default — since that default
// just changed to 20, strip the stale saved steps once so it actually picks
// up the new default instead of silently keeping showing 30 forever.
if(store.get("igAdminStepsMigration1")!=="1"){
  try{
    const saved=JSON.parse(localStorage.getItem("ig_admin_gen_state")||"null");
    if(saved && typeof saved==="object"){ delete saved.steps; localStorage.setItem("ig_admin_gen_state", JSON.stringify(saved)); }
  }catch(e){}
  store.set("igAdminStepsMigration1","1");
}

/* Served same-origin from the backend, so API base is empty by default. */
let API = store.get("api","").replace(/\/+$/,"");
let THINK = store.get("think","1")==="1";
let THEME = store.get("theme","dark");
let ME = null;
let _showingLogin = false;
let _settingsFocusNsfw = false;
// Public/shared-screen toggle: forces every NSFW-eligible image to stay
// blurred regardless of the viewer's own nsfw_allowed setting, with a
// click-to-reveal-just-this-one escape hatch (see the document click
// handler below) rather than making them re-run the whole opt-in flow.
// Defaults on — the whole point is protecting a screen someone else might
// be looking at, so it should default to the safer state, not silently
// show everything until a user remembers to flip it on themselves.
let PRIVACY_MODE = store.get("privacyMode","1")==="1";
function nsfwCanShow(c){
  if(!c) return true;
  // Standalone images carry an explicit classified:true/false flag (other
  // content types don't have this field at all, so this only ever fires for
  // them) — until classification actually confirms SFW, treat it as NSFW
  // rather than trusting the pre-classification is_explicit=false default.
  // Fail-safe over fail-open: better to briefly over-blur a real SFW image
  // than to ever show something before it's actually been rated. But this
  // must still respect an already-opted-in viewer the same way a confirmed
  // is_explicit does below — otherwise a user who enabled mature content
  // still can't see their own freshly-generated images for a few seconds.
  if(c.classified===false) return !!(ME && ME.nsfw_allowed) && !PRIVACY_MODE;
  if(!c.is_explicit) return true;
  if(PRIVACY_MODE) return false;
  if(ME && ME.nsfw_allowed) return true;
  return false;
}
function nsfwCls(c){ return nsfwCanShow(c) ? "" : " nsfw-blur"; }
function ratingBadge(c){
  if(c&&c.classified===false){
    return `<span class="rating-badge rb-nsfw" title="${esc(t("rating_pending_tip"))}">${esc(t("rating_pending_label"))}</span>`;
  }
  const explicit=!!(c&&c.is_explicit);
  const reviewed=!!(c&&c.human_reviewed);
  const lbl=explicit?"NSFW":"SFW";
  const tip=reviewed?t("rating_human_tip"):t("rating_ai_tip");
  return `<span class="rating-badge ${explicit?"rb-nsfw":"rb-sfw"}" title="${esc(tip)}">${lbl}</span>`;
}
function openNsfwGate(){
  // Deliberately no one-click "show for this session" bypass — the only way to see
  // mature content is the real, disclaimer-backed confirmation chain in Settings
  // (or being logged in at all, for the sign-in prompt below). A casual one-tap
  // reveal here would undermine the whole point of that confirmation chain.
  openModal(`<div class="nsfw-gate">
    <h3>${esc(t("nsfw_gate_title"))}</h3>
    <p>${esc(t("nsfw_gate_body"))}</p>
    <div class="nsfw-gate-actions" style="display:flex;flex-direction:column;gap:8px;margin-top:16px;">
      ${ME ? `<button type="button" class="btn primary" id="nsfwOpenSettings">${esc(t("nsfw_gate_permanent"))}</button>`
           : `<a class="btn primary" href="/">${esc(t("explore_signin_to_chat"))}</a>`}
      <button type="button" class="btn" id="nsfwGateClose" style="margin-top:4px;">${esc(t("btn_cancel"))}</button>
    </div>
  </div>`);
  if(ME) $("#nsfwOpenSettings").onclick=()=>{ closeModal(); _settingsFocusNsfw=true; $("#settingsBtn").click(); };
  $("#nsfwGateClose").onclick=()=>closeModal();
}
document.addEventListener("click", e=>{
  const blurred = e.target.closest && e.target.closest(".nsfw-blur");
  if(!blurred) return;
  e.preventDefault(); e.stopPropagation();
  // If the viewer is genuinely not opted into mature content, this is the
  // real permanent gate — always show it. But if they HAVE opted in and the
  // only reason this is blurred is Privacy Mode being on, clicking reveals
  // just this one image in place instead — a quick peek, not a setting
  // change. It naturally re-blurs on the next render since nsfwCls() is
  // re-evaluated from scratch every time.
  if(PRIVACY_MODE && ME && ME.nsfw_allowed){ blurred.classList.remove("nsfw-blur"); return; }
  openNsfwGate();
}, true);

/* ============================ UI TRANSLATION (i18n) ============================
   Static English source strings for the app chrome (nav, settings, etc). Any
   element tagged data-i18n="key" gets its textContent swapped for the translation;
   JS-generated markup should call t('key') directly. loadUiTranslations() fetches
   (and localStorage-caches) a translated copy from the backend, which itself
   batch-translates + server-side caches per language — see /api/ui-translations
   and _translate_ui_batch in server.py. English (the default) never round-trips. */
const UI_STRINGS = {
  nav_library: "Library", nav_community: "Community", nav_personas: "Personas", nav_gallery: "Image Gallery",
  nav_imagegen: "Image Experimentation Lab", nav_images: "Images", nav_forum: "Forum",
  forum_eyebrow: "COMMUNITY", forum_title: "Forum", forum_sub: "Threads, discussions, and everything in between.",
  forum_sort_new: "New", forum_sort_top: "Top", forum_new_thread: "New thread",
  forum_empty: "No threads yet. Start the first one.", forum_load_error: "Couldn't load threads — try again.", forum_pinned: "Pinned",
  forum_by: "by", forum_replies: "replies", forum_likes: "likes",
  forum_field_title: "Title", forum_field_title_ph: "What's this about?",
  forum_field_category: "Category (optional)", forum_field_category_hint: "e.g. general, feedback, bugs",
  forum_field_category_ph: "general", forum_field_body: "Body",
  forum_field_body_ph: "Write your post — markdown supported.",
  forum_post_thread: "Post thread", forum_fields_required: "Title and body are required.",
  forum_posted_toast: "Thread posted.", forum_not_found: "Thread not found.",
  forum_back: "Back to forum", forum_delete_confirm: "Delete this thread? This can't be undone.",
  forum_deleted_toast: "Thread deleted.", forum_signin_to_like: "Sign in to like this.",
  nav_notifications: "Notifications", notif_title: "Notifications",
  notif_empty: "No notifications yet.", notif_load_error: "Couldn't load notifications — try again.", notif_mark_all_read: "Mark all read",
  notif_clear_all: "Clear all", notif_clear_all_confirm: "Delete all notifications? This can't be undone.",
  notif_filter_all: "All", notif_filter_admin: "Admin", notif_filter_comments: "Comments",
  notif_filter_milestones: "Milestones",
  images_title: "Images", images_sub: "Generate new art, browse your chat gallery, and explore what the community has shared.",
  images_tab_generate: "Generate", images_tab_gallery: "Chat Gallery", images_tab_community: "Community",
  ig_panel_title: "Create", ig_preview_title: "Preview", ig_my_creations: "My Creations",
  ig_model: "Model", ig_lora_section: "LoRAs", ig_aspect: "Aspect ratio", ig_resolution: "Resolution",
  ig_sampler_section: "Sampler & scheduler", ig_sampler: "Sampler", ig_scheduler: "Scheduler",
  ig_show_more: "Show more", ig_show_less: "Show less", ig_aspect_custom: "Custom",
  ig_res_s: "S", ig_res_m: "M", ig_res_l: "L", ig_strength: "Strength",
  ig_width: "Width", ig_height: "Height",
  ig_share: "Share", ig_unshare: "Unshare", ig_shared_badge: "Shared",
  ig_share_wait_label: "Rating…", ig_share_wait: "This image hasn't finished being rated yet — try again in a moment.",
  ig_share_title: "Share to community", ig_share_body: "This image will appear in the public Community feed, attributed to your account.",
  ig_share_mature: "Mark as mature (blurred until viewers opt in)", ig_share_confirm: "Share",
  ig_share_already_nsfw: "This image was rated NSFW and will share as NSFW. If you think that's wrong, lodge a report after sharing instead of here — an admin will review it.",
  ig_shared_toast: "Shared to the community feed.", ig_unshared_toast: "Removed from the community feed.",
  ig_copy_link: "Copy share link", ig_link_copied: "Link copied — paste it in Discord/WhatsApp for a rich preview.",
  ig_shared_eyebrow: "Shared image", ig_view_on_brand: "View this image on StoryHaven AI",
  ig_community_empty: "Nothing shared yet — be the first to share a creation.",
  ig_community_by: "by",
  ig_gen_model_label: "Model:", ig_gen_loras_label: "LoRAs:",
  ig_gen_sampler_label: "Sampler:", ig_gen_scheduler_label: "Scheduler:", ig_gen_steps_label: "Steps:",
  ig_gen_type_label: "Type:", ig_gen_type_img2img: "img2img", ig_gen_type_txt2img: "txt2img",
  ig_show_more_models: "Show more models", ig_show_more_loras: "Show more LoRAs",
  ig_model_picker_title: "Choose a model", ig_model_search_ph: "Search by model name",
  ig_model_search_empty: "No models match your search.",
  ig_use_this_model: "Use this model", ig_model_pick_hint: "Select a model to preview it here.",
  ig_show_more_samplers: "Show more samplers", ig_show_more_schedulers: "Show more schedulers",
  ig_sampler_picker_title: "Choose a sampler", ig_scheduler_picker_title: "Choose a scheduler",
  ig_sampler_search_ph: "Search by sampler name", ig_scheduler_search_ph: "Search by scheduler name",
  ig_sampler_search_empty: "No samplers match your search.", ig_scheduler_search_empty: "No schedulers match your search.",
  ig_use_this_sampler: "Use this sampler", ig_use_this_scheduler: "Use this scheduler",
  ig_sampler_pick_hint: "Select a sampler to preview it here.", ig_scheduler_pick_hint: "Select a scheduler to preview it here.",
  ig_mp_tab_models: "Models", ig_mp_tab_request: "Request",
  ig_mp_hide_legacy: "Hide legacy models",
  ig_mp_request_hint: "Want a model that isn't installed? Request it here — an admin reviews and adds it manually (nothing is auto-downloaded). Links must be from: {hosts}.",
  ig_mp_find_checkpoint_hint: "Not sure where to look? On Civitai, use the Models tab and filter by Checkpoint, then by base model (e.g. SDXL 1.0 — check what this app's existing checkpoints use if unsure). The model's own page usually lists what it pairs well with (LoRAs, samplers, sometimes even a recommended upscaler) in its description.",
  ig_mp_find_upscaler_hint: "Not sure where to look? On Civitai, use the Models tab and filter by Upscaler — RealESRGAN and 4x-UltraSharp are common, widely-compatible picks. These are almost always plain .pth/.pt files, not .safetensors, even when the download link itself doesn't show an extension.",
  ig_mp_request_name: "Model name", ig_mp_request_name_ph: "e.g. Some Great Checkpoint v2",
  ig_mp_request_url: "Source URL", ig_mp_request_note: "Note (optional)",
  ig_mp_request_url_hint: "Must be the direct API download link, not the model's page URL. On Civitai: open the model, click the version's Download button once (or right-click it and \"copy link\"), and use that URL — it looks like https://civitai.com/api/download/models/12345. A plain civitai.com/models/... page link won't work.",
  ig_mp_request_note_ph: "Anything the admin should know…",
  ig_mp_request_submit: "Submit request",
  ig_mp_request_url_invalid: "Link must be from: {hosts}",
  ig_mp_request_url_malformed: "Enter a valid http(s) link.",
  ig_mp_request_url_unlisted: "This host isn't on the allowed list — the request will still be submitted, but flagged for extra admin review.",
  mr_unlisted_host: "unlisted host",
  ig_mp_request_name_required: "Model name is required.",
  ig_mp_request_submitted: "Request submitted — an admin will review it.",
  ig_mp_request_history: "Your requests", ig_mp_request_history_empty: "You haven't requested any models yet.",
  ig_mp_request_type: "Type",
  ig_mp_request_type_checkpoint: "Standard checkpoint",
  ig_mp_request_type_anima: "Anima (UNET + text encoder + VAE)",
  ig_mp_request_vae_url: "VAE download link (optional)",
  ig_mp_request_vae_url_hint: "On Civitai, scroll to the model's \"Required Components\" section and click the small download icon next to VAE (not the big \"Download All Components\" button) — copy that link the same way as the main Source URL above.",
  ig_mp_request_encoder_url: "Text encoder download link (optional)",
  ig_mp_request_encoder_url_hint: "On Civitai, scroll to the model's \"Required Components\" section and click the small download icon next to Text Encoder (not the big \"Download All Components\" button) — copy that link the same way as the main Source URL above.",
  ig_lora_picker_title: "Choose LoRAs", ig_lora_search_ph: "Search by LoRA name",
  ig_lora_search_empty: "No LoRAs match your search.", ig_lora_done: "Done",
  ig_lora_request_hint: "Want a LoRA that isn't installed? Request it here — an admin reviews and adds it manually (nothing is auto-downloaded). Links must be from: {hosts}.",
  ig_lora_request_name: "LoRA name", ig_lora_request_name_ph: "e.g. Some Great LoRA v2",
  ig_lora_request_history_empty: "You haven't requested any LoRAs yet.",
  ig_show_models_btn: "Show models", ig_show_loras_btn: "Show LoRAs",
  ig_upscaler_request_link: "Request an upscaler",
  ig_upscaler_request_title: "Request an upscaler",
  ig_upscaler_request_hint: "Want an upscaler that isn't installed? Request it here — an admin reviews and adds it manually (nothing is auto-downloaded). Links must be from: {hosts}.",
  mr_copy_curl: "Copy curl", mr_curl_copied: "Curl command copied to clipboard.",
  mr_anima_hint: "If this turns out to be an Anima-architecture model, it may also need a matching text-encoder + VAE (check the model's page for \"Required Components\") — try the shared qwen_3_06b_base.safetensors/qwen_image_vae.safetensors pair first, or set a per-checkpoint override in Model & LoRA previews once it's installed.",
  mr_fulfilled: "Downloaded",
  mr_approved_manual: "Approved — unfortunately dev needs to manually download this.",
  ig_page_title: "Image Experimentation Lab", ig_page_sub: "Use this to ideate and create images for your desired characters.",
  ig_unsaved_warning: "Images are not saved unless you choose to save them — they will be destroyed.",
  ig_positive_ph: "Describe what you want to see…", ig_negative_ph: "Things to avoid (optional)…",
  ig_prompt_hint: "Separate tags with commas (danbooru-style, e.g. \"1girl, red hair, forest\"). Wrap a tag in parentheses with a weight to strengthen or weaken it, e.g. (red hair:1.3) emphasizes it, (red hair:0.7) de-emphasizes it — 1.0 is normal weight.",
  ig_generate: "Generate", ig_generating: "Generating…", ig_stop: "Stop", ig_save: "Save", ig_regenerate: "Regenerate", ig_discard: "Discard",
  ig_upscale: "Upscale", ig_upscaling: "Upscaling…", ig_upscale_failed: "Upscale failed",
  ig_picker_title: "Generate an image", ig_use_image: "Use this image",
  img_gen_no_checkpoints: "No image generation models found — check Settings.",
  ig_saved_title: "Saved images", ig_saved_empty: "Nothing saved yet.",
  ig_save_failed: "Save failed", ig_saved_toast: "Saved to your Image Gallery.",
  gallery_title: "Image Gallery", gallery_sub: "Every image generated across your chats — manage or delete them here.",
  gallery_empty: "No images yet — generate one from any assistant reply in a chat.",
  gallery_delete_confirm: "confirm delete", gallery_deleted: "Image deleted.", gallery_delete_failed: "Delete failed",
  gallery_delete_confirm_msg: "Delete this image? This cannot be undone.",
  gallery_open_chat: "Open chat",
  gallery_scene_label: "Scene", gallery_positive_label: "Positive tags", gallery_negative_label: "Negative tags",
  gallery_tags_unrecorded: "Tags weren't recorded for this image (generated before this feature was added).",
  gallery_copy_tags: "Copy", gallery_tags_copied: "Tags copied.", gallery_download: "Download image",
  nav_admin: "Admin", nav_new_character: "New character", recent_chats: "Recent chats",
  btn_settings: "Settings", sign_out: "Sign out", nav_profile: "View profile",
  theme_dark_mode: "Dark mode", theme_light_mode: "Light mode",
  privacy_mode_off: "Privacy mode", privacy_mode_on: "Privacy mode (on)",
  settings_title: "Settings", settings_theme: "Theme",
  settings_password_heading: "Password", settings_password_current: "Current password",
  settings_password_new: "New password", settings_password_new_hint: "at least 8 characters",
  settings_password_confirm: "Confirm new password", settings_password_change_btn: "Change password",
  settings_password_changed: "Password changed.", settings_password_mismatch: "New passwords don't match.",
  settings_tab_general: "General", settings_tab_model: "Model & Generation",
  settings_tab_advanced: "Advanced", settings_tab_admin: "Admin",
  theme_light: "Light", theme_light_hint: "Warm paper",
  theme_dark: "Dark", theme_dark_hint: "Low-light",
  settings_language_heading: "Language",
  settings_iface_lang: "Interface language",
  settings_iface_lang_hint: "everything you read is translated into this. A chat's 🌐 language, if set, overrides it for that chat's replies and thoughts. Any language.",
  settings_llm_endpoint: "My LLM endpoint",
  settings_use_own_endpoint: "Use my own LLM endpoint",
  settings_past_messages: "Past messages", settings_past_messages_hint: "turns of chat sent to the model",
  settings_max_tokens: "Max reply tokens", settings_max_tokens_hint: "length cap on each response",
  settings_thinking_default: "Thinking on by default",
  settings_advanced_sampling: "Advanced sampling",
  settings_prompt_injection: "Prompt injection",
  btn_save_settings: "Save settings", btn_reset_defaults: "Reset to defaults",
  btn_close: "Close",
  lib_eyebrow: "My characters", lib_title: "Library",
  lib_tab_all: "Active", lib_tab_pending: "Pending", lib_no_drafts: "No pending drafts.",
  lib_sub: "Characters you've created or imported — private to you.",
  comm_eyebrow: "Shared catalog", comm_title: "Community",
  comm_sub: "Characters shared by all users. Anyone can start a chat; only admins can delete.",
  comm_sub_creators: "Creators who've published something publicly. Click one to see their profile and bots.",
  comm_sub_images: "Images shared publicly by the community.",
  search_placeholder: "Search by name, persona, or tag",
  browse_filters: "Filters",
  browse_tab_bots: "Bots", browse_tab_creators: "Creators", browse_tab_images: "Images",
  browse_filter_creator: "From a specific creator",
  browse_filter_tag: "With a specific tag",
  browse_creator_bots: "bots",
  empty_creators: "No creators found.", cc_you: "You",
  personas_eyebrow: "Personas", personas_title: "Who you are",
  personas_sub: "Define how characters see you. {{user}} becomes the persona's name, and its description is shared with the character. Pick one when you start a chat.",
  btn_new_persona: "New persona",
  btn_add_entry: "Add entry",
  tool_copy: "copy", tool_translate: "translate", tool_regenerate: "regenerate",
  tool_edit: "edit", tool_continue: "continue", tool_continue_with: "continue with...",
  tool_image: "🎨 image", tool_image_regen: "🎨 regenerate image", tool_image_confirm: "confirm 🎨",
  img_gen_title: "Generate image", img_gen_checkpoint: "Model",
  img_gen_lora: "LoRAs (optional)", img_gen_lora_none: "None", img_gen_strength: "LoRA strength",
  img_gen_lora_add: "Add LoRA",
  img_gen_reference: "Reference image (optional)", img_gen_reference_hint: "Guide the result toward this image's composition/colors/pose",
  img_gen_reference_pick: "Add reference image", img_gen_denoise: "Match strength",
  img_gen_reference_remove: "Remove reference image",
  img_gen_denoise_hint: "Lower = closer to your reference image's composition, colors, and pose. Higher = more freedom for the prompt to diverge from it.",
  ig_steps: "Steps",
  ig_steps_hint: "How many denoising iterations the sampler runs. Fewer steps are faster but rougher; more steps refine detail with diminishing returns — most samplers look good around 20-30.",
  ig_cfg: "CFG",
  ig_cfg_hint: "How closely the image sticks to your prompt. Lower values give the model more creative freedom (and can look more natural); higher values follow your wording more strictly but can look over-sharpened or artificial past a point — most checkpoints look good around 5-8.",
  ig_steps_model_default: "This checkpoint has a saved default of {n} steps.",
  ig_anima_prompt_hint: "Anima understands plain natural-language sentences, not just comma-separated tags — write this as you'd describe the scene to a person. Danbooru-style tags are still supported though, and in fact recommended for precise control over specific details.",
  ig_flux_v2_note: "Flux V2 model selected — generation isn't wired up for this architecture yet.",
  ig_details_btn: "Details", ig_details_title: "Generation details",
  ig_details_checkpoint: "Checkpoint", ig_details_architecture: "Architecture", ig_details_loras: "LoRAs",
  ig_details_sampler: "Sampler", ig_details_scheduler: "Scheduler", ig_details_steps: "Steps",
  ig_details_cfg: "CFG", ig_details_denoise: "Denoise",
  img_gen_generate: "Generate", img_gen_failed: "Image generation failed",
  img_gen_positive: "Positive prompt", img_gen_negative: "Negative prompt",
  img_gen_prompt_loading: "Generating prompt from the scene…", img_gen_prompt_failed: "Couldn't auto-generate — type your own prompt",
  dir_image: "Image", dir_image_generating: "Generating image…",
  tool_delete: "delete",
  chatting_as: "chatting as",
  ph_rpg: "Describe what you do… or type / for commands",
  ph_char: "Write your reply… or type / for commands",
  style_word: "Style",
  style_title: "Response Style",
  style_sub: "Pick the vibe — tap ⓘ on a card to see its instruction.",
  style_yours: "Your styles", style_create: "Create style",
  style_sent: "Sent to the model",
  style_unspecified: "Unspecified", style_unspecified_desc: "Creator's intended voice / system default",
  style_roleplay: "Roleplay", style_roleplay_desc: "Narrative-driven and immersive storytelling",
  style_lust: "Lust", style_lust_desc: "Flirtatious, suggestive, and NSFW",
  style_romance: "Romance", style_romance_desc: "Warm, intimate, and affectionate",
  style_casual: "Casual", style_casual_desc: "Short, relaxed, and straight to the point",
  btn_new: "New",
  doss_start: "Start a new chat", doss_lorebook: "Lorebook", doss_edit: "Edit",
  doss_export: "Export card", doss_delete: "Delete",
  doss_export_v2: "Export as V2 card", doss_export_v3: "Export as V3 card",
  doss_export_storyhaven: "Export as StoryHaven AI proprietary JSON (full fidelity)",
  doss_persona: "Persona", doss_scenario: "Scenario", doss_opening: "Opening line",
  doss_preview: "Preview", doss_preview_title: "Greeting preview", doss_preview_variant: "Variant",
  doss_preview_prev: "Previous greeting", doss_preview_next: "Next greeting",
  doss_share: "Share", doss_share_copied: "Link copied — paste it in Discord/WhatsApp for a rich preview.",
  doss_comments: "Comments",
  doss_preview_empty: "This character has no greeting to preview yet.",
  compliance_title: "Custom card needs changes",
  compliance_body: "Your custom HTML/CSS for this page is non-compliant: as rendered it makes the page unusable (it's far too tall or the source is grossly oversized). You must edit it or remove it before it can be shown.",
  compliance_edit: "Edit",
  compliance_leave: "Leave",
  compliance_leave_title: "Remove custom HTML/CSS?",
  compliance_leave_body: "Leaving will permanently delete your custom HTML/CSS for this page and restore the default styling. Download a copy first if you want to keep it.",
  compliance_download: "Download",
  compliance_back: "Back",
  compliance_confirm_leave: "Delete and leave",
  compliance_halt: "All functionality on this page is halted until this is resolved. You can only Edit, Leave (delete), or Sign out.",
  compliance_reason_generic: "The custom HTML/CSS failed the page compliance check.",
  compliance_reason_external_link: "Contains a link to an external site: {url} — only the {{share}}/{{edit}}/{{characters}} placeholders can create working links.",
  compliance_reason_missing_comments: "Missing the required {{comments}} placeholder — every custom card must include a working Comments button via {{comments}}.",
  compliance_reason_missing_block: "Missing the required {{block}} placeholder — every custom profile must include a working Block button via {{block}}.",
  compliance_reason_forced_height: "html or body has height: 100% — this collapses your page inside the preview frame and silently hides everything below the fold. Remove it (leave height alone, or use min-height instead).",
  doss_stat_lore: "Lore Pieces", doss_stat_messages: "Messages", doss_stat_greetings: "Greetings", doss_stat_chats: "Chats",
  doss_created: "Created", doss_expand: "Expand", doss_collapse: "Collapse",
  doss_lore_linked: "Key Lore Pieces Linked to this Character", doss_lore_untitled: "Untitled entry",
  doss_lore_group: "Lore Entry", doss_lore_global: "Global", doss_lore_always: "Always on", doss_lore_all: "All",
  doss_lore_card_title: "Key Lore", doss_lore_empty: "No lore entries yet.",
  doss_lore_untagged: "Untagged", doss_lore_page: "Page",
  badge_rpg: "RPG", badge_character: "Character",
  ed_edit: "Edit", ed_new: "New character", ed_create_title: "Create a character",
  ed_sub: "Fill the sheet, or drop in a card from SillyTavern, chub.ai, RisuAI, SpicyChat…",
  ed_import_t: "Import a character card",
  ed_mode: "Mode", ed_mode_hint: "how every chat with this character behaves",
  ed_mode_char: "Character", ed_mode_char_hint: "They are this person; first-person roleplay.",
  ed_mode_rpg: "RPG · Game Master", ed_mode_rpg_hint: "They narrate a world, run NPCs, and call for dice.",
  ed_avatar: "Avatar", ed_avatar_hint: "shown in the library and chat header",
  ed_banner: "Banner", ed_banner_hint: "wide image shown at the top of the character page",
  crop_title: "Crop image", crop_zoom: "Zoom", crop_apply: "Apply",
  ed_upload: "Upload", ed_remove: "Remove", ed_ava_url_ph: "…or paste an image / GIF URL",
  ed_name: "Name",
  ed_src_manual: "Manual", ed_src_manual_hint: "fill in the fields yourself",
  ed_src_generate: "Generate with AI", ed_src_generate_hint: "describe them and let the AI draft the fields",
  ed_gen_label: "Describe your character", ed_gen_hint: "a free-form description — the AI turns it into the fields below for you to review",
  ed_gen_ph: "e.g. A grumpy dwarven blacksmith who secretly writes poetry, lives in a mountain village, speaks in short gruff sentences but softens around children.",
  ed_gen_btn: "Generate", ed_gen_working: "Generating…", ed_gen_empty: "Write a description first.",
  ed_gen_done: "Draft ready — review and tweak, then Save.", ed_gen_fail: "Generation failed",
  ed_description: "Description", ed_description_hint: "public — shown on cards and listings",
  ed_persona: "Persona", ed_persona_hint: "who they are — personality, appearance, voice. Private — sent to the AI only, never shown publicly",
  ed_scenario: "Scenario", ed_scenario_hint: "the situation when a chat opens. Private — sent to the AI only, never shown publicly",
  ed_opening: "Opening line", ed_opening_hint: "their first message",
  ed_dialogue: "Example dialogue", ed_dialogue_hint: "optional — teaches their speaking style",
  ed_tags: "Tags", ed_tags_hint: "comma separated",
  ed_share: "Share with community — visible to all users; only you and admins can delete",
  ed_save: "Save changes", ed_create: "Create character", ed_cancel: "Cancel",
  stage_summary: "Stage — backgrounds, music & sprites (visual novel)",
  stage_bg: "Default background", stage_music: "Default music", stage_sprite: "Default sprite",
  stage_moods: "Moods", stage_add_mood: "Add mood",
  pres_summary: "Presentation — custom page HTML (advanced)",
  pres_sub: "Optional. Replaces the default character page layout with your own HTML/CSS, sanitized before render. Leave blank to use the default StoryHaven layout.",
  pres_code_label: "HTML / CSS", pres_preview_label: "Preview",
  pres_b64_warning: "Don't paste base64 (data:image/…;base64,…) images in here — they bloat the page and make it slow to load. Instead, open a lore entry's edit form, upload the image there, and use its \"Copy URL\" button to get a real image link (https://…/media/…) — then use that in an <img src=\"…\"> tag below.",
  pres_no_external_links: "No external links allowed in custom cards — the guy who built this platform comes from a cybersecurity background and is frankly a bit of a paranoid asshole about protecting users, so saving is blocked if your HTML links off-platform. Exception: dedicated font services — Google Fonts (fonts.googleapis.com/fonts.gstatic.com), Bunny Fonts (fonts.bunny.net), Adobe Fonts/Typekit (use.typekit.net/p.typekit.net), and Fontshare (api.fontshare.com/cdn.fontshare.com) — are allowed for loading fonts (@import/url() inside a <style> tag only, not as a clickable link).",
  pres_external_link_found: "Your custom HTML links off-platform ({url}). Remove it before you can save.",
  pres_prompt_tip: "Tip: ask ChatGPT, Grok, or Gemini to design this for you — describe the character/vibe and ask for a single self-contained HTML snippet with an inline <style> block, no JavaScript, no external images (you'll swap in your own lore image URLs after), and no fixed pixel widths so it stays readable on mobile. This field is a plain textarea and gets unwieldy for anything long — write and edit the HTML/CSS in a real text editor (VS Code, Notepad++, etc.) and paste the finished result in here rather than editing it directly in this box.",
  tagline: "Forge worlds. Remember everything.", nav_more: "More",
  li_username: "Username", li_password: "Password", li_signin: "Sign in",
  explore_link: "Just want to look around? Explore without an account →",
  explore_signin_to_chat: "Sign in to chat",
  explore_signin_register: "Sign in / Register",
  explore_nsfw_notice: "Explicit characters are hidden — sign in to see them.",
  comm_sfw: "SFW", comm_nsfw: "NSFW", comm_mode_all: "All",
  li_noacct: "Don't have an account?", li_request: "Request access",
  li_haveacct: "Already have an account?", li_confirm_pw: "Confirm password",
  li_min8: "min 8 characters", li_pending_t: "Access requested",
  li_pending_p: "is pending admin approval.", li_pending_p2: "You'll be able to sign in once approved.",
  li_back: "Back to sign in",
  li_forgot: "Forgot password?",
  li_forgot_t: "Reset password",
  li_forgot_p: "Enter your username. If the account exists, an admin will review your request and set a new password for you.",
  li_forgot_sent: "If that account exists, an admin will review your request.",
  li_err_req: "Username and password required.", li_err_match: "Passwords do not match.",
  btn_cancel: "Cancel", btn_save: "Save", btn_delete: "Delete", btn_retry: "Retry",
  pm_edit: "Edit persona", pm_new: "New persona",
  pm_desc: "Description", pm_desc_hint: "how the character perceives you",
  pm_desc_ph: 'Type a full persona, or just type some descriptors (e.g. "witty rogue, sarcastic, loyal to friends, hates authority") and click ✨ to expand them into a full persona.',
  pm_expand_title: "Expand with AI",
  pm_expand_empty: "Type something first.",
  pm_expand_done: "Persona expanded — review and tweak, then Save.",
  pm_expand_fail: "Expansion failed",
  pm_expand_example_summary: "See an example",
  pm_expand_example_in_label: "You type:",
  pm_expand_example_in: '"witty rogue, sarcastic, loyal to friends, hates authority"',
  pm_expand_example_out_label: "✨ becomes:",
  pm_expand_example_out: "Tarion is a quick-witted rogue with a sharp tongue and sharper instincts, shaped by years of staying one step ahead of city guards. He trusts authority about as far as he can throw it, but the few who've earned his loyalty get it fiercely — sarcasm is his first language and his best defense.",
  pm_default: "Use as my default persona",
  lm_edit: "Edit lore entry", lm_new: "New lore entry",
  lm_keys: "Trigger keywords", lm_keys_hint: "comma separated — blank = semantic-only",
  lm_content: "Content", lm_content_hint: "what gets injected",
  lm_always: "Always on (inject every turn)", lm_global: "Global (applies to all characters)",
  lm_name: "Name", lm_name_hint: "Display name for this entry — separate from trigger keywords",
  lm_image: "Image", lm_has_image: "This entry has an image", lm_category: "Category", lm_category_hint: "e.g. Character, Location, Item — shown as the entry's label",
  lm_appearance_tags: "Appearance tags (image generation)",
  lm_appearance_tags_hint: "optional — pre-written Danbooru tags used verbatim when generating images of this, instead of being rewritten by the AI",
  lm_appearance_tags_ph: "e.g. red hair, twin braids, golden eyes, black and gold uniform",
  lm_appearance_tags_negative: "Appearance tags — negative (image generation)",
  lm_appearance_tags_negative_hint: "optional — Danbooru tags to avoid for this, used verbatim ahead of the AI's own negative tags",
  lm_appearance_tags_negative_ph: "e.g. glasses, scar, short hair",
  lm_owner_tags_summary: "Image generation tags", lm_owner_tags_lock: "Only you can see this",
  lm_owner_tags_hint: "Visible only to you, the owner — never shown to other users viewing this entry.",
  lm_copy_url: "Copy URL", lm_url_copied: "URL copied.",
  lm_image_url_hint: "Paste this URL into an <img src=\"…\"> in your custom Presentation HTML instead of a base64 data URI — much lighter and it stays cached across visits.",
  lm_category_default: "Lore", btn_close: "Close", btn_edit: "Edit", btn_delete: "Delete", yes: "Yes", no: "No",
  nsfw_gate_title: "Mature content",
  nsfw_gate_body: "This character contains mature/explicit (18+) content, hidden behind a blur.",
  nsfw_gate_permanent: "Allow mature content permanently (Settings)",
  settings_nsfw_heading: "Mature content",
  settings_nsfw: "Show mature (18+) content",
  settings_nsfw_hint: "Unblurs images from characters marked explicit. Turning this on requires confirming you are 18+.",
  nsfw_c1: "This unlocks mature/explicit (18+) content across the app, including blurred images. Continue?",
  nsfw_c1_go: "Continue",
  nsfw_c2: "Are you 18 years of age or older?",
  nsfw_c2_go: "Yes, I am 18 or older",
  nsfw_c3: "By enabling this, you confirm you are at least 18 years old, are accessing this content voluntarily, and take full personal responsibility for doing so — the operator of this instance assumes no liability for your use of this feature.",
  nsfw_c3_go: "I accept full responsibility",
  nsfw_c4: "Final confirmation — I confirm I am at least 18 and want to see mature content.",
  nsfw_c4_go: "Enable mature content",
  nsfw_enabled_toast: "Mature content enabled.",
  nsfw_disabled_toast: "Mature content disabled.",
  nsfw_update_failed: "Couldn't update mature-content setting",
  rating_ai_tip: "AI-rated — may not be accurate",
  rating_human_tip: "Human reviewed by an admin",
  rating_pending_label: "Rating…", rating_pending_tip: "Still being checked — treated as NSFW until this finishes.",
  rating_line_ai: "AI-rated, not human-verified",
  rating_line_human: "Human reviewed",
  rating_label: "Rated",
  report_open: "Lodge a report",
  report_title: "Report this rating",
  report_intro: "Think this rating is wrong? Let an admin know.",
  report_as_nsfw: "Report as NSFW",
  report_as_sfw: "Report as SFW",
  report_note_label: "Note (optional)",
  report_note_ph: "Optional note (why do you think the rating is wrong?)",
  report_submit: "Submit report",
  report_sent: "Report sent. Thanks — an admin will review it.",
  report_failed: "Couldn't send report",
  adm_image_reports: "Image rating reports",
  adm_review: "Review",
  adm_review_title: "Review image rating",
  adm_review_reported: "Reported as",
  adm_review_current: "Current rating",
  adm_review_note_label: "Admin note (optional)",
  adm_review_note_ph: "Optional: why you rated it this way (admin note)",
  adm_review_resolved: "Rating updated.",
  adm_review_failed: "Couldn't resolve report",
  lm_hidden: "Hide content from other users", lm_hidden_notice: "Creator hid this description",
  play_as: "Play as…", just_you: "Just “You”", no_persona: "no persona",
  play_as_character: "Or play as a character", ed_can_be_persona: "Others can play as this character",
  ed_allow_download: "Allow others to export/download this card",
  ed_is_explicit: "Explicit / 18+ content — hidden from anonymous Explore visitors",
  mem_title: "This chat's memory", loading: "Loading…",
  reply_lang: "Reply language", authors_note: "Author's Note",
  cs_edit: "Edit Custom Style", cs_new: "New Custom Style",
  chats_word: "chats", by_word: "by",
  empty_lib: "No characters yet.", empty_lib_hint: "Create one or import a card to get started.",
  empty_comm: "No community characters yet.", empty_comm_hint: "Share a character from the editor to make it appear here.",
  empty_search: "Nothing matches.",
  empty_personas: "No personas yet.", empty_personas_hint: "Add one to give the character a sense of who you are.",
  empty_lore: "No lore yet.", empty_lore_hint: "Add world facts, NPCs, places, rules — they'll surface in chat automatically.",
  no_chats_yet: "No chats yet.",
  right_now: "right now",
  back_to_library: "Back to library",
  settings_scene: "Scene-style replies",
  settings_scene_hint: "every reply opens with DATE / TIME / LOCATION badges and characters' inner thoughts appear inline",
  pf_accent: "Theme gradient", pf_banner_img: "Banner image",
  pf_joined: "Joined", pf_characters: "Characters", pf_chats: "chats",
  pf_edit: "Edit profile", pf_display: "Display name", pf_bio: "About me",
  pf_bio_hint: "shown on your public page", pf_banner: "Banner color",
  pf_no_chars: "No public characters yet.", pf_not_found: "No such creator.",
  pf_upload_ava: "Change avatar", pf_saved: "Profile saved.", pf_admin: "Administrator",
  pf_title: "Custom title", pf_title_hint: "a short badge shown next to your name, subject to admin approval",
  pf_title_ph: "e.g. Creator", pf_title_status_pending: "Pending admin approval",
  pf_title_status_approved: "Approved", pf_title_status_rejected: "Rejected — not shown publicly",
  pf_ava_hint: "shown next to your username; GIFs supported", pf_banner_hint: "wide image at the top of your profile; static images only, no GIFs",
  pf_social: "Social", pf_social_twitter: "Twitter", pf_social_twitch: "Twitch",
  pf_social_instagram: "Instagram", pf_social_discord: "Discord", pf_social_pixiv: "Pixiv",
  pf_social_youtube: "YouTube", pf_social_patreon: "Patreon", pf_social_kofi: "Ko-fi",
  pf_html_summary: "Advanced: Custom HTML/CSS",
  pf_html_sub: "Optional. Replaces your entire profile page — banner, avatar, bio, and the Characters grid all become whatever you build here. Leave blank to keep the default layout above.",
  pf_html_placeholders: "Text placeholders (replaced with your live data before rendering):",
  pf_html_title_label: "Your custom title:", pf_html_title_hint: "{{title}} is replaced with your admin-approved custom title/badge — blank if you don't have one (a pending or rejected title never renders here). It's raw text unless you wrap it yourself, so put it inside your own element and style that element as a badge.",
  pf_html_title_example: "Example — wrap it and style the wrapper. CSS alone can't hide an empty inline text node, so keep the wrapper minimal/unobtrusive by default (not a big pre-styled box) so an empty one doesn't look like a broken placeholder:",
  pf_html_characters_label: "Embedding your character cards:", pf_html_characters_hint: "put {{characters}} anywhere in your markup and it's replaced with a real grid of your published scenarios (thumbnail, title, summary, chat count, up to 3 tags) — each linking to that scenario's page. Style the grid with these classes: .gl-characters (grid container), .gl-character-card (each card, an <a> link), .gl-character-thumb (image wrapper — the actual <img> inside is .gl-character-img), .gl-character-title, .gl-character-summary, .gl-character-meta (the row holding chat count + tags), .gl-character-chats (just the number — its 💬 icon comes from a ::before you can override), .gl-character-tags (wraps each individual .gl-tag pill). These come with working default styles you can freely override — no property is required, override only what you want to change; anything else keeps looking right.",
  pf_html_links_label: "Embedding your links:", pf_html_links_hint: "put {{links}} anywhere in your markup and it's replaced with favicon links for whichever of Twitter, Twitch, Instagram, Discord, Pixiv, YouTube, Patreon, and Ko-fi you filled in above (leave them blank to omit them entirely). Style them with .gl-links (row container), .gl-link (each <a>, has a data-platform=\"twitter\"/etc attribute you can target and a --gl-color custom property set to that platform's brand color), .gl-link-icon (the svg), .gl-link-host (a text label with the platform's domain, hidden by default — set it to display:inline to show text alongside the icon).",
  pf_html_share_label: "Embedding a share button (required):", pf_html_share_hint: "put {{share}} anywhere in your markup and it's replaced with a working \"Share\" link that copies your profile's link-preview URL (what Discord/WhatsApp/Slack unfurl into a rich card) to the clipboard. Every custom layout must include it somewhere — saving is blocked otherwise. Style it with .gl-share (the <a> itself, already has a default pill style you can override).",
  pf_html_edit_label: "Embedding an edit button (required):", pf_html_edit_hint: "put {{edit}} anywhere in your markup and it's replaced with a working \"Edit profile\" link that reopens this editor — visible only to you, blank for every other visitor. Without it you'd have no way back into this editor once your custom layout hides the default one. Every custom layout must include it somewhere — saving is blocked otherwise. Style it with .gl-edit (already has a default pill style you can override).",
  pf_html_share_required: "Your custom HTML must include a {{share}} placeholder somewhere before you can save.",
  pf_html_edit_required: "Your custom HTML must include an {{edit}} placeholder somewhere before you can save.",
  pf_html_comments_label: "Embedding a comments button (required):", pf_html_comments_hint: "put {{comments}} anywhere in your markup and it's replaced with a working \"Comments\" button (with live reply count) that opens this profile's comment thread — wherever you place it in your design, instead of a bar bolted above your layout. Every custom layout must include it somewhere — saving is blocked otherwise. Style it with .gl-comments (already has a default pill style you can override).",
  pf_html_comments_required: "Your custom HTML must include a {{comments}} placeholder somewhere before you can save.",
  pf_html_block_label: "Embedding a block button (required):", pf_html_block_hint: "put {{block}} anywhere in your markup and it's replaced with a working \"Block\" button (blank for your own profile) — every visitor needs a way to block you without depending on a bar bolted above your layout. Every custom layout must include it somewhere — saving is blocked otherwise. Style it with .gl-block (already has a default pill style you can override).",
  pf_html_block_required: "Your custom HTML must include a {{block}} placeholder somewhere before you can save.",
  pf_html_height_blocked: "Remove height: 100% from html/body — it collapses your page inside the preview frame and silently hides everything below the fold. See the warning note above for why.",
  pf_html_no_external_links: "No external links allowed in custom cards — the guy who built this platform comes from a cybersecurity background and is frankly a bit of a paranoid asshole about protecting users, so only the placeholders below can create working links. Exception: dedicated font services — Google Fonts (fonts.googleapis.com/fonts.gstatic.com), Bunny Fonts (fonts.bunny.net), Adobe Fonts/Typekit (use.typekit.net/p.typekit.net), and Fontshare (api.fontshare.com/cdn.fontshare.com) — are allowed for loading fonts (@import/url() inside a <style> tag only, not as a clickable link).",
  pf_html_external_link_found: "Your custom HTML links off-platform ({url}) — only the placeholders below can create working links. Remove it before you can save.",
  pf_html_vars_label: "CSS variables:", pf_html_vars_hint: "var(--profile-gradient-start) and var(--profile-gradient-end) hold your chosen Theme Gradient colors from above. If you've uploaded a Banner Image, var(--profile-banner-url) is also available (e.g. background-image: var(--profile-banner-url)) — it's only defined when a banner exists.",
  pf_html_height_label: "⚠ Don't force full-page height:", pf_html_height_hint: "your design renders inside a sandboxed frame that auto-sizes itself to fit your content after it loads — do NOT set height: 100% on html, body, or any top-level wrapper, and do NOT use overflow-y: auto/scroll on a section meant to hold your whole page. Those tell the browser \"stay exactly this tall, clip anything past it\" — with no fixed frame size yet to be 100% OF, that collapses to almost nothing and everything below the fold silently vanishes (this has bitten real profiles — the page looks fine up to the banner, then goes blank). Let the page grow naturally: use width: 100% freely, but leave height alone (or use min-height if you want a tall minimum) so the page's real height determines the frame's height, not the other way around.",
  pf_html_example: "Example:",
  pf_html_upload_btn: "Upload HTML/CSS File", pf_html_code_label: "HTML / CSS", pf_html_preview_label: "Live preview",
  pf_html_download_btn: "Download current HTML/CSS", pf_html_clear_btn: "Clear HTML/CSS",
  pf_html_clear_confirm: "Clear all custom HTML/CSS? This can't be undone once you save.",
  ed_reimport: "Reimport from card",
  ed_reimport_done: "Card reimported — fields updated.",
  setting_up: "Setting up the story…",
  setting_up_hint: "translating the opening into your language — this only happens the very first time anyone opens this character",
  ed_ava_drag: "drag the preview to choose which part of the image shows",
  ed_creator: "Creator", ed_creator_hint: "shown in the byline",
  ed_sysprompt: "System prompt", ed_sysprompt_hint: "from the card — injected into the built-in prompt when set",
  ed_altgreet: "Alternate greetings", ed_altgreet_hint: "the card's alternative opening lines — kept with the card and included on export",
  ed_add_greeting: "Add greeting",
  glossary_title: "Glossary",
  glossary_sub: "Pin how specific terms must be translated in this chat — class names, spells, ranks. The translator will use your rendering exactly, every time.",
  glossary_term: "term (any language)", glossary_rendering: "always translate as",
  glossary_add: "Add term", glossary_saved: "Glossary saved.",
  conn_checking: "checking…",
  log_debug: "Debug & up", log_info: "Info & up", log_warn: "Warnings & up", log_err: "Errors only",
  log_empty: "No log entries at this level yet.", log_fail: "Failed to load logs:",
  cs_nothing: "Nothing tracked yet — this builds up as the story continues.",
  search_failed: "Search failed:",
  stage_sub: "Paste image / audio URLs. The default shows at the start of every chat. Add moods to swap background, music, and sprite when the character's reaction matches — the model tags its own mood, and the scene follows.",
  set_extra_fields: "Extra request fields",
  set_save_global: "Save global config",
  ap_title: "Appearance (this device)", ap_font: "Font", ap_text: "Text color",
  ap_font_hint_pre: "any installed font stack, or a bare name from ", ap_font_hint_link: "Google Fonts",
  ap_font_hint_post: " (e.g. Lora) to load it automatically",
  ap_accent: "Accent / tabs", ap_size: "Font size px", ap_appbg: "App background",
  ap_chatbg: "Chat background", ap_reset: "Reset appearance",
  ap_md_reset: "Reset to default",
  ap_md_title: "Message formatting", ap_msgfont: "Google Font",
  ap_msgfont_hint_pre: "Enter any family name from ", ap_msgfont_hint_link: "Google Fonts",
  ap_msgfont_hint_post: ". Applies to chat message text only.",
  ap_narration: "Narration *", ap_dialogue: "Dialogue “”", ap_thoughts: "Thoughts `",
  ap_voice: "Voice ***", ap_bold: "Bold **", ap_preview: "Live preview",
  set_backend: "Backend", set_backend_url: "Backend URL", set_backend_hint: "blank = this site's origin",
  load_earlier: "earlier messages", thought_process: "Thought process",
  drew_on: "what they drew on", recall_lore: "Lore", recall_memory: "Memory",
  no_memories: "No memories yet — they build up as you chat.",
  mem_list_head: "memories from this chat, most recent first:",
  search_results_head: "results, by relevance:", no_matches: "No matches found.",
  note_slash: "Slash commands", note_memory: "Memory", note_search: "Memory search:",
  note_language: "Language", note_recap: "Recap",
  status_generating: "Generating canon…", status_translating: "Translating…",
  no_response: "(no response — is the chat model loaded?)", stopped: "(stopped)",
  backend_unreachable: "Couldn't reach the backend",
  conn_offline: "backend offline", conn_chars: "characters", conn_mems: "memories",
  view_list: "List view", view_card: "Card view",
  think_word: "thinking", on_word: "on", off_word: "off", mem_word: "memory",
  mem_intro: "memories from this chat (most recent first). They resurface automatically when relevant — and stay scoped to this session.",
  clear_all: "Clear all", btn_clear: "Clear", del_memory: "Delete this memory",
  lang_p: "The character keeps its personality and system prompt exactly as written — only the language changes. Leave blank for the default (English).",
  lang_label: "Language", lang_ph: "English (default)",
  note_p: "A pinned instruction re-sent to the model at the end of the prompt on every turn — unlike a regular message, it never scrolls out of context as the chat grows. Use it to reinforce things the model tends to forget in long chats (POV, a rule it keeps breaking, a fact it dropped). Leave blank to disable.",
  note_label: "Note",
  note_ph: "e.g. Diane is still angry about the dormitory assignment — she should stay cold and formal, not soften.",
  cmd_ooc: "Speak out of character — the author talking to the narrator",
  cmd_note: "Inject an author's note the model reads as a directive",
  cmd_scene: "Set or describe the current scene environment",
  cmd_time: "Narrate a time skip — e.g. /time Three days later",
  cmd_as: "Speak as a named NPC or background character",
  cmd_recap: "Recap the story so far — shown separately, never added to the chat",
  cmd_roll: "Roll dice — e.g. /roll 2d6+3  or  /roll 1d20",
  cmd_regen: "Regenerate the last AI response",
  cmd_continue: "Continue the last response, optionally with a direction",
  cmd_think: "Toggle model reasoning chain on or off",
  cmd_memory: "View and manage this chat's memory entries",
  cmd_search: "Search this chat's memories by topic or keyword",
  cmd_clear: "Clear all memories from this chat session",
  cmd_export: "Download this chat as a markdown file",
  cmd_mood: "Manually set the scene mood / character sprite",
  cmd_language: "Set the reply language — e.g. /language Spanish (blank resets to default)",
  cmd_help: "List all slash commands",
  dir_ooc: "Out of character", dir_scene: "Scene", dir_note: "Author's note",
  dir_time: "Time skip", dir_spoke: "Spoke as…", dir_dice: "Dice roll",
  title_music: "Music", title_stage: "Show/hide scene art",
  title_think: "Show the model's reasoning", title_char_state: "What's happening right now",
  title_more: "More options", title_scroll: "Scroll to bottom",
  title_see_instr: "See the instruction sent to the model", title_translate_to: "Translate to",
  btn_go: "Go", steer_ph: "Steer the continuation…",
  adm_create_user: "Create user", adm_grant: "Grant admin access", adm_create: "Create",
  cs_doing: "Doing", cs_location: "Location", cs_established: "Established characters",
  set_inherit: "Leave blank to inherit server defaults.",
  set_sent_note: "Sent to the model on every request. Availability depends on the backend.",
  samp_temp: "Temperature", samp_rep: "Rep. penalty", samp_freq: "Freq. penalty",
  samp_pres: "Presence pen.", samp_seed: "Seed", samp_seed_hint: "-1 = random",
  samp_stop: "Stop sequences", samp_stop_hint: "one per line",
  set_suffix: "System suffix", set_suffix_hint: "appended to every character's system prompt",
  set_posthist: "Post-history injection", set_posthist_hint: "inserted after the last message, before the reply",
  cs_name_ph: "e.g. Poetic",
  cs_desc: "Description", cs_desc_hint: "short, shown in the picker",
  cs_desc_ph: "Brief summary shown in the picker",
  cs_instr: "Style instruction", cs_instr_hint: "sent to the model",
  btn_back: "Back",
  set_global: "Global defaults", set_global_hint: "admin — every user inherits these unless they set their own",
  set_deflang: "Default display language",
  set_deflang_hint: "what users read when they haven't picked their own — e.g. English or Chinese; generation stays Chinese internally",
  set_chat_ep: "Chat endpoint", set_embed_ep: "Embed endpoint", set_chat: "Chat", set_embed: "Embed",
  set_comfy_ep: "Image generation (ComfyUI)",
  set_comfy_checkpoint: "Default checkpoint", set_comfy_checkpoint_hint: "filename as ComfyUI sees it, e.g. sd_xl_base_1.0.safetensors",
  set_base_url: "Base URL", set_api_key: "API key", set_model: "Model", set_fetch: "Fetch", set_test: "Test",
  set_optional: "optional", set_keep: "set — leave blank to keep", set_none: "(none)",
  set_blank_reuse: "blank = reuse chat endpoint", set_blank_server: "blank = server chat endpoint reused",
  set_embed_shared_hint: "Embeddings always use the shared server endpoint — it can't be overridden per-user, since the vector index is shared across everyone.",
  admin_flagged_title: "Flagged endpoints", admin_flagged_empty: "Nothing flagged.",
  admin_flagged_block: "Block", admin_flagged_allow: "Allow anyway", admin_flagged_reason: "Reason",
  set_blank_same: "blank = same as chat URL", set_ollama_hint: "e.g. http://localhost:11434/v1 for Ollama",
  set_embed_dim: "Embed dim", set_embed_dim_hint: "rebuild index after changing",
  ed_import_s: "Drop a .png or .json here, or click to browse. Embedded lorebooks import too.",
  mood_col: "mood", mood_bg: "background url", mood_music: "music url", mood_sprite: "sprite url",
  access_denied: "Access denied.",
  adm_eyebrow: "Administration", adm_title: "Admin panel",
  adm_sub: "Manage users and system data.",
  adm_new_user: "New user",
  adm_pending: "Pending approval", adm_awaiting: "Awaiting approval",
  adm_approve: "Approve", adm_deny: "Deny",
  adm_users: "Users", adm_you: "(you)", adm_admin: "Admin",
  adm_reset_pw: "Reset pw", adm_demote: "Demote", adm_make_admin: "Make admin",
  adm_reset_reqs: "Password reset requests", adm_reset_requested: "Requested",
  adm_reset_new_pw: "New password set", adm_reset_copy: "Copy",
  adm_reset_new_pw_note: "New password for {u} — copy this now, it won't be shown again:",
  adm_delete: "Delete", adm_logs: "Server logs",
  adm_logs_note: "Only what this app explicitly logs for debugging — IDs, roles, counts. Never chat or character content, API keys, or endpoint URLs.",
  adm_refresh: "Refresh",
  adm_nav_health: "Service Health",
  adm_health_title: "Service Health", adm_health_note: "Live status of every backend dependency, checked on load and every 5 minutes in the background.",
  adm_health_process_uptime: "App process uptime",
  adm_health_up: "Up", adm_health_down: "Down",
  adm_health_latency: "Latency", adm_health_uptime_24h: "Uptime (24h)",
  adm_health_avg: "Avg", adm_health_range_1h: "1h", adm_health_range_24h: "24h", adm_health_range_7d: "7d",
  adm_health_no_history: "No history yet",
  adm_health_svc_database: "PostgreSQL", adm_health_svc_chat_llm: "Chat LLM (global default)",
  adm_health_svc_embed_llm: "Embedding LLM", adm_health_svc_comfyui: "ComfyUI",
  adm_health_svc_image_classify_llm: "Image classification LLM (Gemma-4-E4B)",
  adm_nav_overview: "Overview", adm_nav_users: "Users", adm_nav_moderation: "Moderation",
  adm_nav_previews: "Model previews", adm_nav_config: "Configuration", adm_nav_logs: "Logs",
  adm_stat_users: "Users", adm_stat_admins: "Admins", adm_stat_characters: "Characters",
  adm_stat_pending: "Pending signups", adm_stat_flagged: "Flagged endpoints",
  adm_stat_resets: "Reset requests", adm_stat_all_clear: "All clear",
  adm_stat_model_reqs: "Model requests", adm_model_reqs_title: "Model requests",
  adm_title_reqs: "Custom title requests", adm_title_requested_by: "Requested by",
  set_model_request_hosts: "Allowed model-request link hosts",
  set_model_request_hosts_hint: "Users can only submit request links from these sites. Give a host an API key here if it requires one (e.g. Civitai) — it's used to build the copy-pasteable curl command for approved requests.",
  set_embed_hosts: "Allowed link-embed hosts", set_embed_hosts_hint: "One host per line. A comment/thread link to one of these (or a direct .gif/.png/.jpg/.webp link anywhere) renders as an inline preview, like Discord — fetched by the viewer's own browser, never by the server.",
  set_mr_host_ph: "e.g. huggingface.co", set_mr_host_key: "API key",
  set_mr_host_key_note: "required if this host needs one to download",
  set_mr_host_add: "+ Add host", set_mr_host_remove: "Remove",
  set_mr_hosts_empty: "No hosts configured — add one below.",
  adm_needs_attention: "Needs attention", adm_nothing_pending: "Nothing pending review.",
  adm_previews_title: "Model reference images",
  adm_previews_sub: "Curate one representative sample image per checkpoint. Shown in the model picker instead of a letter tile.",
  adm_preview_set: "Set image", adm_preview_replace: "Replace", adm_preview_clear: "Clear",
  adm_preview_zoom: "View full size",
  adm_preview_none: "No reference image", adm_preview_saved: "Reference image saved.",
  adm_preview_cleared: "Reference image cleared.", adm_config_title: "Instance configuration",
  adm_config_sub: "Global defaults every user inherits unless they set their own.",
  adm_jump_users: "Review users", adm_jump_mod: "Review queue",
  adm_nav_lora_previews: "LoRA previews", adm_lora_previews_title: "LoRA reference images",
  adm_lora_previews_sub: "Curate one representative sample image per LoRA. Shown in the LoRA picker instead of a letter tile.",
  adm_no_loras: "No LoRAs found — check the Image generation settings.",
  adm_nav_sampler_previews: "Sampler previews", adm_sampler_previews_title: "Sampler reference images",
  adm_sampler_previews_sub: "Curate one representative sample image per sampler. Shown in the sampler picker instead of a letter tile.",
  adm_nav_scheduler_previews: "Scheduler previews", adm_scheduler_previews_title: "Scheduler reference images",
  adm_scheduler_previews_sub: "Curate one representative sample image per scheduler. Shown in the scheduler picker instead of a letter tile.",
  adm_no_samplers: "No samplers found — check the Image generation settings.",
  adm_no_schedulers: "No schedulers found — check the Image generation settings.",
  adm_preview_edit: "Edit name & description",
  adm_edit_meta_title: "Edit details", adm_edit_meta_name: "Display name",
  adm_edit_meta_name_ph: "Shown instead of the raw filename",
  adm_edit_meta_desc: "Description", adm_edit_meta_desc_ph: "Shown alongside the name",
  adm_edit_meta_type: "Type", adm_edit_meta_type_ph: "e.g. SDXL · anime-tuned (overrides the auto-guess)",
  adm_edit_meta_steps: "Default steps", adm_edit_meta_steps_ph: "leave blank to use the normal default",
  adm_edit_meta_steps_hint: "Some models (e.g. a turbo/distilled variant) look best at far fewer steps than usual.",
  adm_edit_meta_steps_toggle: "Use a custom step default for this model",
  adm_edit_meta_category: "Compatible architectures", adm_edit_meta_category_none: "Unclassified",
  adm_edit_meta_category_multi_hint: "select every architecture this LoRA actually works with — not exclusive",
  adm_edit_meta_category_sdxl: "SDXL (legacy)", adm_edit_meta_category_il: "IL (legacy)",
  adm_edit_meta_category_pony: "Pony (legacy)",
  adm_edit_meta_saved: "Details saved.",
  adm_edit_meta_anima_clip: "Anima text-encoder override", adm_edit_meta_anima_vae: "Anima VAE override",
  adm_edit_meta_anima_hint: "Only applies to Anima-architecture checkpoints — leave blank to use the shared default (qwen_3_06b_base.safetensors / qwen_image_vae.safetensors).",
  adm_edit_meta_anima_default: "— use shared default —",
};
let I18N = null;   // active translation map, or null while showing English
function t(key){ return (I18N && I18N[key]) || UI_STRINGS[key] || key; }
function applyI18N(){
  document.querySelectorAll("[data-i18n]").forEach(el=>{
    const key=el.dataset.i18n;
    if(UI_STRINGS[key] !== undefined) el.textContent = t(key);
  });
}
async function loadUiTranslations(lang){
  lang=(lang||"").trim();
  store.set("iface_lang", lang);
  if(!lang || lang.toLowerCase()==="english"){ I18N=null; applyI18N(); return; }
  const cacheKey="i18n:"+lang.toLowerCase();
  const cached=store.get(cacheKey,"");
  if(cached){ try{ I18N=JSON.parse(cached); applyI18N(); }catch(e){} }
  try{
    const res=await fetch(API+"/api/ui-translations",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({lang, strings:UI_STRINGS})});
    if(res.ok){ const d=await res.json(); if(d.strings){ I18N=d.strings; store.set(cacheKey,JSON.stringify(I18N)); applyI18N(); } }
  }catch(e){ /* keep whatever we already applied (cache or English) */ }
}
// Apply any cached translation immediately, before login/network — avoids an
// English flash for a returning user whose interface language isn't English.
(function(){ const lang=store.get("iface_lang",""); if(lang) loadUiTranslations(lang); })();

/* Curated language autocomplete: prefix matches first, common/supported languages
   boosted to the top — replaces the native datalist, whose substring matching over
   180 ISO codes surfaced Avestan for the letter "t". */
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

/* In-app confirm popover, used instead of window.confirm() for destructive
   actions triggered from inside another modal — window.confirm() is blocked
   silently (no dialog, no error) in some embedded/sandboxed browsing contexts,
   which makes the action look like a dead button with zero feedback. */
function confirmPopover(anchor, message, confirmLabel, onConfirm, onCancel){
  const pop=document.createElement("div");
  pop.className="confirm-pop";
  pop.innerHTML=`<p>${esc(trNow(message))}</p><div class="confirm-pop-actions">
    <button type="button" class="btn" id="cfPopCancel">${esc(t("btn_cancel"))}</button>
    <button type="button" class="btn danger" id="cfPopGo">${esc(confirmLabel)}</button>
  </div>`;
  pop.style.visibility="hidden";
  document.body.appendChild(pop);
  const popH=pop.offsetHeight;
  if(anchor){
    const rect=anchor.getBoundingClientRect();
    const fitsBelow=rect.bottom+6+popH <= window.innerHeight;
    pop.style.left=Math.max(8,Math.min(rect.left, window.innerWidth-268))+"px";
    pop.style.top=(fitsBelow ? rect.bottom+6 : Math.max(8,rect.top-popH-6))+window.scrollY+"px";
  }else{
    pop.style.left=Math.max(8,(window.innerWidth-260)/2)+"px";
    pop.style.top=Math.max(8,(window.innerHeight-popH)/2)+window.scrollY+"px";
  }
  pop.style.visibility="";
  let settled=false;
  const close=cancel=>{ pop.remove(); document.removeEventListener("mousedown",onOutside); document.removeEventListener("keydown",onEsc); if(cancel && !settled){ settled=true; onCancel&&onCancel(); } };
  const onOutside=e=>{ if(!pop.contains(e.target) && e.target!==anchor) close(true); };
  const onEsc=e=>{ if(e.key==="Escape") close(true); };
  pop.querySelector("#cfPopCancel").onclick=()=>close(true);
  pop.querySelector("#cfPopGo").onclick=()=>{ settled=true; close(false); onConfirm(); };
  setTimeout(()=>{ document.addEventListener("mousedown",onOutside); document.addEventListener("keydown",onEsc); },0);
}
/* Promise-based wrapper for the inline `if(!(await confirmAction(...)))return;`
   pattern that replaced native confirm(). anchor may be null to center. */
function confirmAction(anchor, message, confirmLabel){
  return new Promise(resolve=>{
    confirmPopover(anchor, message, confirmLabel||t("btn_delete"), ()=>resolve(true), ()=>resolve(false));
  });
}

async function effectiveUiLang(lang){
  if(lang) return lang;
  try{ const cfg=await api("/api/config"); return cfg.default_language||""; }
  catch(e){ return ""; }
}

/* Content localization: user-authored text (scenarios, character personas,
   greetings, card loglines) is rendered in its source language first, then
   patched in place once /api/localize returns the reader's-language version.
   The server resolves the target language itself (session > user > instance
   default) and caches every string persistently, so each unique string is
   only ever LLM-translated once; this Map just avoids repeat HTTP round-trips
   within the tab. items: [{el, text, md?:bool}] */
const _locCache = new Map();

/* Synchronous best-effort translation for transient strings (toasts, confirm()
   dialogs). Returns the cached translation if we have one; otherwise returns the
   source unchanged and queues it for background translation, so the string shows
   translated from its next use onward (and forever, via the server-side cache). */
let _trQueue = new Set(), _trTimer = null;
function trNow(s){
  if(!s || !s.trim() || !store.get("iface_lang","")) return s;
  if(_locCache.has(s)) return _locCache.get(s);
  _trQueue.add(s);
  clearTimeout(_trTimer);
  _trTimer = setTimeout(async ()=>{
    const batch=[..._trQueue]; _trQueue.clear();
    try{
      const r=await api("/api/localize", j("POST",{texts:batch}));
      batch.forEach((src,i)=>_locCache.set(src, r.texts[i]));
    }catch(e){ /* not logged in yet, or endpoint down — retry on next use */ }
  }, 50);
  return s;
}

async function localizeContent(items){
  const todo=(items||[]).filter(it=>it.el && it.text && it.text.trim());
  if(!todo.length) return;
  const missing=[...new Set(todo.filter(it=>!_locCache.has(it.text)).map(it=>it.text))];
  if(missing.length){
    try{
      const r=await api("/api/localize", j("POST",{texts:missing}));
      missing.forEach((src,i)=>_locCache.set(src, r.texts[i]));
    }catch(e){ return; /* keep source text — server caches nothing on failure */ }
  }
  todo.forEach(it=>{
    const tr=_locCache.get(it.text);
    if(tr===undefined || tr===it.text || !it.el.isConnected) return;
    if(it.md) it.el.innerHTML=md(tr); else it.el.textContent=tr;
  });
}

// ISO 639-1 codes — every language with a two-letter code, i.e. "all the world's
// languages" in the sense a language picker can practically offer. Names are
// generated via Intl.DisplayNames rather than hand-maintained.
const ISO_639_1 = ["aa","ab","ae","af","ak","am","an","ar","as","av","ay","az","ba","be","bg","bh","bi","bm","bn","bo","br","bs","ca","ce","ch","co","cr","cs","cu","cv","cy","da","de","dv","dz","ee","el","en","eo","es","et","eu","fa","ff","fi","fj","fo","fr","fy","ga","gd","gl","gn","gu","gv","ha","he","hi","ho","hr","ht","hu","hy","hz","ia","id","ie","ig","ii","ik","io","is","it","iu","ja","jv","ka","kg","ki","kj","kk","kl","km","kn","ko","kr","ks","ku","kv","kw","ky","la","lb","lg","li","ln","lo","lt","lu","lv","mg","mh","mi","mk","ml","mn","mr","ms","mt","my","na","nb","nd","ne","ng","nl","nn","no","nr","nv","ny","oc","oj","om","or","os","pa","pi","pl","ps","pt","qu","rm","rn","ro","ru","rw","sa","sc","sd","se","sg","si","sk","sl","sm","sn","so","sq","sr","ss","st","su","sv","sw","ta","te","tg","th","ti","tk","tl","tn","to","tr","ts","tt","tw","ty","ug","uk","ur","uz","ve","vi","vo","wa","wo","xh","yi","yo","za","zh","zu"];
let _WORLD_LANGUAGES=null;
function worldLanguages(){
  if(_WORLD_LANGUAGES) return _WORLD_LANGUAGES;
  try{
    const dn=new Intl.DisplayNames(["en"],{type:"language"});
    const names=new Set();
    for(const code of ISO_639_1){ const name=dn.of(code); if(name && name!==code) names.add(name); }
    _WORLD_LANGUAGES=[...names].sort((a,b)=>a.localeCompare(b));
  }catch(e){ _WORLD_LANGUAGES=["English","Spanish","French","German","Portuguese","Italian","Japanese","Korean","Chinese","Russian","Arabic","Hindi"]; }
  return _WORLD_LANGUAGES;
}

let APPEARANCE = (()=>{ try{ return JSON.parse(store.get("appearance","{}")); }catch(e){ return {}; } })();
// A typed font name with no comma is assumed to be a bare Google Font name
// (e.g. "Lora") rather than a full font-stack ("Georgia, serif") — those
// already resolve locally, so only single bare names get a stylesheet pulled.
function ensureGoogleFont(name){
  if(!name || name.includes(",")) return;
  const id="gf-"+name.replace(/[^a-z0-9]/gi,"-").toLowerCase();
  if(document.getElementById(id)) return;
  const link=document.createElement("link");
  link.id=id; link.rel="stylesheet";
  link.href="https://fonts.googleapis.com/css2?family="+encodeURIComponent(name).replace(/%20/g,"+")+":ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&display=swap";
  document.head.appendChild(link);
}
function applyAppearance(){
  const r=document.documentElement, a=APPEARANCE;
  const set=(k,v)=> v ? r.style.setProperty(k,v) : r.style.removeProperty(k);
  [a.font,a.msgFont,a.narrationFont,a.dialogueFont,a.thoughtFont,a.voiceFont,a.boldFont].forEach(ensureGoogleFont);
  set("--sans", a.font);
  set("--msg-font", a.msgFont);
  set("--md-em-color", a.narrationColor);
  set("--md-em-font", a.narrationFont);
  set("--md-quote-color", a.dialogueColor);
  set("--md-quote-font", a.dialogueFont);
  set("--md-code-color", a.thoughtColor);
  set("--md-code-font", a.thoughtFont);
  set("--md-voice-color", a.voiceColor);
  set("--md-voice-font", a.voiceFont);
  set("--md-strong-color", a.boldColor);
  set("--md-strong-font", a.boldFont);
  const applyFlags=(prefix,flags)=>{
    if(flags===undefined||flags===null){ set(`--md-${prefix}-fontstyle`,null); set(`--md-${prefix}-fontweight`,null); set(`--md-${prefix}-textdecoration`,null); return; }
    set(`--md-${prefix}-fontstyle`, flags.includes("i")?"italic":"normal");
    set(`--md-${prefix}-fontweight`, flags.includes("b")?"700":"400");
    set(`--md-${prefix}-textdecoration`, [flags.includes("u")&&"underline",flags.includes("s")&&"line-through"].filter(Boolean).join(" ")||"none");
  };
  applyFlags("em", a.narrationFlags);
  applyFlags("quote", a.dialogueFlags);
  applyFlags("code", a.thoughtFlags);
  applyFlags("voice", a.voiceFlags);
  applyFlags("strong", a.boldFlags);
  // Custom text/accent/background colors are blended into the theme's own
  // base tone (color-mix against --ink-base/--accent-base/--paper-base)
  // rather than replacing it outright — a wild pick like "purple" nudges the
  // theme instead of flooding every surface (modals, toasts, etc.) with a
  // raw, clashing, full-saturation fill.
  set("--ink", a.text && `color-mix(in srgb, ${a.text} 55%, var(--ink-base) 45%)`);
  set("--accent", a.accent && `color-mix(in srgb, ${a.accent} 55%, var(--accent-base) 45%)`);
  set("--accent-deep", a.accent && `color-mix(in srgb, ${a.accent} 55%, var(--accent-base) 45%)`);
  set("--paper", a.appBg && `color-mix(in srgb, ${a.appBg} 30%, var(--paper-base) 70%)`);
  set("--base-font-size", a.scale ? (a.scale+"px") : null);
  set("--chat-bg", a.chatBg);   // used by the chat scene as a fallback background — scoped to the stage backdrop only, so a raw color here doesn't risk the wider theme
}
function saveAppearance(patch){ APPEARANCE={...APPEARANCE,...patch}; store.set("appearance",JSON.stringify(APPEARANCE)); applyAppearance(); }

const _ICON_MOON='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const _ICON_SUN='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
const _ICON_EYE_OFF='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.36 18.36 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
const _ICON_EYE='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

function applyTheme(theme){
  THEME=theme; store.set("theme",theme);
  document.documentElement.dataset.theme = (theme==="light") ? "light" : "";
  const b=document.getElementById("themeBtn");
  if(b){
    const dark=theme==="dark", key=dark?"theme_light_mode":"theme_dark_mode";
    b.innerHTML = dark?_ICON_SUN:_ICON_MOON;
    b.title = t(key); b.setAttribute("aria-label", t(key));
    b.classList.toggle("on", !dark);
  }
}
function toggleTheme(){ applyTheme(THEME==="dark"?"light":"dark"); }
applyTheme(THEME);
applyAppearance();

function applyPrivacyMode(on){
  PRIVACY_MODE=on; store.set("privacyMode", on?"1":"0");
  const b=document.getElementById("privacyBtn");
  if(b){
    const key=on?"privacy_mode_on":"privacy_mode_off";
    b.innerHTML = on?_ICON_EYE_OFF:_ICON_EYE;
    b.title = t(key); b.setAttribute("aria-label", t(key));
    b.classList.toggle("on", on);
  }
  // Every already-rendered blur decision on the page is stale the instant
  // this flips (nsfwCls() was baked into markup at render time, not live) —
  // re-run the router against the current path to redraw the current view
  // with fresh decisions, without pushing a duplicate history entry.
  if(typeof route==="function" && ME) route();
}
function togglePrivacyMode(){ applyPrivacyMode(!PRIVACY_MODE); }
applyPrivacyMode(PRIVACY_MODE);

// FastAPI's error bodies are JSON — {"detail": "..."} for a plain HTTPException,
// or {"detail": [{"loc":[...], "msg":"...", ...}, ...]} for a 422 validation
// error. Every call site's catch block does `errorToast(err.message)`, so
// without unwrapping this here, users saw the raw JSON string (braces, quotes,
// "detail" key and all) instead of a readable sentence. Falls back to the raw
// response text for non-JSON error bodies (proxy/gateway error pages, etc.).
async function _apiErrorMessage(res){
  const text = await res.text();
  const ct = res.headers.get("content-type")||"";
  if(ct.includes("json")){
    try{
      const body = JSON.parse(text);
      const d = body && body.detail;
      if(typeof d === "string") return d;
      if(Array.isArray(d)) return d.map(e=>e && e.msg ? e.msg : JSON.stringify(e)).join("; ") || res.statusText || String(res.status);
      if(d && typeof d === "object" && typeof d.msg === "string") return d.msg;
    }catch(e){ /* not actually valid JSON despite the header — fall through */ }
  }
  return text.slice(0,200) || res.statusText || String(res.status);
}
async function api(path, opts){
  const res = await fetch(API+path, opts);
  if(res.status === 401){
    // /explore is deliberately reachable with no session — a stray 401 from
    // some endpoint there shouldn't blow away the explore page and force
    // the login form back over it.
    const onExplorePage = pathSegments()[0]==="explore";
    if(!onExplorePage) showLoginScreen();
    throw new Error("Not authenticated");
  }
  if(!res.ok){ throw new Error(await _apiErrorMessage(res)); }
  const ct = res.headers.get("content-type")||"";
  return ct.includes("json") ? res.json() : res.text();
}
const j = (method, body) => ({method, headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
function mediaURL(p){
  if(!p) return "";
  if(p.startsWith("/media")) return API+p;
  // User-pasted external URLs (avatars, lore images, banners) — only http(s) is
  // ever a legitimate image/link source here; anything else (javascript:, data:,
  // vbscript:, etc) is rejected rather than passed through into a src/href attr.
  return /^https?:\/\//i.test(p) ? p : "";
}

/* Custom card HTML/CSS is untrusted and often uses a global `*` reset plus
   generic class names (.card, .text, .stat…) that would otherwise collide
   with — or stomp on — the app's own styles if injected straight into the
   page DOM. A sandboxed iframe keeps its CSS fully isolated in both
   directions. No allow-scripts, so nothing inside can execute JS even if
   something slipped past DOMPurify; allow-same-origin only lets us read
   contentDocument.body.scrollHeight to auto-size the frame. */
/* Extracted <style> text bypasses DOMPurify, so a crafted stylesheet could
   otherwise phone home via url(http://attacker/beacon) or @import. Strip any
   absolute/protocol-relative url() (keep data: and relative refs) and @import. */
/* Custom cards may only produce working links via the sanctioned placeholders
   ({{share}}, {{edit}}, {{characters}}, {{links}}) — those are substituted
   server-/client-side into real same-origin (or platform-icon) links. A user
   typing their own raw <a href="https://..."> or a CSS url(https://...) would
   bypass that and use the card to send visitors off-platform, so both are
   rejected at save time. Returns the offending URL, or null if clean. */
/* Google Fonts is the one legitimate reason a custom card's CSS ever needs an
   external reference — its stylesheet host (googleapis.com) and the actual
   font-file host its stylesheet points at (gstatic.com) are allowlisted for
   @import/url() font-loading use only. This does NOT extend to a clickable
   <a href> anywhere in the body — that's still always rejected as external,
   since a real hyperlink to fonts.googleapis.com in visible content makes no
   sense and isn't what this exception is for. */
/* Dedicated, font-only services — never general-purpose CDNs (jsDelivr, cdnjs,
   unpkg, etc. are deliberately excluded even though they sometimes host font
   files, since they can also serve arbitrary scripts/JSON/anything else
   through that same domain, which would undermine the actual point of this
   allowlist). Each entry here has no realistic path to loading something
   other than a font or font stylesheet. */
const ALLOWED_FONT_HOSTS=["fonts.googleapis.com","fonts.gstatic.com","fonts.bunny.net",
  "use.typekit.net","p.typekit.net","api.fontshare.com","cdn.fontshare.com"];
function isAllowedFontHost(v){
  try{
    const u=new URL(String(v||"").trim().replace(/^\/\//, "https://"), location.origin);
    return ALLOWED_FONT_HOSTS.includes(u.hostname);
  }catch(e){ return false; }
}
function findExternalCardLink(html){
  let doc;
  try{ doc=new DOMParser().parseFromString(html||"", "text/html"); }catch(e){ return null; }
  for(const a of doc.querySelectorAll("a[href]")){
    const href=(a.getAttribute("href")||"").trim();
    if(/^(https?:)?\/\//i.test(href)){
      try{
        const u=new URL(href, location.origin);
        if(u.origin!==location.origin) return href;
      }catch(e){ return href; }
    }
  }
  /* Off-origin <img>/<svg><image>/<source> are the same "phone home to an
     external server on view" problem external <a href> and CSS url() are
     already blocked for — an unguarded remote image silently beacons every
     viewer's IP/UA to an attacker-controlled host, and DOMPurify's default
     config passes these attributes through untouched. */
  for(const el of doc.querySelectorAll("img[src], source[src], [poster], image")){
    for(const attr of ["src","poster","href","xlink:href"]){
      const val=(el.getAttribute(attr)||"").trim();
      if(!val || !/^(https?:)?\/\//i.test(val)) continue;
      if(isAllowedFontHost(val)) continue;
      try{
        const u=new URL(val, location.origin);
        if(u.origin!==location.origin) return val;
      }catch(e){ return val; }
    }
  }
  for(const styleEl of doc.querySelectorAll("style")){
    const text=styleEl.textContent||"";
    const importRe=/@import\s+(?:url\(\s*(['"]?)([^)'"]*)\1\s*\)|(['"])([^'"]*)\3)/gi;
    let im;
    while((im=importRe.exec(text))){
      const target=im[2]||im[4]||"";
      if(target && /^(https?:)?\/\//i.test(target) && !isAllowedFontHost(target)) return target;
    }
    const urlRe=/url\(\s*(['"]?)(https?:\/\/[^)'"]+)\1\s*\)/gi;
    let m;
    while((m=urlRe.exec(text))){
      if(isAllowedFontHost(m[2])) continue;
      try{
        const u=new URL(m[2]);
        if(u.origin!==location.origin) return m[2];
      }catch(e){ return m[2]; }
    }
  }
  return null;
}
function sanitizeCardCSS(css){
  /* The @import target itself (url(...) or a bare quoted string) must be
     bounded by its own closing quote/paren, NOT by the next semicolon — a
     real Google Fonts URL requesting multiple weights (e.g.
     "wght@500;600;700;800") contains literal semicolons inside the query
     string, and a naive /@import[^;]*;?/ stops at the first one, truncating
     the import mid-URL into garbage that then gets left dangling as stray
     text. Only the trailing media-query list (if any), after the properly-
     bounded target, is scanned up to the real terminating semicolon. */
  let out=String(css||"").replace(/@import\s+(?:url\(\s*(['"]?)([^)'"]*)\1\s*\)|(['"])([^'"]*)\3)[^;]*;?/gi, (m,_q1,urlTarget,_q2,strTarget)=>{
    const target=urlTarget||strTarget||"";
    return (target && isAllowedFontHost(target)) ? m : "";
  });
  out=out.replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (m,_q,u)=>{
    const v=u.trim();
    if(/^data:/i.test(v)) return m;
    if(isAllowedFontHost(v)) return m;
    if(/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith("//")) return "none";
    if(v.includes("\\")) return "none";
    return m;
  });
  return out;
}
function mountSandboxedHTML(container, html, {autoHeight=true, onReady}={}){
  const ifr=document.createElement("iframe");
  // allow-same-origin alone blocks ALL top-level navigation, including a plain
  // <a href> a card author put in their own markup. allow-top-navigation-by-
  // user-activation looks like the fix on paper, but for a srcdoc-loaded frame
  // (as opposed to a real src="...") real-browser testing showed it doesn't
  // reliably target the TOP browsing context — the click instead navigates
  // the iframe itself to the destination URL, which then fails to render
  // (that destination is a full SPA page requiring JS, and this frame still
  // has no allow-scripts) leaving a dead, blank iframe. So instead: no
  // top-navigation sandbox token at all (clicks the interceptor below misses
  // are simply inert, never mis-navigate), and the parent page — which has
  // full script access to this document via allow-same-origin, independent
  // of the iframe's own script sandboxing — intercepts internal link clicks
  // itself and drives the SPA's real navigate() (see wireCardInternalLinks).
  ifr.sandbox="allow-same-origin";
  ifr.style.cssText="width:100%;border:0;display:block;background:#000;"+(autoHeight?"":"height:100%;");
  // Custom cards render against a fixed black backdrop regardless of the
  // app's own light/dark theme — most are designed on dark backgrounds and
  // otherwise flash/show through as white in light mode before (or unless)
  // the card's own CSS paints a background.
  // Pull <style> blocks out before sanitizing — DOMPurify's HTML parser can
  // mangle raw CSS text (@import, selectors with special chars) even with
  // ADD_TAGS:["style"]. Plain CSS text has no script-execution vector, so
  // it's safe to carry over untouched while the actual markup still goes
  // through DOMPurify.
  const styles=[];
  const markup=(html||"").replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_m,css)=>{ styles.push(sanitizeCardCSS(css)); return ""; });
  // Same "no phone-home to an external host" rule CSS url()/@import and <a
  // href> already enforce, applied to resource-loading attributes DOMPurify
  // otherwise passes through untouched (img/source src, svg xlink:href,
  // video poster) — an unguarded remote image silently beacons every
  // viewer's IP/UA to an attacker-controlled host on render. Render-time
  // net for content saved before findExternalCardLink covered this too.
  const stripOffOriginResource=node=>{
    for(const attr of ["src","poster","href","xlink:href"]){
      const v=node.getAttribute && node.getAttribute(attr);
      if(!v || !/^(https?:)?\/\//i.test(v.trim())) continue;
      if(isAllowedFontHost(v)) continue;
      try{
        if(new URL(v, location.origin).origin===location.origin) continue;
      }catch(e){}
      node.removeAttribute(attr);
    }
  };
  DOMPurify.addHook("afterSanitizeAttributes", stripOffOriginResource);
  const cleanBody=DOMPurify.sanitize(markup, {});
  DOMPurify.removeHook("afterSanitizeAttributes", stripOffOriginResource);
  // This is a fully separate document (srcdoc), so the parent page's own
  // themed scrollbar CSS doesn't reach in here — without this the browser's
  // plain default scrollbar shows instead, clashing against the dark
  // backdrop above (most visible in the small presentation-HTML preview
  // pane, which scrolls almost immediately).
  const scrollbarCss="html,body{margin:0;background:#000;scrollbar-color:#555 transparent;scrollbar-width:thin;}"+
    "::-webkit-scrollbar{width:10px;height:10px;}::-webkit-scrollbar-track{background:transparent;}"+
    "::-webkit-scrollbar-thumb{background:#555;border-radius:8px;border:2px solid #000;}"+
    "::-webkit-scrollbar-thumb:hover{background:#888;}";
  ifr.srcdoc=`<!doctype html><html><head><style>${scrollbarCss}\n${styles.join("\n")}</style></head><body>${cleanBody}</body></html>`;
  ifr.onload=()=>{ try{
    if(autoHeight) ifr.style.height=ifr.contentDocument.body.scrollHeight+"px";
    wireCardInternalLinks(ifr.contentDocument);
    onReady&&onReady(ifr.contentDocument);
  }catch(e){} };
  container.innerHTML="";
  container.appendChild(ifr);
  return ifr;
}
/* Same-origin <a href="/..."> links a card author writes directly (or that a
   placeholder like {{characters}} generates) can't rely on real cross-document
   top-navigation from inside a sandboxed srcdoc iframe (see the sandbox
   comment in mountSandboxedHTML) — so the parent intercepts the click itself
   and drives the SPA router directly. This also means it's a real client-side
   transition instead of a hard reload, matching how every other in-app link
   already behaves. External links never reach here — findExternalCardLink
   already blocks those at save time and DOMPurify still applies regardless. */
function wireCardInternalLinks(doc){
  doc.querySelectorAll("a[href]").forEach(a=>{
    const href=a.getAttribute("href")||"";
    if(!href.startsWith("/") || href.startsWith("/api/") || href.startsWith("/media/")) return;
    a.addEventListener("click", e=>{
      if(e.defaultPrevented) return;
      e.preventDefault();
      if(e.button!==0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey){ window.open(href, "_blank"); return; }
      navigate(href);
    });
  });
}

/* Shared SSE reader: invokes onEvent for each parsed `data:` event object,
   buffering partial frames split across chunk boundaries (split on the
   blank-line separator). */
async function sseEvents(response, onEvent){
  const reader=response.body.getReader(), dec=new TextDecoder(); let buf="";
  while(true){
    const {value,done}=await reader.read(); if(done) break;
    buf+=dec.decode(value,{stream:true});
    const parts=buf.split("\n\n"); buf=parts.pop();
    for(const p of parts){
      const line=p.trim(); if(!line.startsWith("data:")) continue;
      let ev; try{ ev=JSON.parse(line.slice(5).trim()); }catch(e){ continue; }
      await onEvent(ev);
    }
  }
}
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
let toastT;
function toast(m){
  const box=$("#toast");
  clearTimeout(toastT);
  box.classList.remove("error");
  box.innerHTML=`<span class="toast-error-msg"></span><button type="button" class="toast-error-close" aria-label="${esc(t("btn_close"))}">×</button>`;
  box.querySelector(".toast-error-msg").textContent=trNow(m);
  box.querySelector(".toast-error-close").onclick=()=>{ clearTimeout(toastT); box.classList.remove("show"); };
  box.classList.add("show");
  // Matches errorToast's dismiss window — now that every toast has a real
  // [x] close button, there's no reason a plain one should vanish 4x faster
  // than an error before it's even been read.
  toastT=setTimeout(()=>box.classList.remove("show"),10000);
}
// ComfyUI errors arrive as the raw Python dict string (nested
// 'execution_error' messages, full tracebacks) — showing that verbatim in
// the plain toast is what used to render as a giant unstyled wall of text.
// Pull out just the human-readable exception_message when present instead of
// dumping the whole thing.
function _summarizeGenError(msg){
  msg=String(msg||"");
  const m=msg.match(/'exception_message':\s*'([^']*(?:\\.[^']*)*)'/) || msg.match(/"exception_message":\s*"([^"]*(?:\\.[^"]*)*)"/);
  if(m) return m[1].replace(/\\n/g," ").trim();
  return msg.length>300 ? msg.slice(0,300)+"…" : msg;
}
// Distinct styled alert for errors — bounded width, scrollable for longer
// text, a real close button (manual dismiss, since a long error shouldn't
// vanish on the same short timer as a one-line "Saved." toast), warn-colored
// border instead of the plain toast's swapped ink/paper colors.
function errorToast(m){
  const box=$("#toast");
  clearTimeout(toastT);
  box.classList.add("error");
  box.innerHTML=`<span class="toast-error-msg"></span><button type="button" class="toast-error-close" aria-label="${esc(t("btn_close"))}">×</button>`;
  box.querySelector(".toast-error-msg").textContent=_summarizeGenError(trNow(m));
  box.querySelector(".toast-error-close").onclick=()=>{ clearTimeout(toastT); box.classList.remove("show","error"); };
  box.classList.add("show");
  toastT=setTimeout(()=>box.classList.remove("show","error"),10000);
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
let _imagegenCheckpoints=null, _imagegenLoras=null, _checkpointPreviews=null, _loraPreviews=null;
let _samplerPreviews=null, _schedulerPreviews=null, _samplerData=null, _upscalerPreviews=null;
// Anima is a second, unrelated base-model architecture (see imagegen.py's
// ANIMA_WORKFLOW) — its models come from a separate ComfyUI list (UNETLoader,
// not CheckpointLoaderSimple) but are folded into the same checkpoint picker
// so there's one place to pick a model; _animaUnetSet is how callers tell
// which architecture a given selection needs (LoRAs/reference-image aren't
// supported for it yet, and it needs its own sampler/scheduler/cfg defaults).
let _animaUnetSet=null;
function isAnimaModel(name){ return !!(_animaUnetSet && _animaUnetSet.has(name)); }
// Anima CLIP text-encoder/VAE override pickers (edit-meta modal) — cached
// for the page lifetime like getImagegenOptions(), separate cache since
// they're only ever needed inside that modal, not the main picker flow.
let _animaClipModels=null, _animaVaeModels=null;
async function getAnimaEncoderOptions(){
  if(_animaClipModels && _animaVaeModels) return {clipModels:_animaClipModels, vaeModels:_animaVaeModels};
  const [clipModels, vaeModels]=await Promise.all([
    api("/api/imagegen/clip-models").catch(()=>[]),
    api("/api/imagegen/vaes").catch(()=>[]),
  ]);
  _animaClipModels=clipModels; _animaVaeModels=vaeModels;
  return {clipModels, vaeModels};
}
async function getImagegenOptions(){
  if(_imagegenCheckpoints) return {checkpoints:_imagegenCheckpoints, loras:_imagegenLoras,
    previews:_checkpointPreviews||{}, loraPreviews:_loraPreviews||{}};
  const [checkpoints, animaUnets, loras, previews, loraPreviews]=await Promise.all([
    api("/api/imagegen/checkpoints").catch(()=>[]),
    api("/api/imagegen/anima-unets").catch(()=>[]),
    api("/api/imagegen/loras").catch(()=>[]),
    api("/api/imagegen/checkpoint-previews").catch(()=>({})),
    api("/api/imagegen/lora-previews").catch(()=>({})),
  ]);
  _animaUnetSet=new Set(animaUnets);
  _imagegenCheckpoints=[...checkpoints, ...animaUnets]; _imagegenLoras=loras;
  _checkpointPreviews=previews; _loraPreviews=loraPreviews;
  return {checkpoints:_imagegenCheckpoints, loras, previews, loraPreviews};
}
// getImagegenOptions() caches for the lifetime of the page, but the model/
// LoRA picker modals hold their own `previews` object via a closure captured
// whenever their parent panel first mounted — an admin updating a preview
// image elsewhere doesn't reach that already-resolved closure, so the picker
// modal kept showing stale previews until a full page reload. Called right
// before each picker modal opens so it always reflects the latest state.
async function refreshImagegenOptions(){
  _imagegenCheckpoints=null; _imagegenLoras=null; _checkpointPreviews=null; _loraPreviews=null;
  return getImagegenOptions();
}
// previews maps are {name: {image, display_name, description}} — a friendly
// name/description an admin curated, independent of whether a preview image
// is set. Falls back to the raw filename everywhere one isn't set.
function modelLabel(name, previews){ return (previews && previews[name] && previews[name].display_name) || name; }
function modelDesc(name, previews){ return (previews && previews[name] && previews[name].description) || ""; }
function modelType(name, previews){
  const cats=modelCategories(name,previews);
  // The structured category (Flux V2/Anima/SDXL (legacy)/IL (legacy)) always
  // wins once an admin has actually classified a model — otherwise this falls
  // back to the free-text "Type" field, then the filename-guessed heuristic.
  // A LoRA can be classified under more than one compatible architecture
  // (e.g. a merge trained to work under both SDXL and IL conventions).
  if(cats.length) return cats.map(modelCategoryLabel).join(", ");
  return (previews && previews[name] && previews[name].model_type) || describeCheckpoint(name);
}
// Anima's category is structural (it's a UNETLoader model, not admin-set)
// and always wins over whatever's stored; everything else is whatever
// architecture(s) the admin picked in the edit-meta modal, or [] if never
// classified. Always returns an array — checkpoints are effectively always
// single-item, LoRAs can genuinely have more than one.
function modelCategories(name, previews){
  if(isAnimaModel(name)) return ["anima"];
  const raw=previews && previews[name] && previews[name].model_category;
  if(Array.isArray(raw)) return raw.filter(Boolean);
  return raw ? [raw] : [];
}
// Legacy single-category callers (exact-match filtering against one active
// tab) — true if that ONE tab's category is among this model's categories.
function modelCategory(name, previews){ return modelCategories(name,previews)[0]||""; }
function modelHasCategory(name, previews, cat){ return modelCategories(name,previews).includes(cat); }
function isLegacyModelCategory(cat){ return cat==="sdxl"||cat==="il"||cat==="pony"; }
// "Hide legacy" should only hide something that's PURELY legacy — a LoRA
// tagged both e.g. sdxl and anima still supports a modern architecture and
// shouldn't disappear just because one of its several tags happens to be
// legacy too.
function hasOnlyLegacyCategories(name, previews){
  const cats=modelCategories(name,previews);
  return cats.length>0 && cats.every(isLegacyModelCategory);
}
function modelCategoryLabel(cat){
  return cat==="sdxl" ? t("adm_edit_meta_category_sdxl") : cat==="il" ? t("adm_edit_meta_category_il")
    : cat==="flux_v2" ? "Flux V2" : cat==="anima" ? "Anima" : cat==="pony" ? t("adm_edit_meta_category_pony") : cat;
}
function modelImage(name, previews){ return previews && previews[name] && previews[name].image; }
/* ComfyUI's /object_info only returns bare filenames, no metadata — this heuristically
   labels a checkpoint from common naming conventions so users can tell base models
   apart at a glance without knowing every filename's lineage by heart. */
function describeCheckpoint(name){
  const n=(name||"").toLowerCase();
  const arch = /illustrious|noobai|noob[-_]?ai/.test(n) ? "Illustrious"
    : /pony/.test(n) ? "Pony Diffusion"
    : /sdxl|_xl|-xl|\bxl\b/.test(n) ? "SDXL"
    : /sd3|sd_3/.test(n) ? "Stable Diffusion 3"
    : /flux/.test(n) ? "Flux"
    : /sd[-_ ]?1\.?5|v1-5|v1_5/.test(n) ? "SD 1.5"
    : "";
  const flavor = /anime|animagine|niji/.test(n) ? "anime-tuned"
    : /realistic|photo|real[-_]?vis/.test(n) ? "photoreal"
    : /turbo/.test(n) ? "turbo/fast"
    : /lightning/.test(n) ? "lightning/fast"
    : "";
  return [arch, flavor].filter(Boolean).join(" · ");
}
/* Native <select> can't show a description line per option, and its open dropdown list
   ignores CSS in most browsers — so model/LoRA pickers use this small custom dropdown
   instead: a themed button that toggles a .dd-menu-style list of rows. */
function mountCustomSelect(container, items, {value, onChange, getDesc, placeholder}={}){
  let current = value ?? (items[0] && items[0].value) ?? "";
  let menu=null;
  // The menu is portaled to <body> as position:fixed instead of living inside
  // .cs (which sits inside a scrolling .modal) — an absolutely-positioned
  // descendant of an overflow:auto ancestor gets clipped at that ancestor's
  // edge no matter how it's positioned, so it has to escape the DOM entirely.
  const setExpanded=v=>{ const b=container.querySelector(".cs-btn"); if(b) b.setAttribute("aria-expanded", v?"true":"false"); };
  const closeMenu=(returnFocus)=>{ if(menu){ menu.remove(); menu=null; } container.classList.remove("open"); setExpanded(false); if(returnFocus){ const b=container.querySelector(".cs-btn"); if(b) b.focus(); } };
  const selectRow=row=>{
    current=row.dataset.v; closeMenu(); render();
    if(onChange) onChange(current);
  };
  const focusRow=row=>{ if(row) row.focus(); };
  const openMenu=()=>{
    const btn=container.querySelector(".cs-btn");
    const r=btn.getBoundingClientRect();
    menu=el(`<div class="cs-menu cs-menu-portal" role="listbox">${items.map(it=>{
      const desc = getDesc ? getDesc(it.value) : "";
      const on=it.value===current;
      return `<div class="cs-row${on?" on":""}" role="option" tabindex="0" aria-selected="${on?"true":"false"}" data-v="${esc(it.value)}">
        <div class="cs-row-label">${esc(it.label)}</div>
        ${desc?`<div class="cs-row-desc">${esc(desc)}</div>`:""}
      </div>`;
    }).join("")}</div>`);
    document.body.appendChild(menu);
    menu.style.left=r.left+"px"; menu.style.width=r.width+"px";
    const spaceBelow=window.innerHeight-r.bottom-16, spaceAbove=r.top-16;
    if(spaceBelow<160 && spaceAbove>spaceBelow){
      menu.style.bottom=(window.innerHeight-r.top+6)+"px"; menu.style.maxHeight=Math.max(120,Math.min(260,spaceAbove))+"px";
    } else {
      menu.style.top=(r.bottom+6)+"px"; menu.style.maxHeight=Math.max(120,Math.min(260,spaceBelow))+"px";
    }
    container.classList.add("open");
    setExpanded(true);
    const rows=[...menu.querySelectorAll(".cs-row")];
    rows.forEach(row=>{
      row.onclick=(e)=>{ e.stopPropagation(); selectRow(row); };
      row.onkeydown=(e)=>{
        if(e.key==="ArrowDown"){ e.preventDefault(); focusRow(rows[Math.min(rows.length-1, rows.indexOf(row)+1)]); }
        else if(e.key==="ArrowUp"){ e.preventDefault(); focusRow(rows[Math.max(0, rows.indexOf(row)-1)]); }
        else if(e.key==="Enter"||e.key===" "){ e.preventDefault(); selectRow(row); }
        else if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); closeMenu(true); }
      };
    });
    focusRow(rows.find(r=>r.classList.contains("on")) || rows[0]);
  };
  const render=()=>{
    const sel = items.find(it=>it.value===current);
    container.innerHTML = `
      <button type="button" class="cs-btn" role="button" aria-haspopup="listbox" aria-expanded="false">
        <span class="cs-btn-label">${sel?esc(sel.label):esc(placeholder||"")}</span>
        <svg class="cs-chevron" width="12" height="8" viewBox="0 0 12 8" fill="none"><path d="M1 1L6 6L11 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>`;
    const b=container.querySelector(".cs-btn");
    b.onclick=(e)=>{ e.stopPropagation(); if(menu){ closeMenu(); } else { closeAllDropdowns(); openMenu(); } };
    b.onkeydown=(e)=>{ if(!menu && (e.key==="ArrowDown"||e.key==="ArrowUp"||e.key==="Enter"||e.key===" ")){ e.preventDefault(); closeAllDropdowns(); openMenu(); } };
  };
  container.classList.add("cs");
  render();
  return {get value(){ return current; }, set value(v){ current=v; render(); }};
}
if(!window._csOutsideClickBound){
  window._csOutsideClickBound=true;
  document.addEventListener("click",()=>document.querySelectorAll(".cs-menu-portal").forEach(m=>m.remove()));
  document.addEventListener("click",()=>document.querySelectorAll(".cs.open").forEach(c=>c.classList.remove("open")));
}
// Multiple LoRAs, each with its own strength, chained in the order added —
// same as stacking several LoraLoader nodes in ComfyUI's own UI. Replaces the
// old single-LoRA dropdown + one shared strength slider.
function mountLoraMultiPicker(container, loraNames){
  const rows=[]; // {name, strength}
  const render=()=>{
    container.innerHTML=`<div class="lora-rows"></div>
      <button type="button" class="btn" id="loraAddBtn" ${loraNames.length?"":"disabled"}>+ ${esc(t("img_gen_lora_add"))}</button>`;
    const rowsEl=container.querySelector(".lora-rows");
    rows.forEach((row,i)=>{
      const rowEl=el(`<div class="lora-row">
        <div class="lora-row-sel"></div>
        <input type="range" class="lora-row-strength" min="0" max="2.2" step="0.05" value="${row.strength}">
        <span class="hint lora-row-val">${row.strength}</span>
        <button type="button" class="tool danger">✕</button>
      </div>`);
      mountCustomSelect(rowEl.querySelector(".lora-row-sel"), loraNames.map(l=>({value:l,label:l})),
        {value:row.name, onChange:v=>{ row.name=v; }});
      rowEl.querySelector(".lora-row-strength").oninput=e=>{
        row.strength=parseFloat(e.target.value); rowEl.querySelector(".lora-row-val").textContent=e.target.value;
      };
      rowEl.querySelector("button.danger").onclick=()=>{ rows.splice(i,1); render(); };
      rowsEl.appendChild(rowEl);
    });
    const addBtn=container.querySelector("#loraAddBtn");
    if(addBtn) addBtn.onclick=()=>{ if(!loraNames.length) return; rows.push({name:loraNames[0], strength:1.0}); render(); };
  };
  render();
  return { getSelected:()=>rows.filter(r=>r.name).map(r=>({name:r.name, strength:r.strength})) };
}
// Shared upload glyph for every image-picker's empty/click-to-upload state.
const UPLOAD_ICON_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>`;
// Icon-only trash/edit glyphs for the admin Model/LoRA previews rows —
// same viewBox/stroke conventions as UPLOAD_ICON_SVG so all three sit flush together.
const TRASH_ICON_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
const EDIT_ICON_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`;
const ZOOM_ICON_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>`;
const SAVE_ICON_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
const SPARKLE_ICON_SVG=`<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l1.8 5.9L20 10l-6.2 2.1L12 18l-1.8-5.9L4 10l6.2-2.1L12 2Z"/><path d="M19 14l.7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7L19 14Z"/><path d="M5 15l.6 1.9L7.5 17.5 5.6 18.1 5 20l-.6-1.9-1.9-.6 1.9-.6L5 15Z"/></svg>`;
const REGEN_ICON_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>`;
const SHARE_ICON_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`;
// Optional img2img reference image: pick a file, preview it, and expose a
// "match strength" slider that only appears once an image is actually set.
function mountReferenceImagePicker(container){
  let dataUrl=null;
  container.innerHTML=`
    <div class="ig-ref-preview" id="igRefPreview" style="display:none;">
      <img id="igRefImg" alt="">
      <button type="button" class="tool danger img-pick-x" id="igRefClear" aria-label="${esc(t("img_gen_reference_remove"))}" title="${esc(t("img_gen_reference_remove"))}">✕</button>
    </div>
    <div class="img-pick-empty ig-ref-empty" id="igRefEmpty" title="${esc(t("img_gen_reference_pick"))}">${UPLOAD_ICON_SVG}</div>
    <input type="file" id="igRefFile" accept="image/*" hidden>
    <div class="field" id="igDenoiseRow" style="display:none;margin:10px 0 0;">
      <label>${esc(t("img_gen_denoise"))} <span class="hint" id="igDenoiseVal">0.6</span></label>
      <input type="range" id="igDenoise" min="0.1" max="1.0" step="0.05" value="0.6">
      <div class="hint" style="margin-top:4px;">${esc(t("img_gen_denoise_hint"))}</div>
    </div>`;
  const preview=container.querySelector("#igRefPreview"), emptyBox=container.querySelector("#igRefEmpty"),
        denoiseRow=container.querySelector("#igDenoiseRow");
  emptyBox.onclick=()=>container.querySelector("#igRefFile").click();
  const applyBlob=blob=>{
    const reader=new FileReader();
    reader.onload=()=>{
      dataUrl=reader.result;
      container.querySelector("#igRefImg").src=dataUrl;
      preview.style.display=""; emptyBox.style.display="none"; denoiseRow.style.display="";
    };
    reader.readAsDataURL(blob);
  };
  container.querySelector("#igRefFile").onchange=()=>{
    const f=container.querySelector("#igRefFile").files[0]; if(!f) return;
    const objectUrl=URL.createObjectURL(f);
    openCropper(objectUrl, 1, 768, 768, blob=>{ applyBlob(blob); container.querySelector("#igRefFile").value=""; });
  };
  container.querySelector("#igRefClear").onclick=()=>{
    dataUrl=null; preview.style.display="none"; emptyBox.style.display=""; denoiseRow.style.display="none";
    container.querySelector("#igRefFile").value="";
  };
  container.querySelector("#igDenoise").oninput=e=>{ container.querySelector("#igDenoiseVal").textContent=e.target.value; };
  return {
    getDataUrl:()=>dataUrl,
    getDenoise:()=>parseFloat(container.querySelector("#igDenoise").value)||0.6,
  };
}
// Model picker as a thumbnail grid (pix.ai-style): a selected-model summary card
// on top, then a grid of selectable checkpoints collapsed to an initial count with
// a "Show more" toggle. ComfyUI exposes no per-checkpoint thumbnail, so each tile
// uses a letter-avatar fallback like the character cards' .ava.mono.
// Model picker: a selected-model summary card, then every checkpoint always
// rendered as a small chip in a horizontally-scrolling strip — no
// collapse/hide state and no vertical growth as the list gets longer (unlike
// a wrapping grid), so the panel's height stays flat regardless of how many
// checkpoints are installed. All items are reachable by scrolling the strip
// sideways, never by a "show more" click.
// Model picker, Pixiv-style: a 2×3 grid of the first 6 checkpoints, each tile
// a large square thumbnail (the admin-curated preview image, or a big
// letter-avatar fallback when none is set) with the name below — the image
// is the dominant visual element, not a sliver next to text — plus a
// "Show more models" toggle revealing the rest. Collapsed by default so the
// panel stays compact enough to fit without page-level scroll even with
// many installed checkpoints.
function _igModelBigThumb(name, previews){
  const img=modelImage(name, previews);
  const label=modelLabel(name, previews);
  // Same admin-defined arch badge as the admin previews-management panel
  // (modelType() already prefers the structured category over free text).
  // A LoRA can be tagged compatible with more than one architecture.
  const cats=modelCategories(name,previews);
  const archBadge=cats.length?`<span class="ig-model-thumb-arch-row">${cats.map(c=>`<span class="ig-model-thumb-arch">${esc(modelCategoryLabel(c))}</span>`).join("")}</span>`:"";
  // A plain <img> instead of a CSS background-image — Chromium's downscale
  // filtering for background-image is visibly worse than for a real <img>
  // element at these small tile sizes (confirmed: identical source image,
  // clearly softer/blurrier as a background-image than as an <img>), even
  // though both are asked to shrink the same ~1024px source down to ~40-
  // 100px. <img> goes through the browser's image decoder's own resampling
  // instead of a CSS paint-time scale, which holds up much better here.
  return img ? `<span class="ig-model-thumb"><img src="${esc(mediaURL(img))}" alt="" loading="lazy">${archBadge}</span>`
             : `<span class="ig-model-thumb ava mono">${esc((label||"?")[0].toUpperCase())}${archBadge}</span>`;
}
// Per-browser usage counter (see recordCheckpointUsage) — how many times each
// checkpoint has actually been generated with, used to rank the compact
// first-look grid by what's actually commonly picked, not alphabetical order.
function _checkpointUsageCounts(){
  try{ return JSON.parse(localStorage.getItem("ig_checkpoint_usage")||"{}"); }catch(e){ return {}; }
}
function recordCheckpointUsage(name){
  if(!name) return;
  const counts=_checkpointUsageCounts();
  counts[name]=(counts[name]||0)+1;
  try{ localStorage.setItem("ig_checkpoint_usage", JSON.stringify(counts)); }catch(e){}
}
// Same per-browser most-used-first ranking as checkpoints, generalized to any
// other picker (LoRAs, samplers, schedulers) via its own localStorage key.
function _pickerUsageCounts(key){
  try{ return JSON.parse(localStorage.getItem(key)||"{}"); }catch(e){ return {}; }
}
function _recordPickerUsage(key, name){
  if(!name) return;
  const counts=_pickerUsageCounts(key);
  counts[name]=(counts[name]||0)+1;
  try{ localStorage.setItem(key, JSON.stringify(counts)); }catch(e){}
}
function mountModelGrid(container, checkpoints, {value, previews, onChange}={}){
  previews=previews||{};
  let current=value || checkpoints[0] || "";
  const INITIAL=6;
  const tile=name=>{
    return `<button type="button" class="ig-grid-tile ig-model-tile${name===current?" on":""}" data-v="${esc(name)}" title="${esc(name)}">
      ${_igModelBigThumb(name,previews)}
      <span class="ig-tile-name">${esc(modelLabel(name,previews))}</span>
    </button>`;
  };
  const render=()=>{
    const mtype=modelType(current,previews);
    const desc=modelDesc(current,previews);
    // The compact first-look grid ranks by actual usage (most-generated-with
    // first), not alphabetical order, so it surfaces what this browser
    // commonly picks rather than whatever ComfyUI happens to list first —
    // the rest is still there via "Show more". The selected model always
    // leads regardless of its own usage count, so picking something new
    // never makes it vanish from view here.
    const hideLegacy=localStorage.getItem("ig_mp_hide_legacy")==="1";
    const pool=hideLegacy?checkpoints.filter(n=>!hasOnlyLegacyCategories(n,previews)):checkpoints;
    const counts=_checkpointUsageCounts();
    const byUsage=[...pool].sort((a,b)=>(counts[b]||0)-(counts[a]||0));
    const ordered=current&&byUsage.includes(current) ? [current, ...byUsage.filter(n=>n!==current)] : byUsage;
    const shown=ordered.slice(0,INITIAL);
    container.innerHTML=`
      <div class="ig-model-summary">
        ${_igModelBigThumb(current,previews)}
        <div class="ig-model-summary-txt"><b>${esc(modelLabel(current,previews)||"—")}</b>${mtype?`<span>${esc(mtype)}</span>`:""}${desc?`<span>${esc(desc)}</span>`:""}</div>
      </div>
      <label class="ig-mp-hide-legacy"><input type="checkbox" id="ig_mg_hide_legacy" ${hideLegacy?"checked":""}> ${esc(t("ig_mp_hide_legacy"))}</label>
      <div class="ig-grid ig-model-grid">${shown.map(tile).join("")}</div>
      <button type="button" class="ig-show-more" data-act="more">${esc(t("ig_show_more_models"))}</button>`;
    container.querySelectorAll(".ig-grid-tile").forEach(b=>b.onclick=()=>{ current=b.dataset.v; render(); if(onChange) onChange(current); });
    const hideLegacyBox=container.querySelector("#ig_mg_hide_legacy");
    if(hideLegacyBox) hideLegacyBox.onchange=e=>{
      localStorage.setItem("ig_mp_hide_legacy", e.target.checked?"1":"");
      render();
    };
    const more=container.querySelector("[data-act='more']");
    if(more) more.onclick=async()=>{
      previews=(await refreshImagegenOptions()).previews;
      openModelPickerModal(checkpoints, previews, current, v=>{ current=v; render(); if(onChange) onChange(current); });
    };
  };
  render();
  return { get value(){ return current; } };
}
// Full model-picker modal (pix.ai "Preset" tab equivalent, no marketplace/
// bookmark/usage-count features since this app is self-hosted with neither) —
// search box + a scrollable grid of every installed checkpoint, and a detail
// panel (right column on desktop, stacked below on mobile) with a bigger
// preview + "Use this model" button that selects it and closes the modal.
let _modelRequestHosts=["huggingface.co","civitai.red"];   // safe default until /api/settings responds
async function _loadModelRequestHosts(){
  const st=await api("/api/settings").catch(()=>null);
  if(st && Array.isArray(st.model_request_hosts) && st.model_request_hosts.length)
    _modelRequestHosts=st.model_request_hosts.map(h=>typeof h==="string"?h:h.host);
  return _modelRequestHosts;
}
// Admin-configurable allowlist for auto-embedding a comment/thread link as an
// inline image/gif preview — client-side only (see renderCommentNode), never
// fetched by the server. Safe defaults until /api/settings responds.
let _embedLinkHosts=["tenor.com","media.tenor.com","giphy.com","media.giphy.com",
  "media.discordapp.net","cdn.discordapp.com","imgur.com","i.imgur.com"];
async function _loadEmbedLinkHosts(){
  const st=await api("/api/settings").catch(()=>null);
  if(st && Array.isArray(st.embed_link_hosts)) _embedLinkHosts=st.embed_link_hosts;
  return _embedLinkHosts;
}
// Custom emoji/stickers — any signed-in user can upload one (see
// routers/emojis.py); this cache is refreshed after every upload/delete so
// a shortcode typed moments after being created still resolves.
let _customEmojis=[];
async function _loadCustomEmojis(){
  _customEmojis=await api("/api/emojis").catch(()=>[]);
  return _customEmojis;
}
function _customEmojiByShortcode(code){
  return _customEmojis.find(e=>e.shortcode===code);
}
function _modelRequestHostAllowed(url){
  let host;
  try{ host=new URL(url).hostname.toLowerCase(); }catch(e){ return false; }
  return _modelRequestHosts.some(h=>{ h=h.toLowerCase().replace(/^\.+/,""); return host===h || host.endsWith("."+h); });
}
const MODEL_CATEGORY_TABS=["flux_v2","anima","sdxl","il","pony"];
function openModelPickerModal(checkpoints, previews, current, onSelect){
  let tab="models";
  let query="";
  const storedCategory=localStorage.getItem("ig_mp_category");
  let category=MODEL_CATEGORY_TABS.includes(storedCategory) ? storedCategory
    : (modelCategory(current,previews)||"sdxl");
  let hideLegacy=localStorage.getItem("ig_mp_hide_legacy")==="1";
  let picked=current;
  const tabsHTML=`<div class="seg lib-tabs ig-mp-tabs" id="mpTabs">
    <button type="button" class="seg-btn ${tab==="models"?"on":""}" data-t="models"><b>${esc(t("ig_mp_tab_models"))}</b></button>
    <button type="button" class="seg-btn ${tab==="request"?"on":""}" data-t="request"><b>${esc(t("ig_mp_tab_request"))}</b></button>
  </div>`;
  const renderGrid=()=>{
    const q=query.trim().toLowerCase();
    let list=q?checkpoints.filter(n=>n.toLowerCase().includes(q)||modelLabel(n,previews).toLowerCase().includes(q)):checkpoints;
    list=list.filter(n=>modelHasCategory(n,previews,category));
    if(hideLegacy) list=list.filter(n=>!hasOnlyLegacyCategories(n,previews));
    if(picked && list.includes(picked)) list=[picked, ...list.filter(n=>n!==picked)];
    const grid=$("#mpGrid"); if(!grid) return;
    grid.innerHTML=list.length?list.map(name=>`
      <button type="button" class="ig-grid-tile ig-model-tile${name===picked?" on":""}" data-v="${esc(name)}" title="${esc(name)}">
        ${_igModelBigThumb(name,previews)}
        <span class="ig-tile-name">${esc(modelLabel(name,previews))}</span>
      </button>`).join("") : `<div class="hint">${esc(t("ig_model_search_empty"))}</div>`;
    grid.querySelectorAll(".ig-grid-tile").forEach(b=>b.onclick=()=>{ picked=b.dataset.v; renderGrid(); renderDetail(); });
  };
  const renderDetail=()=>{
    const d=$("#mpDetail"); if(!d) return;
    const mtype=modelType(picked,previews);
    const desc=modelDesc(picked,previews);
    d.innerHTML=picked?`
      <div class="ig-mp-detail-thumb">${_igModelBigThumb(picked,previews)}</div>
      <div class="ig-mp-detail-name">${esc(modelLabel(picked,previews))}</div>
      ${mtype?`<div class="ig-mp-detail-desc">${esc(mtype)}</div>`:""}
      ${desc?`<div class="ig-mp-detail-desc">${esc(desc)}</div>`:""}
      <button type="button" class="btn primary" id="mpUse">${esc(t("ig_use_this_model"))}</button>`
      : `<div class="hint">${esc(t("ig_model_pick_hint"))}</div>`;
    const useBtn=$("#mpUse");
    if(useBtn) useBtn.onclick=()=>{ onSelect(picked); closeModal(); };
  };
  const modelsTabHTML=`
    <input type="text" id="mpSearch" class="ig-mp-search" placeholder="${esc(t("ig_model_search_ph"))}">
    <div class="seg ig-mp-category-tabs" id="mpCategoryTabs">
      ${MODEL_CATEGORY_TABS.map(c=>`<button type="button" class="seg-btn ${category===c?"on":""}" data-c="${c}">${esc(modelCategoryLabel(c))}</button>`).join("")}
    </div>
    <label class="ig-mp-hide-legacy"><input type="checkbox" id="mpHideLegacy" ${hideLegacy?"checked":""}> ${esc(t("ig_mp_hide_legacy"))}</label>
    <div class="ig-mp-body">
      <div class="ig-grid ig-model-grid ig-mp-grid" id="mpGrid"></div>
      <div class="ig-mp-detail" id="mpDetail"></div>
    </div>`;
  let mrType="checkpoint";
  const requestTabHTML=`
    <p class="hint" style="margin:4px 0 14px;">${esc(t("ig_mp_request_hint")).replace("{hosts}", _modelRequestHosts.join(", "))}</p>
    <p class="hint" style="margin:0 0 14px;">${esc(t("ig_mp_find_checkpoint_hint"))}</p>
    <div class="field"><label>${esc(t("ig_mp_request_type"))}</label>
      <div class="seg" id="mrTypeSeg">
        <button type="button" class="seg-btn ${mrType==="checkpoint"?"on":""}" data-type="checkpoint">${esc(t("ig_mp_request_type_checkpoint"))}</button>
        <button type="button" class="seg-btn ${mrType==="anima"?"on":""}" data-type="anima">${esc(t("ig_mp_request_type_anima"))}</button>
      </div></div>
    <div class="field"><label>${esc(t("ig_mp_request_name"))}</label>
      <input type="text" id="mrName" placeholder="${esc(t("ig_mp_request_name_ph"))}"></div>
    <div class="field"><label>${esc(t("ig_mp_request_url"))}</label>
      <input type="text" id="mrUrl" placeholder="https://civitai.com/api/download/models/…">
      <div class="hint" style="margin-top:4px;">${esc(t("ig_mp_request_url_hint"))}</div>
      <div class="hint" id="mrUrlErr" style="color:var(--danger,#e05d5d);display:none;"></div></div>
    <div id="mrAnimaFields" style="${mrType==="anima"?"":"display:none;"}">
      <div class="field"><label>${esc(t("ig_mp_request_vae_url"))}</label>
        <input type="text" id="mrVaeUrl" placeholder="https://civitai.com/api/download/models/…">
        <div class="hint" style="margin-top:4px;">${esc(t("ig_mp_request_vae_url_hint"))}</div></div>
      <div class="field"><label>${esc(t("ig_mp_request_encoder_url"))}</label>
        <input type="text" id="mrEncoderUrl" placeholder="https://civitai.com/api/download/models/…">
        <div class="hint" style="margin-top:4px;">${esc(t("ig_mp_request_encoder_url_hint"))}</div></div>
    </div>
    <div class="field"><label>${esc(t("ig_mp_request_note"))}</label>
      <textarea id="mrNote" rows="2" placeholder="${esc(t("ig_mp_request_note_ph"))}"></textarea></div>
    <div class="actions"><button type="button" class="btn primary" id="mrSubmit">${esc(t("ig_mp_request_submit"))}</button></div>
    <div class="section-heading" style="margin:22px 0 12px;font-size:15px;">${esc(t("ig_mp_request_history"))}</div>
    <div id="mrHistory" class="ig-mr-history"></div>`;
  const loadHistory=async()=>{
    const el=$("#mrHistory"); if(!el) return;
    el.innerHTML=`<div class="hint">${esc(t("loading"))}</div>`;
    const rows=await api("/api/imagegen/model-requests").catch(()=>[]);
    el.innerHTML=rows.length?rows.map(r=>`
      <div class="ig-mr-row">
        <div class="ig-mr-row-main"><b>${esc(r.model_name)}</b><span class="ig-mr-status ig-mr-status-${esc(r.status)}">${esc(r.status)}</span></div>
        <div class="ig-mr-row-url mono">${esc(r.source_url)}</div>
      </div>`).join("") : `<div class="hint">${esc(t("ig_mp_request_history_empty"))}</div>`;
  };
  const renderBody=()=>{
    $("#mpBody").innerHTML=tab==="models"?modelsTabHTML:requestTabHTML;
    if(tab==="models"){
      $("#mpSearch").oninput=e=>{ query=e.target.value; renderGrid(); };
      $("#mpCategoryTabs").querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{
        category=b.dataset.c; localStorage.setItem("ig_mp_category",category);
        $("#mpCategoryTabs").querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("on",x===b));
        renderGrid();
      });
      $("#mpHideLegacy").onchange=e=>{
        hideLegacy=e.target.checked;
        localStorage.setItem("ig_mp_hide_legacy", hideLegacy?"1":"");
        renderGrid();
      };
      renderGrid(); renderDetail();
    } else {
      const urlInp=$("#mrUrl"), errEl=$("#mrUrlErr");
      $("#mrTypeSeg").querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{
        mrType=b.dataset.type;
        $("#mrTypeSeg").querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("on",x===b));
        $("#mrAnimaFields").style.display=mrType==="anima"?"":"none";
        if(mrType!=="anima"){ $("#mrVaeUrl").value=""; $("#mrEncoderUrl").value=""; }
      });
      const validate=()=>{
        const url=urlInp.value.trim();
        if(!url){ errEl.style.display="none"; return true; }
        if(!/^https?:\/\/.+/i.test(url)){
          errEl.style.display=""; errEl.style.color="var(--danger,#e05d5d)";
          errEl.textContent=t("ig_mp_request_url_malformed"); return false; }
        const allowed=_modelRequestHostAllowed(url);
        errEl.style.display=allowed?"none":"";
        errEl.style.color="var(--warn,#e0a800)";
        errEl.textContent=allowed?"":t("ig_mp_request_url_unlisted");
        return true;
      };
      urlInp.oninput=validate;
      $("#mrSubmit").onclick=async()=>{
        const model_name=$("#mrName").value.trim();
        const source_url=urlInp.value.trim();
        const note=$("#mrNote").value.trim();
        if(!model_name){ toast(t("ig_mp_request_name_required")); return; }
        if(!source_url || !validate()){ toast(t("ig_mp_request_url_malformed")); return; }
        const body={model_name, source_url, note, request_type:mrType};
        if(mrType==="anima"){
          const vae_url=$("#mrVaeUrl").value.trim();
          const text_encoder_url=$("#mrEncoderUrl").value.trim();
          if(vae_url) body.vae_url=vae_url;
          if(text_encoder_url) body.text_encoder_url=text_encoder_url;
        }
        try{
          await api("/api/imagegen/model-requests", j("POST",body));
          toast(t("ig_mp_request_submitted"));
          $("#mrName").value=""; $("#mrUrl").value=""; $("#mrNote").value="";
          if($("#mrVaeUrl")) $("#mrVaeUrl").value="";
          if($("#mrEncoderUrl")) $("#mrEncoderUrl").value="";
          loadHistory();
        }catch(e){ errorToast(e.message); }
      };
      loadHistory();
    }
  };
  openModal(`
    <button class="modal-close" id="mpClose">${esc(t("btn_close"))}</button>
    <h3>${esc(t("ig_model_picker_title"))}</h3>
    ${tabsHTML}
    <div id="mpBody"></div>`, "modal-wide", {stack:true});
  $("#mpClose").onclick=closeModal;
  $("#mpTabs").querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{
    tab=b.dataset.t;
    $("#mpTabs").querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("on", x===b));
    renderBody();
  });
  renderBody();
  _loadModelRequestHosts().then(()=>{ if(tab==="request") renderBody(); });
}
// LoRA picker: same 2×3-grid + "Show more" pattern as the model picker
// above; tiles show the admin-curated preview image when one is set (same
// {name: {image, display_name, description}} map as checkpoints), else the
// letter-avatar fallback. A selected LoRA reveals an inline strength slider
// beneath its tile. Multiple LoRAs stack, same chain semantics as before.
function mountLoraGrid(container, loraNames, {previews, value}={}){
  previews=previews||{};
  const selected=new Map(); // name -> strength
  (value||[]).forEach(l=>{ if(l&&l.name&&loraNames.includes(l.name)) selected.set(l.name, l.strength??1.0); });
  const INITIAL=6;
  const render=()=>{
    // Same most-used-first ranking as the checkpoint grid — selected LoRAs
    // always stay visible regardless of their own usage count, so toggling
    // one on never makes it disappear from view here.
    const counts=_pickerUsageCounts("ig_lora_usage");
    const byUsage=[...loraNames].sort((a,b)=>(counts[b]||0)-(counts[a]||0));
    const ordered=[...selected.keys(), ...byUsage.filter(n=>!selected.has(n))];
    const shown=ordered.slice(0,INITIAL);
    container.innerHTML=`
      <div class="ig-grid">${shown.map(name=>{
        const on=selected.has(name);
        const mtype=on?modelType(name,previews):"", desc=on?modelDesc(name,previews):"";
        return `<div class="ig-lora-tile-wrap">
          <button type="button" class="ig-grid-tile${on?" on":""}" data-v="${esc(name)}" title="${esc(name)}">
            ${_igModelBigThumb(name,previews)}
            <span class="ig-tile-name">${esc(modelLabel(name,previews))}</span>
          </button>
          ${on?`<div class="ig-lora-strength"><span class="hint">${esc(t("ig_strength"))} <span class="ig-lora-val">${selected.get(name)}</span></span>
            <input type="range" min="0" max="2.2" step="0.05" value="${selected.get(name)}" data-s="${esc(name)}"></div>`:""}
          ${(on&&(mtype||desc))?`<div class="ig-lora-desc">${mtype?`<div class="ig-mp-detail-desc">${esc(mtype)}</div>`:""}${desc?`<div class="ig-mp-detail-desc">${esc(desc)}</div>`:""}</div>`:""}
        </div>`;
      }).join("")}</div>
      <button type="button" class="ig-show-more" data-act="more">${esc(t("ig_show_more_loras"))}</button>`;
    container.querySelectorAll(".ig-grid-tile").forEach(b=>b.onclick=()=>{
      const n=b.dataset.v;
      if(selected.has(n)) selected.delete(n); else selected.set(n, 1.0);
      render();
    });
    container.querySelectorAll("input[type='range'][data-s]").forEach(inp=>inp.oninput=e=>{
      const n=e.target.dataset.s; selected.set(n, parseFloat(e.target.value));
      const v=e.target.closest(".ig-lora-strength").querySelector(".ig-lora-val");
      if(v) v.textContent=e.target.value;
    });
    const more=container.querySelector("[data-act='more']");
    if(more) more.onclick=async()=>{
      previews=(await refreshImagegenOptions()).loraPreviews;
      openLoraPickerModal(loraNames, previews, selected, render);
    };
  };
  render();
  return { getSelected:()=>[...selected.entries()].map(([name,strength])=>({name,strength})) };
}
// Full LoRA-picker modal — same layout as openModelPickerModal, but LoRAs are
// multi-select (a story can stack several) so tiles toggle into the shared
// `selected` Map with a per-LoRA strength slider (default 1.0) instead of a
// single-choice "Use this model" detail panel. The Request tab posts to the
// same model_requests backend with request_type="lora".
function openLoraPickerModal(loraNames, previews, selected, onChange){
  let tab="loras";
  let query="";
  const storedCategory=localStorage.getItem("ig_lp_category");
  let category=MODEL_CATEGORY_TABS.includes(storedCategory) ? storedCategory : "sdxl";
  let hideLegacy=localStorage.getItem("ig_mp_hide_legacy")==="1";
  // Purely informational (unlike the checkpoint picker's detail panel,
  // there's no separate "Use this" confirm step here — clicking a tile
  // already toggles it on/off directly) — just shows whichever LoRA was
  // last clicked, since the empty space next to the grid otherwise showed
  // nothing at all.
  let focused=null;
  const tabsHTML=`<div class="seg lib-tabs ig-mp-tabs" id="lpTabs">
    <button type="button" class="seg-btn ${tab==="loras"?"on":""}" data-t="loras"><b>${esc(t("ig_lora_section"))}</b></button>
    <button type="button" class="seg-btn ${tab==="request"?"on":""}" data-t="request"><b>${esc(t("ig_mp_tab_request"))}</b></button>
  </div>`;
  const renderDetail=()=>{
    const d=$("#lpDetail"); if(!d) return;
    const mtype=focused?modelType(focused,previews):"";
    const desc=focused?modelDesc(focused,previews):"";
    d.innerHTML=focused?`
      <div class="ig-mp-detail-thumb">${_igModelBigThumb(focused,previews)}</div>
      <div class="ig-mp-detail-name">${esc(modelLabel(focused,previews))}</div>
      ${mtype?`<div class="ig-mp-detail-desc">${esc(mtype)}</div>`:""}
      ${desc?`<div class="ig-mp-detail-desc">${esc(desc)}</div>`:""}`
      : `<div class="hint">${esc(t("ig_model_pick_hint"))}</div>`;
  };
  const renderGrid=()=>{
    const q=query.trim().toLowerCase();
    let list=q?loraNames.filter(n=>n.toLowerCase().includes(q)||modelLabel(n,previews).toLowerCase().includes(q)):loraNames;
    list=list.filter(n=>!modelCategories(n,previews).length||modelHasCategory(n,previews,category));
    if(hideLegacy) list=list.filter(n=>!hasOnlyLegacyCategories(n,previews));
    const grid=$("#lpGrid"); if(!grid) return;
    grid.innerHTML=list.length?list.map(name=>{
      const on=selected.has(name);
      return `<div class="ig-lora-tile-wrap">
        <button type="button" class="ig-grid-tile${on?" on":""}" data-v="${esc(name)}" title="${esc(name)}">
          ${_igModelBigThumb(name,previews)}
          <span class="ig-tile-name">${esc(modelLabel(name,previews))}</span>
        </button>
        ${on?`<div class="ig-lora-strength"><span class="hint">${esc(t("ig_strength"))} <span class="ig-lora-val">${selected.get(name)}</span></span>
          <input type="range" min="0" max="2.2" step="0.05" value="${selected.get(name)}" data-s="${esc(name)}"></div>`:""}
      </div>`;
    }).join("") : `<div class="hint">${esc(t("ig_lora_search_empty"))}</div>`;
    grid.querySelectorAll(".ig-grid-tile").forEach(b=>b.onclick=()=>{
      const n=b.dataset.v;
      if(selected.has(n)) selected.delete(n); else selected.set(n, 1.0);
      focused=n; renderGrid(); renderDetail(); if(onChange) onChange();
    });
    grid.querySelectorAll("input[type='range'][data-s]").forEach(inp=>inp.oninput=e=>{
      const n=e.target.dataset.s; selected.set(n, parseFloat(e.target.value));
      const v=e.target.closest(".ig-lora-strength").querySelector(".ig-lora-val");
      if(v) v.textContent=e.target.value;
      if(onChange) onChange();
    });
  };
  const lorasTabHTML=`
    <input type="text" id="lpSearch" class="ig-mp-search" placeholder="${esc(t("ig_lora_search_ph"))}">
    <div class="seg ig-mp-category-tabs" id="lpCategoryTabs">
      ${MODEL_CATEGORY_TABS.map(c=>`<button type="button" class="seg-btn ${category===c?"on":""}" data-c="${c}">${esc(modelCategoryLabel(c))}</button>`).join("")}
    </div>
    <label class="ig-mp-hide-legacy"><input type="checkbox" id="lpHideLegacy" ${hideLegacy?"checked":""}> ${esc(t("ig_mp_hide_legacy"))}</label>
    <div class="ig-mp-body">
      <div class="ig-grid ig-model-grid ig-mp-grid" id="lpGrid"></div>
      <div class="ig-mp-detail" id="lpDetail"></div>
    </div>
    <div class="actions" style="margin-top:14px;"><button type="button" class="btn primary" id="lpDone">${esc(t("ig_lora_done"))}</button></div>`;
  const requestTabHTML=`
    <p class="hint" style="margin:4px 0 14px;">${esc(t("ig_lora_request_hint")).replace("{hosts}", _modelRequestHosts.join(", "))}</p>
    <div class="field"><label>${esc(t("ig_lora_request_name"))}</label>
      <input type="text" id="lrName" placeholder="${esc(t("ig_lora_request_name_ph"))}"></div>
    <div class="field"><label>${esc(t("ig_mp_request_url"))}</label>
      <input type="text" id="lrUrl" placeholder="https://civitai.com/api/download/models/…">
      <div class="hint" style="margin-top:4px;">${esc(t("ig_mp_request_url_hint"))}</div>
      <div class="hint" id="lrUrlErr" style="color:var(--danger,#e05d5d);display:none;"></div></div>
    <div class="field"><label>${esc(t("ig_mp_request_note"))}</label>
      <textarea id="lrNote" rows="2" placeholder="${esc(t("ig_mp_request_note_ph"))}"></textarea></div>
    <div class="actions"><button type="button" class="btn primary" id="lrSubmit">${esc(t("ig_mp_request_submit"))}</button></div>
    <div class="section-heading" style="margin:22px 0 12px;font-size:15px;">${esc(t("ig_mp_request_history"))}</div>
    <div id="lrHistory" class="ig-mr-history"></div>`;
  const loadHistory=async()=>{
    const el=$("#lrHistory"); if(!el) return;
    el.innerHTML=`<div class="hint">${esc(t("loading"))}</div>`;
    const rows=(await api("/api/imagegen/model-requests").catch(()=>[])).filter(r=>r.request_type==="lora");
    el.innerHTML=rows.length?rows.map(r=>`
      <div class="ig-mr-row">
        <div class="ig-mr-row-main"><b>${esc(r.model_name)}</b><span class="ig-mr-status ig-mr-status-${esc(r.status)}">${esc(r.status)}</span></div>
        <div class="ig-mr-row-url mono">${esc(r.source_url)}</div>
      </div>`).join("") : `<div class="hint">${esc(t("ig_lora_request_history_empty"))}</div>`;
  };
  const renderBody=()=>{
    $("#lpBody").innerHTML=tab==="loras"?lorasTabHTML:requestTabHTML;
    if(tab==="loras"){
      $("#lpSearch").oninput=e=>{ query=e.target.value; renderGrid(); };
      $("#lpDone").onclick=closeModal;
      $("#lpCategoryTabs").querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{
        category=b.dataset.c; localStorage.setItem("ig_lp_category",category);
        $("#lpCategoryTabs").querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("on",x===b));
        renderGrid();
      });
      $("#lpHideLegacy").onchange=e=>{
        hideLegacy=e.target.checked;
        localStorage.setItem("ig_mp_hide_legacy", hideLegacy?"1":"");
        renderGrid();
      };
      renderGrid(); renderDetail();
    } else {
      const urlInp=$("#lrUrl"), errEl=$("#lrUrlErr");
      const validate=()=>{
        const url=urlInp.value.trim();
        if(!url){ errEl.style.display="none"; return true; }
        if(!/^https?:\/\/.+/i.test(url)){
          errEl.style.display=""; errEl.style.color="var(--danger,#e05d5d)";
          errEl.textContent=t("ig_mp_request_url_malformed"); return false; }
        const allowed=_modelRequestHostAllowed(url);
        errEl.style.display=allowed?"none":"";
        errEl.style.color="var(--warn,#e0a800)";
        errEl.textContent=allowed?"":t("ig_mp_request_url_unlisted");
        return true;
      };
      urlInp.oninput=validate;
      $("#lrSubmit").onclick=async()=>{
        const model_name=$("#lrName").value.trim();
        const source_url=urlInp.value.trim();
        const note=$("#lrNote").value.trim();
        if(!model_name){ toast(t("ig_mp_request_name_required")); return; }
        if(!source_url || !validate()){ toast(t("ig_mp_request_url_malformed")); return; }
        try{
          await api("/api/imagegen/model-requests", j("POST",{model_name, source_url, note, request_type:"lora"}));
          toast(t("ig_mp_request_submitted"));
          $("#lrName").value=""; $("#lrUrl").value=""; $("#lrNote").value="";
          loadHistory();
        }catch(e){ errorToast(e.message); }
      };
      loadHistory();
    }
  };
  openModal(`
    <button class="modal-close" id="lpClose">${esc(t("btn_close"))}</button>
    <h3>${esc(t("ig_lora_picker_title"))}</h3>
    ${tabsHTML}
    <div id="lpBody"></div>`, "modal-wide", {stack:true});
  $("#lpClose").onclick=closeModal;
  $("#lpTabs").querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{
    tab=b.dataset.t;
    $("#lpTabs").querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("on", x===b));
    renderBody();
  });
  renderBody();
  _loadModelRequestHosts().then(()=>{ if(tab==="request") renderBody(); });
}
// Compact button that shows the current checkpoint's friendly name and opens
// the full model-picker modal — replaces the old native-style dropdown in the
// secondary generate/pick modals (openImageGenModal, openImageGenPickerModal).
function mountCheckpointButton(container, checkpoints, {value, previews, onChange}={}){
  previews=previews||{};
  let current=value || checkpoints[0] || "";
  const render=()=>{
    container.innerHTML=`<button type="button" class="ig-picker-btn">
      ${_igModelBigThumb(current,previews)}
      <span class="ig-picker-btn-label">${current?esc(modelLabel(current,previews)):esc(t("ig_show_models_btn"))}</span>
    </button>`;
    container.querySelector(".ig-picker-btn").onclick=async()=>{
      previews=(await refreshImagegenOptions()).previews;
      openModelPickerModal(checkpoints, previews, current, v=>{ current=v; render(); if(onChange) onChange(v); });
    };
  };
  render();
  return { get value(){ return current; } };
}
// Compact button that shows the currently-selected LoRAs and opens the full
// LoRA-picker modal — replaces mountLoraMultiPicker's native-style dropdowns.
function mountLoraButton(container, loraNames, {previews, value}={}){
  previews=previews||{};
  const selected=new Map();
  (value||[]).forEach(l=>{ if(l&&l.name&&loraNames.includes(l.name)) selected.set(l.name, l.strength??1.0); });
  const render=()=>{
    const names=[...selected.keys()].map(n=>modelLabel(n,previews));
    container.innerHTML=`<button type="button" class="ig-picker-btn">
      <span class="ig-picker-btn-label">${names.length?esc(names.join(", ")):esc(t("ig_show_loras_btn"))}</span>
    </button>`;
    container.querySelector(".ig-picker-btn").onclick=async()=>{
      previews=(await refreshImagegenOptions()).loraPreviews;
      openLoraPickerModal(loraNames, previews, selected, render);
    };
  };
  render();
  return { getSelected:()=>[...selected.entries()].map(([name,strength])=>({name,strength})) };
}
// Upscaler request modal — no installed-upscalers grid exists in this app
// yet, so unlike openModelPickerModal/openLoraPickerModal this is just the
// request form + history, same backend endpoint with request_type="upscaler".
function openUpscalerRequestModal(){
  const loadHistory=async()=>{
    const el=$("#urHistory"); if(!el) return;
    el.innerHTML=`<div class="hint">${esc(t("loading"))}</div>`;
    const rows=(await api("/api/imagegen/model-requests").catch(()=>[])).filter(r=>r.request_type==="upscaler");
    el.innerHTML=rows.length?rows.map(r=>`
      <div class="ig-mr-row">
        <div class="ig-mr-row-main"><b>${esc(r.model_name)}</b><span class="ig-mr-status ig-mr-status-${esc(r.status)}">${esc(r.status)}</span></div>
        <div class="ig-mr-row-url mono">${esc(r.source_url)}</div>
      </div>`).join("") : `<div class="hint">${esc(t("ig_mp_request_history_empty"))}</div>`;
  };
  openModal(`
    <button class="modal-close" id="urClose">${esc(t("btn_close"))}</button>
    <h3>${esc(t("ig_upscaler_request_title"))}</h3>
    <p class="hint" style="margin:4px 0 14px;">${esc(t("ig_upscaler_request_hint")).replace("{hosts}", _modelRequestHosts.join(", "))}</p>
    <p class="hint" style="margin:0 0 14px;">${esc(t("ig_mp_find_upscaler_hint"))}</p>
    <div class="field"><label>${esc(t("ig_mp_request_name"))}</label>
      <input type="text" id="urName" placeholder="${esc(t("ig_mp_request_name_ph"))}"></div>
    <div class="field"><label>${esc(t("ig_mp_request_url"))}</label>
      <input type="text" id="urUrl" placeholder="https://civitai.com/api/download/models/…">
      <div class="hint" style="margin-top:4px;">${esc(t("ig_mp_request_url_hint"))}</div>
      <div class="hint" id="urUrlErr" style="color:var(--danger,#e05d5d);display:none;"></div></div>
    <div class="field"><label>${esc(t("ig_mp_request_note"))}</label>
      <textarea id="urNote" rows="2" placeholder="${esc(t("ig_mp_request_note_ph"))}"></textarea></div>
    <div class="actions"><button type="button" class="btn primary" id="urSubmit">${esc(t("ig_mp_request_submit"))}</button></div>
    <div class="section-heading" style="margin:22px 0 12px;font-size:15px;">${esc(t("ig_mp_request_history"))}</div>
    <div id="urHistory" class="ig-mr-history"></div>`, "modal-wide", {stack:true});
  $("#urClose").onclick=closeModal;
  const urlInp=$("#urUrl"), errEl=$("#urUrlErr");
  const validate=()=>{
    const url=urlInp.value.trim();
    if(!url){ errEl.style.display="none"; return true; }
    if(!/^https?:\/\/.+/i.test(url)){
      errEl.style.display=""; errEl.style.color="var(--danger,#e05d5d)";
      errEl.textContent=t("ig_mp_request_url_malformed"); return false; }
    const allowed=_modelRequestHostAllowed(url);
    errEl.style.display=allowed?"none":"";
    errEl.style.color="var(--warn,#e0a800)";
    errEl.textContent=allowed?"":t("ig_mp_request_url_unlisted");
    return true;
  };
  urlInp.oninput=validate;
  $("#urSubmit").onclick=async()=>{
    const model_name=$("#urName").value.trim();
    const source_url=urlInp.value.trim();
    const note=$("#urNote").value.trim();
    if(!model_name){ toast(t("ig_mp_request_name_required")); return; }
    if(!source_url || !validate()){ toast(t("ig_mp_request_url_malformed")); return; }
    try{
      await api("/api/imagegen/model-requests", j("POST",{model_name, source_url, note, request_type:"upscaler"}));
      toast(t("ig_mp_request_submitted"));
      $("#urName").value=""; urlInp.value=""; $("#urNote").value="";
      loadHistory();
    }catch(e){ errorToast(e.message); }
  };
  loadHistory();
  _loadModelRequestHosts().then(()=>{
    const hint=$("#urClose")?.closest(".modal")?.querySelector(".hint");
    if(hint) hint.textContent=t("ig_upscaler_request_hint").replace("{hosts}", _modelRequestHosts.join(", "));
  });
}
// Same standalone request-form pattern as openUpscalerRequestModal — no
// "Models"/"Request" tab toggle, no browse-existing grid, since opening this
// specifically to *add* a new one means the admin already knows it's not
// installed yet; making them click past a grid of what's already there first
// was pointless friction. kind is "checkpoint" (shows the checkpoint/Anima
// type toggle + Anima's extra VAE/text-encoder URL fields) or "lora" (fixed
// type, no toggle, no extra fields).
function openModelRequestModal(kind){
  let mrType="checkpoint";
  const isLora=kind==="lora";
  const loadHistory=async()=>{
    const el=$("#mraHistory"); if(!el) return;
    el.innerHTML=`<div class="hint">${esc(t("loading"))}</div>`;
    const rows=(await api("/api/imagegen/model-requests").catch(()=>[]))
      .filter(r=>isLora ? r.request_type==="lora" : (r.request_type==="checkpoint"||r.request_type==="anima"));
    el.innerHTML=rows.length?rows.map(r=>`
      <div class="ig-mr-row">
        <div class="ig-mr-row-main"><b>${esc(r.model_name)}</b><span class="ig-mr-status ig-mr-status-${esc(r.status)}">${esc(r.status)}</span></div>
        <div class="ig-mr-row-url mono">${esc(r.source_url)}</div>
      </div>`).join("") : `<div class="hint">${esc(t("ig_mp_request_history_empty"))}</div>`;
  };
  openModal(`
    <button class="modal-close" id="mraClose">${esc(t("btn_close"))}</button>
    <h3>${isLora?"Request a LoRA":"Request a model"}</h3>
    <p class="hint" style="margin:4px 0 14px;">${esc(t("ig_mp_request_hint")).replace("{hosts}", _modelRequestHosts.join(", "))}</p>
    ${isLora?"":`<p class="hint" style="margin:0 0 14px;">${esc(t("ig_mp_find_checkpoint_hint"))}</p>
    <div class="field"><label>${esc(t("ig_mp_request_type"))}</label>
      <div class="seg" id="mraTypeSeg">
        <button type="button" class="seg-btn on" data-type="checkpoint">${esc(t("ig_mp_request_type_checkpoint"))}</button>
        <button type="button" class="seg-btn" data-type="anima">${esc(t("ig_mp_request_type_anima"))}</button>
      </div></div>`}
    <div class="field"><label>${esc(t("ig_mp_request_name"))}</label>
      <input type="text" id="mraName" placeholder="${esc(t("ig_mp_request_name_ph"))}"></div>
    <div class="field"><label>${esc(t("ig_mp_request_url"))}</label>
      <input type="text" id="mraUrl" placeholder="https://civitai.com/api/download/models/…">
      <div class="hint" style="margin-top:4px;">${esc(t("ig_mp_request_url_hint"))}</div>
      <div class="hint" id="mraUrlErr" style="color:var(--danger,#e05d5d);display:none;"></div></div>
    ${isLora?"":`<div id="mraAnimaFields" style="display:none;">
      <div class="field"><label>${esc(t("ig_mp_request_vae_url"))}</label>
        <input type="text" id="mraVaeUrl" placeholder="https://civitai.com/api/download/models/…">
        <div class="hint" style="margin-top:4px;">${esc(t("ig_mp_request_vae_url_hint"))}</div></div>
      <div class="field"><label>${esc(t("ig_mp_request_encoder_url"))}</label>
        <input type="text" id="mraEncoderUrl" placeholder="https://civitai.com/api/download/models/…">
        <div class="hint" style="margin-top:4px;">${esc(t("ig_mp_request_encoder_url_hint"))}</div></div>
    </div>`}
    <div class="field"><label>${esc(t("ig_mp_request_note"))}</label>
      <textarea id="mraNote" rows="2" placeholder="${esc(t("ig_mp_request_note_ph"))}"></textarea></div>
    <div class="actions"><button type="button" class="btn primary" id="mraSubmit">${esc(t("ig_mp_request_submit"))}</button></div>
    <div class="section-heading" style="margin:22px 0 12px;font-size:15px;">${esc(t("ig_mp_request_history"))}</div>
    <div id="mraHistory" class="ig-mr-history"></div>`, "modal-wide", {stack:true});
  $("#mraClose").onclick=closeModal;
  const typeSeg=$("#mraTypeSeg");
  if(typeSeg) typeSeg.querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{
    mrType=b.dataset.type;
    typeSeg.querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("on",x===b));
    const animaFields=$("#mraAnimaFields");
    if(animaFields) animaFields.style.display=mrType==="anima"?"":"none";
  });
  const urlInp=$("#mraUrl"), errEl=$("#mraUrlErr");
  const validate=()=>{
    const url=urlInp.value.trim();
    if(!url){ errEl.style.display="none"; return true; }
    if(!/^https?:\/\/.+/i.test(url)){
      errEl.style.display=""; errEl.style.color="var(--danger,#e05d5d)";
      errEl.textContent=t("ig_mp_request_url_malformed"); return false; }
    const allowed=_modelRequestHostAllowed(url);
    errEl.style.display=allowed?"none":"";
    errEl.style.color="var(--warn,#e0a800)";
    errEl.textContent=allowed?"":t("ig_mp_request_url_unlisted");
    return true;
  };
  urlInp.oninput=validate;
  $("#mraSubmit").onclick=async()=>{
    const model_name=$("#mraName").value.trim();
    const source_url=urlInp.value.trim();
    const note=$("#mraNote").value.trim();
    if(!model_name){ toast(t("ig_mp_request_name_required")); return; }
    if(!source_url || !validate()){ toast(t("ig_mp_request_url_malformed")); return; }
    const body={model_name, source_url, note, request_type:isLora?"lora":mrType};
    if(!isLora && mrType==="anima"){
      const vae_url=($("#mraVaeUrl")?.value||"").trim();
      const text_encoder_url=($("#mraEncoderUrl")?.value||"").trim();
      if(vae_url) body.vae_url=vae_url;
      if(text_encoder_url) body.text_encoder_url=text_encoder_url;
    }
    try{
      await api("/api/imagegen/model-requests", j("POST",body));
      toast(t("ig_mp_request_submitted"));
      $("#mraName").value=""; urlInp.value=""; $("#mraNote").value="";
      loadHistory();
    }catch(e){ errorToast(e.message); }
  };
  loadHistory();
  _loadModelRequestHosts().then(()=>{
    const hint=$("#mraClose")?.closest(".modal")?.querySelector(".hint");
    if(hint) hint.textContent=t("ig_mp_request_hint").replace("{hosts}", _modelRequestHosts.join(", "));
  });
}
// Aspect ratio + resolution controls. Aspect selects the shape; resolution
// selects the long-edge size tier; getSize() derives concrete width/height
// (multiples of 8) threaded into the generation request.
function mountAspectResolution(container){
  const ratios=[{id:"3:4",w:3,h:4},{id:"1:1",w:1,h:1},{id:"9:16",w:9,h:16},
                {id:"3:5",w:3,h:5},{id:"4:3",w:4,h:3},{id:"16:9",w:16,h:9}];
  const tiers=[{id:"s",label:t("ig_res_s"),edge:768},{id:"m",label:t("ig_res_m"),edge:1024},{id:"l",label:t("ig_res_l"),edge:1280}];
  let ratio=ratios[0], tier=tiers[1], custom=null; // custom={w,h}
  const round8=v=>Math.max(256, Math.min(2048, Math.round(v/8)*8));
  const size=()=>{
    if(custom) return {width:round8(custom.w), height:round8(custom.h)};
    const {w,h}=ratio, edge=tier.edge;
    return w>=h ? {width:round8(edge), height:round8(edge*h/w)}
                : {width:round8(edge*w/h), height:round8(edge)};
  };
  const render=()=>{
    const s=size();
    container.innerHTML=`
      <div class="ig-sec" data-key="aspect">${igSectionHead("aspect", t("ig_aspect"))}
        <div class="ig-sec-body">
        <div class="ig-ratio-row">${ratios.map(r=>{
          const on=!custom&&r.id===ratio.id;
          const long=48, w=r.w>=r.h?long:Math.round(long*r.w/r.h), h=r.h>=r.w?long:Math.round(long*r.h/r.w);
          return `<button type="button" class="ig-ratio-btn${on?" on":""}" data-r="${r.id}">
            <span class="ig-ratio-box" style="width:${w*0.5}px;height:${h*0.5}px;"></span>
            <span>${r.id}</span></button>`;
        }).join("")}
        <button type="button" class="ig-ratio-btn${custom?" on":""}" data-r="custom"><span class="ig-ratio-box ig-ratio-custom">±</span><span>${esc(t("ig_aspect_custom"))}</span></button>
        </div>
        </div>
      </div>
      <div class="ig-sec" data-key="resolution">${igSectionHead("resolution", t("ig_resolution"))}
        <div class="ig-sec-body">
        <div class="ig-res-row">${tiers.map(tr=>`<button type="button" class="ig-res-btn${!custom&&tr.id===tier.id?" on":""}" data-t="${tr.id}">${esc(tr.label)}</button>`).join("")}
        <span class="ig-res-dims">${s.width}×${s.height}</span></div>
        ${custom?`<div class="ig-custom-dims"><input type="number" id="igCustW" value="${custom.w}" min="256" max="2048" step="8"> × <input type="number" id="igCustH" value="${custom.h}" min="256" max="2048" step="8"></div>`:""}
        </div>
      </div>`;
    container.querySelectorAll(".ig-ratio-btn").forEach(b=>b.onclick=()=>{
      if(b.dataset.r==="custom"){ const s2=size(); custom={w:s2.width,h:s2.height}; }
      else { custom=null; ratio=ratios.find(r=>r.id===b.dataset.r); }
      render();
    });
    container.querySelectorAll(".ig-res-btn").forEach(b=>b.onclick=()=>{ custom=null; tier=tiers.find(tr=>tr.id===b.dataset.t); render(); });
    const cw=container.querySelector("#igCustW"), ch=container.querySelector("#igCustH");
    if(cw) cw.oninput=e=>{ custom.w=parseInt(e.target.value)||custom.w; container.querySelector(".ig-res-dims").textContent=size().width+"×"+size().height; };
    if(ch) ch.oninput=e=>{ custom.h=parseInt(e.target.value)||custom.h; container.querySelector(".ig-res-dims").textContent=size().width+"×"+size().height; };
    wireIgSections(container);
  };
  render();
  return { getSize:size };
}
// Static descriptions for well-known Stable-Diffusion/ComfyUI samplers and
// schedulers. These are generic algorithm names, not per-instance files, so
// there's nothing to fetch — the text is hand-written and kept accurate.
const SAMPLER_DESCS={
  euler:"The simplest, fastest solver — a solid deterministic baseline that converges cleanly.",
  euler_ancestral:"Euler with ancestral (added) noise each step — more varied, creative results but non-deterministic and can look busier.",
  heun:"A second-order solver that refines each Euler step with a correction — more accurate than Euler, but roughly twice as slow.",
  heunpp2:"An improved higher-order Heun variant — slightly more accurate than plain Heun at a similar speed cost.",
  dpm_2:"A second-order DPM solver — higher accuracy than Euler at the cost of an extra model call per step.",
  dpm_2_ancestral:"DPM 2nd-order with ancestral noise — more varied output, non-deterministic, at a similar speed cost to dpm_2.",
  lms:"Linear multi-step (Adams-like) solver — reuses previous steps for efficiency, good quality but can be unstable at very low step counts.",
  dpm_fast:"A fixed-step DPM variant tuned for speed at low step counts — quick but lower quality than modern DPM++ solvers.",
  dpm_adaptive:"Adaptively chooses its own step sizes for accuracy — high quality but ignores the step count and can be slow.",
  dpmpp_2s_ancestral:"DPM++ single-step 2nd-order with ancestral noise — high quality and varied, but slower and non-deterministic.",
  dpmpp_sde:"DPM++ using a stochastic (SDE) formulation — excellent detail and quality, non-deterministic, slower than the ODE variants.",
  dpmpp_2m:"DPM++ 2M, a high-quality second-order multi-step solver — a fast, reliable default for most generations.",
  dpmpp_2m_sde:"DPM++ 2M in its stochastic (SDE) form — often richer detail than plain 2M, at the cost of determinism.",
  dpmpp_3m_sde:"DPM++ third-order multi-step SDE solver — can capture fine detail but usually needs more steps to be stable.",
  ddim:"An older deterministic solver — fast and stable, but generally lower quality than modern DPM++ solvers.",
  uni_pc:"UniPC, a unified predictor-corrector solver — high quality and fast convergence, good at low step counts.",
  uni_pc_bh2:"UniPC using the BH2 corrector variant — similar to uni_pc, often slightly higher quality.",
  lcm:"For Latent Consistency Models — produces images in very few steps (around 4-8) with a compatible LCM checkpoint or LoRA.",
};
const SCHEDULER_DESCS={
  simple:"A plain, evenly-spaced noise schedule — a straightforward default that works well in most cases.",
  normal:"The standard model-derived schedule (linear in the model's own noise space) — a safe general-purpose choice.",
  karras:"Spaces steps to spend more time at low noise levels — often produces sharper details, especially at higher step counts.",
  exponential:"Distributes noise levels on an exponential curve — a smooth schedule that can help fine detail.",
  sgm_uniform:"The uniform schedule used by SGM-style models — recommended for SDXL and models trained with that formulation.",
  ddim_uniform:"The uniform timestep spacing used by the original DDIM sampler — pair it with DDIM for expected results.",
  beta:"Derives step spacing from the model's beta (noise) schedule — a good match for models using that training formulation.",
  linear_quadratic:"Blends linear early steps with quadratic spacing later — designed to improve results at low step counts.",
  kl_optimal:"A schedule optimized to minimize KL divergence between steps — aims for efficient, high-quality sampling.",
};
function samplerDesc(name){
  if(SAMPLER_DESCS[name]) return SAMPLER_DESCS[name];
  let base=name, suffix="";
  if(name.endsWith("_cfg_pp")){ base=name.slice(0,-7); suffix=" (cfg++ variant of the same algorithm)"; }
  else if(name.endsWith("_gpu")){ base=name.slice(0,-4); suffix=" (GPU-noise variant of the same algorithm)"; }
  if(suffix && SAMPLER_DESCS[base]) return SAMPLER_DESCS[base]+suffix;
  return "";
}
function schedulerDesc(name){ return SCHEDULER_DESCS[name]||""; }
// Single-choice image-tile grid, same layout as mountModelGrid but with the
// Request tab dropped (samplers/schedulers are a fixed built-in set). Falls back
// to a built-in description (builtinDesc) when no admin one is set — same
// precedence as modelDesc()||describeCheckpoint() for checkpoints. Reuses the
// shared preview map helpers (modelLabel/modelDesc/modelImage/_igModelBigThumb).
function mountChoiceGrid(container, names, {value, previews, builtinDesc, showMoreLabel, openPicker, onChange, usageKey}={}){
  previews=previews||{};
  let current=value || names[0] || "";
  const INITIAL=6;
  const render=()=>{
    const desc=modelDesc(current,previews)||(builtinDesc?builtinDesc(current):"");
    // Same most-used-first ranking as the checkpoint/LoRA grids — the current
    // selection always leads regardless of its own usage count.
    let shown=names.slice(0,INITIAL);
    if(usageKey){
      const counts=_pickerUsageCounts(usageKey);
      const byUsage=[...names].sort((a,b)=>(counts[b]||0)-(counts[a]||0));
      const ordered=current&&byUsage.includes(current) ? [current, ...byUsage.filter(n=>n!==current)] : byUsage;
      shown=ordered.slice(0,INITIAL);
    }
    container.innerHTML=`
      <div class="ig-model-summary">
        ${_igModelBigThumb(current,previews)}
        <div class="ig-model-summary-txt"><b>${esc(modelLabel(current,previews)||"—")}</b>${desc?`<span>${esc(desc)}</span>`:""}</div>
      </div>
      <div class="ig-grid ig-model-grid">${shown.map(name=>`
        <button type="button" class="ig-grid-tile ig-model-tile${name===current?" on":""}" data-v="${esc(name)}" title="${esc(name)}">
          ${_igModelBigThumb(name,previews)}
          <span class="ig-tile-name">${esc(modelLabel(name,previews))}</span>
        </button>`).join("")}</div>
      <button type="button" class="ig-show-more" data-act="more">${esc(showMoreLabel)}</button>`;
    container.querySelectorAll(".ig-grid-tile").forEach(b=>b.onclick=()=>{ current=b.dataset.v; render(); if(onChange) onChange(current); });
    const more=container.querySelector("[data-act='more']");
    if(more) more.onclick=()=>openPicker(current, v=>{ current=v; render(); if(onChange) onChange(current); });
  };
  render();
  return { get value(){ return current; } };
}
// Full single-choice picker modal — same layout as openModelPickerModal minus
// the Request tab: search box + scrollable grid of every option + a detail
// panel with a bigger preview and a "Use this …" button.
function openChoicePickerModal(names, previews, current, onSelect, opts){
  previews=previews||{};
  const {title, searchPh, useLabel, builtinDesc, emptyMsg, pickHint}=opts;
  let query="";
  let picked=current;
  const renderGrid=()=>{
    const q=query.trim().toLowerCase();
    const list=q?names.filter(n=>n.toLowerCase().includes(q)||modelLabel(n,previews).toLowerCase().includes(q)):names;
    const grid=$("#cpGrid"); if(!grid) return;
    grid.innerHTML=list.length?list.map(name=>`
      <button type="button" class="ig-grid-tile ig-model-tile${name===picked?" on":""}" data-v="${esc(name)}" title="${esc(name)}">
        ${_igModelBigThumb(name,previews)}
        <span class="ig-tile-name">${esc(modelLabel(name,previews))}</span>
      </button>`).join("") : `<div class="hint">${esc(emptyMsg)}</div>`;
    grid.querySelectorAll(".ig-grid-tile").forEach(b=>b.onclick=()=>{ picked=b.dataset.v; renderGrid(); renderDetail(); });
  };
  const renderDetail=()=>{
    const d=$("#cpDetail"); if(!d) return;
    const desc=modelDesc(picked,previews)||(builtinDesc?builtinDesc(picked):"");
    d.innerHTML=picked?`
      <div class="ig-mp-detail-thumb">${_igModelBigThumb(picked,previews)}</div>
      <div class="ig-mp-detail-name">${esc(modelLabel(picked,previews))}</div>
      ${desc?`<div class="ig-mp-detail-desc">${esc(desc)}</div>`:""}
      <button type="button" class="btn primary" id="cpUse">${esc(useLabel)}</button>`
      : `<div class="hint">${esc(pickHint)}</div>`;
    const useBtn=$("#cpUse");
    if(useBtn) useBtn.onclick=()=>{ onSelect(picked); closeModal(); };
  };
  openModal(`
    <button class="modal-close" id="cpClose">${esc(t("btn_close"))}</button>
    <h3>${esc(title)}</h3>
    <input type="text" id="cpSearch" class="ig-mp-search" placeholder="${esc(searchPh)}">
    <div class="ig-mp-body">
      <div class="ig-grid ig-model-grid ig-mp-grid" id="cpGrid"></div>
      <div class="ig-mp-detail" id="cpDetail"></div>
    </div>`, "modal-wide", {stack:true});
  $("#cpClose").onclick=closeModal;
  $("#cpSearch").oninput=e=>{ query=e.target.value; renderGrid(); };
  renderGrid(); renderDetail();
}
async function mountSamplerPickers(container, {savedSampler, savedScheduler, onChange}={}){
  if(!_samplerData || !_samplerPreviews || !_schedulerPreviews){
    const [data, sampPrev, schedPrev]=await Promise.all([
      api("/api/imagegen/samplers").catch(()=>({samplers:[], schedulers:[]})),
      api("/api/imagegen/sampler-previews").catch(()=>({})),
      api("/api/imagegen/scheduler-previews").catch(()=>({})),
    ]);
    _samplerData=data; _samplerPreviews=sampPrev; _schedulerPreviews=schedPrev;
  }
  const samplers=_samplerData.samplers||[], schedulers=_samplerData.schedulers||[];
  const sampPrev=_samplerPreviews, schedPrev=_schedulerPreviews;
  const sampVal=(savedSampler&&samplers.includes(savedSampler))?savedSampler
    :samplers.includes("dpmpp_2m_sde_gpu")?"dpmpp_2m_sde_gpu":(samplers.includes("euler")?"euler":(samplers[0]||"euler"));
  const schedVal=(savedScheduler&&schedulers.includes(savedScheduler))?savedScheduler
    :schedulers.includes("karras")?"karras":(schedulers.includes("normal")?"normal":(schedulers[0]||"normal"));
  container.innerHTML=`
    <div class="field"><label>${esc(t("ig_sampler"))}</label><div id="ig_samp_sel"></div></div>
    <div class="field"><label>${esc(t("ig_scheduler"))}</label><div id="ig_sched_sel"></div></div>`;
  const sampSel=mountChoiceGrid(container.querySelector("#ig_samp_sel"), samplers, {
    value:sampVal, previews:sampPrev, builtinDesc:samplerDesc, showMoreLabel:t("ig_show_more_samplers"),
    usageKey:"ig_sampler_usage",
    openPicker:(cur,cb)=>openChoicePickerModal(samplers, sampPrev, cur, cb, {
      title:t("ig_sampler_picker_title"), searchPh:t("ig_sampler_search_ph"), useLabel:t("ig_use_this_sampler"),
      builtinDesc:samplerDesc, emptyMsg:t("ig_sampler_search_empty"), pickHint:t("ig_sampler_pick_hint")}),
    onChange:v=>{ if(onChange) onChange({sampler:v, scheduler:schedSel.value}); }});
  const schedSel=mountChoiceGrid(container.querySelector("#ig_sched_sel"), schedulers, {
    value:schedVal, previews:schedPrev, builtinDesc:schedulerDesc, showMoreLabel:t("ig_show_more_schedulers"),
    usageKey:"ig_scheduler_usage",
    openPicker:(cur,cb)=>openChoicePickerModal(schedulers, schedPrev, cur, cb, {
      title:t("ig_scheduler_picker_title"), searchPh:t("ig_scheduler_search_ph"), useLabel:t("ig_use_this_scheduler"),
      builtinDesc:schedulerDesc, emptyMsg:t("ig_scheduler_search_empty"), pickHint:t("ig_scheduler_pick_hint")}),
    onChange:v=>{ if(onChange) onChange({sampler:sampSel.value, scheduler:v}); }});
  return { get sampler(){ return sampSel.value; }, get scheduler(){ return schedSel.value; } };
}
// Any dropdown/menu toggle should close every OTHER open dropdown first — without
// this, opening one via a button that calls e.stopPropagation() (so its own click
// doesn't immediately re-close it) also stops that click from ever reaching the
// document-level listeners that close unrelated dropdowns, leaving both open.
function closeAllDropdowns(){
  document.querySelectorAll(".chat-more-menu:not([hidden])").forEach(m=>m.hidden=true);
  document.querySelectorAll(".dd.open").forEach(d=>d.classList.remove("open"));
  document.querySelectorAll(".cs.open").forEach(c=>c.classList.remove("open"));
  document.querySelectorAll(".cs-menu-portal").forEach(m=>m.remove());
  if(_cpPop) _cpPop.hidden=true;
  document.querySelectorAll(".confirm-pop").forEach(p=>p.remove());
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

