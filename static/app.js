"use strict";

const store = (() => {
  let ok=false; try{localStorage.setItem("_t","1");localStorage.removeItem("_t");ok=true;}catch(e){}
  const m={};
  return {get:(k,d)=>{try{return (ok?localStorage.getItem(k):m[k])??d;}catch(e){return m[k]??d;}},
          set:(k,v)=>{try{ok?localStorage.setItem(k,v):m[k]=v;}catch(e){m[k]=v;}}};
})();

/* Served same-origin from the backend, so API base is empty by default. */
let API = store.get("api","").replace(/\/+$/,"");
let THINK = store.get("think","1")==="1";
let THEME = store.get("theme","dark");
let ME = null;
let _showingLogin = false;

/* ============================ UI TRANSLATION (i18n) ============================
   Static English source strings for the app chrome (nav, settings, etc). Any
   element tagged data-i18n="key" gets its textContent swapped for the translation;
   JS-generated markup should call t('key') directly. loadUiTranslations() fetches
   (and localStorage-caches) a translated copy from the backend, which itself
   batch-translates + server-side caches per language — see /api/ui-translations
   and _translate_ui_batch in server.py. English (the default) never round-trips. */
const UI_STRINGS = {
  nav_library: "Library", nav_community: "Community", nav_personas: "Personas", nav_gallery: "Image Gallery",
  nav_imagegen: "Generate Image",
  ig_page_title: "Generate Image", ig_page_sub: "Standalone image generation — not tied to any chat. Nothing is saved unless you choose to.",
  ig_positive_ph: "Describe what you want to see…", ig_negative_ph: "Things to avoid (optional)…",
  ig_generate: "Generate", ig_generating: "Generating…", ig_save: "Save", ig_regenerate: "Regenerate", ig_discard: "Discard",
  ig_saved_title: "Saved images", ig_saved_empty: "Nothing saved yet.",
  ig_save_failed: "Save failed", ig_saved_toast: "Saved to your Image Gallery.",
  gallery_title: "Image Gallery", gallery_sub: "Every image generated across your chats — manage or delete them here.",
  gallery_empty: "No images yet — generate one from any assistant reply in a chat.",
  gallery_delete_confirm: "confirm delete", gallery_deleted: "Image deleted.", gallery_delete_failed: "Delete failed",
  gallery_open_chat: "Open chat",
  gallery_scene_label: "Scene", gallery_positive_label: "Positive tags", gallery_negative_label: "Negative tags",
  gallery_tags_unrecorded: "Tags weren't recorded for this image (generated before this feature was added).",
  gallery_copy_tags: "Copy", gallery_tags_copied: "Tags copied.",
  nav_admin: "Admin", nav_new_character: "New character", recent_chats: "Recent chats",
  btn_settings: "Settings", sign_out: "Sign out", nav_profile: "View profile",
  theme_dark_mode: "Dark mode", theme_light_mode: "Light mode",
  settings_title: "Settings", settings_theme: "Theme",
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
  lib_sub: "Characters you've created or imported — private to you.",
  comm_eyebrow: "Shared catalog", comm_title: "Community",
  comm_sub: "Characters shared by all users. Anyone can start a chat; only admins can delete.",
  search_placeholder: "Search by name, persona, or tag",
  personas_eyebrow: "Personas", personas_title: "Who you are",
  personas_sub: "Define how characters see you. {{user}} becomes the persona's name, and its description is shared with the character. Pick one when you start a chat.",
  btn_new_persona: "New persona",
  btn_add_entry: "Add entry",
  tool_copy: "copy", tool_translate: "translate", tool_regenerate: "regenerate",
  tool_edit: "edit", tool_continue: "continue", tool_continue_with: "continue with...",
  tool_image: "🎨 image", tool_image_regen: "🎨 regenerate image", tool_image_confirm: "confirm 🎨",
  img_gen_title: "Generate image", img_gen_checkpoint: "Model",
  img_gen_lora: "LoRA (optional)", img_gen_lora_none: "None", img_gen_strength: "LoRA strength",
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
  doss_persona: "Persona", doss_scenario: "Scenario", doss_opening: "Opening line",
  doss_preview: "Preview", doss_preview_title: "Greeting preview", doss_preview_variant: "Variant",
  doss_share: "Share", doss_share_copied: "Link copied — paste it in Discord/WhatsApp for a rich preview.",
  doss_preview_empty: "This character has no greeting to preview yet.",
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
  li_err_req: "Username and password required.", li_err_match: "Passwords do not match.",
  btn_cancel: "Cancel", btn_save: "Save",
  pm_edit: "Edit persona", pm_new: "New persona",
  pm_desc: "Description", pm_desc_hint: "how the character perceives you",
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
  pf_ava_hint: "shown next to your username; GIFs supported", pf_banner_hint: "wide image at the top of your profile; static images only, no GIFs",
  pf_social: "Social", pf_social_twitter: "Twitter", pf_social_twitch: "Twitch",
  pf_social_instagram: "Instagram", pf_social_discord: "Discord", pf_social_pixiv: "Pixiv",
  pf_social_youtube: "YouTube", pf_social_patreon: "Patreon", pf_social_kofi: "Ko-fi",
  pf_html_summary: "Advanced: Custom HTML/CSS",
  pf_html_sub: "Optional. Replaces your entire profile page — banner, avatar, bio, and the Characters grid all become whatever you build here. Leave blank to keep the default layout above.",
  pf_html_placeholders: "Text placeholders (replaced with your live data before rendering):",
  pf_html_characters_label: "Embedding your character cards:", pf_html_characters_hint: "put {{characters}} anywhere in your markup and it's replaced with a real grid of your published scenarios (thumbnail, title, summary, chat count, up to 3 tags) — each linking to that scenario's page. Style the grid with these classes: .gl-characters (grid container), .gl-character-card (each card, an <a> link), .gl-character-thumb (image wrapper — the actual <img> inside is .gl-character-img), .gl-character-title, .gl-character-summary, .gl-character-meta (the row holding chat count + tags), .gl-character-chats (just the number — its 💬 icon comes from a ::before you can override), .gl-character-tags (wraps each individual .gl-tag pill). These come with working default styles you can freely override — no property is required, override only what you want to change; anything else keeps looking right.",
  pf_html_links_label: "Embedding your links:", pf_html_links_hint: "put {{links}} anywhere in your markup and it's replaced with favicon links for whichever of Twitter, Twitch, Instagram, Discord, Pixiv, YouTube, Patreon, and Ko-fi you filled in above (leave them blank to omit them entirely). Style them with .gl-links (row container), .gl-link (each <a>, has a data-platform=\"twitter\"/etc attribute you can target and a --gl-color custom property set to that platform's brand color), .gl-link-icon (the svg), .gl-link-host (a text label with the platform's domain, hidden by default — set it to display:inline to show text alongside the icon).",
  pf_html_share_label: "Embedding a share button (required):", pf_html_share_hint: "put {{share}} anywhere in your markup and it's replaced with a working \"Share\" link that copies your profile's link-preview URL (what Discord/WhatsApp/Slack unfurl into a rich card) to the clipboard. Every custom layout must include it somewhere — saving is blocked otherwise. Style it with .gl-share (the <a> itself, already has a default pill style you can override).",
  pf_html_edit_label: "Embedding an edit button (required):", pf_html_edit_hint: "put {{edit}} anywhere in your markup and it's replaced with a working \"Edit profile\" link that reopens this editor — visible only to you, blank for every other visitor. Without it you'd have no way back into this editor once your custom layout hides the default one. Every custom layout must include it somewhere — saving is blocked otherwise. Style it with .gl-edit (already has a default pill style you can override).",
  pf_html_share_required: "Your custom HTML must include a {{share}} placeholder somewhere before you can save.",
  pf_html_edit_required: "Your custom HTML must include an {{edit}} placeholder somewhere before you can save.",
  pf_html_vars_label: "CSS variables:", pf_html_vars_hint: "var(--profile-gradient-start) and var(--profile-gradient-end) hold your chosen Theme Gradient colors from above. If you've uploaded a Banner Image, var(--profile-banner-url) is also available (e.g. background-image: var(--profile-banner-url)) — it's only defined when a banner exists.",
  pf_html_example: "Example:",
  pf_html_upload_btn: "Upload HTML/CSS File", pf_html_code_label: "HTML / CSS", pf_html_preview_label: "Live preview",
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
  adm_purge_p: "This will permanently delete all characters, personas, lore, sessions, and messages. User accounts are preserved. This cannot be undone.",
  adm_type_delete: "Type DELETE to confirm", adm_purge_go: "Purge everything",
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
  adm_new_user: "New user", adm_purge: "Purge all data",
  adm_pending: "Pending approval", adm_awaiting: "Awaiting approval",
  adm_approve: "Approve", adm_deny: "Deny",
  adm_users: "Users", adm_you: "(you)", adm_admin: "Admin",
  adm_reset_pw: "Reset pw", adm_demote: "Demote", adm_make_admin: "Make admin",
  adm_delete: "Delete", adm_logs: "Server logs",
  adm_logs_note: "Only what this app explicitly logs for debugging — IDs, roles, counts. Never chat or character content, API keys, or endpoint URLs.",
  adm_refresh: "Refresh",
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
    list.hidden=false;
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
    list.hidden=false;
    list.querySelectorAll("div").forEach(d=>d.onmousedown=e=>{ e.preventDefault(); inp.value=d.dataset.f; inp.dispatchEvent(new Event("input")); list.hidden=true; });
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
    confirmPopover(anchor, message, confirmLabel||t("tool_delete"), ()=>resolve(true), ()=>resolve(false));
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
  set("--ink", a.text);
  set("--accent", a.accent);
  if(a.accent) set("--accent-deep", a.accent);
  set("--paper", a.appBg);
  r.style.fontSize = a.scale ? (a.scale+"px") : "";
  set("--chat-bg", a.chatBg);   // used by the chat scene as a fallback background
}
function saveAppearance(patch){ APPEARANCE={...APPEARANCE,...patch}; store.set("appearance",JSON.stringify(APPEARANCE)); applyAppearance(); }

function applyTheme(theme){
  THEME=theme; store.set("theme",theme);
  document.documentElement.dataset.theme = (theme==="light") ? "light" : "";
  const b=document.getElementById("themeBtn");
  if(b){
    const dark=theme==="dark", key=dark?"theme_light_mode":"theme_dark_mode";
    b.textContent="";
    b.appendChild(document.createTextNode(dark?"☀ ":"☾ "));
    const span=document.createElement("span");
    span.dataset.i18n=key; span.textContent=t(key);
    b.appendChild(span);
  }
}
function toggleTheme(){ applyTheme(THEME==="dark"?"light":"dark"); }
applyTheme(THEME);
applyAppearance();

async function api(path, opts){
  const res = await fetch(API+path, opts);
  if(res.status === 401){
    // /explore is deliberately reachable with no session — a stray 401 from
    // some endpoint there shouldn't blow away the explore page and force
    // the login form back over it.
    const onExplorePage = location.hash.replace(/^#/,"").split("/").filter(Boolean)[0]==="explore";
    if(!onExplorePage) showLoginScreen();
    throw new Error("Not authenticated");
  }
  if(!res.ok){ throw new Error((await res.text()).slice(0,200) || res.status); }
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
function sanitizeCardCSS(css){
  let out=String(css||"").replace(/@import[^;]*;?/gi, "");
  out=out.replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (m,_q,u)=>{
    const v=u.trim();
    if(/^data:/i.test(v)) return m;
    if(/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith("//")) return "none";
    return m;
  });
  return out;
}
function mountSandboxedHTML(container, html, {autoHeight=true, onReady}={}){
  const ifr=document.createElement("iframe");
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
  const cleanBody=DOMPurify.sanitize(markup, {});
  ifr.srcdoc=`<!doctype html><html><head><style>html,body{margin:0;background:#000;}\n${styles.join("\n")}</style></head><body>${cleanBody}</body></html>`;
  ifr.onload=()=>{ try{ if(autoHeight) ifr.style.height=ifr.contentDocument.body.scrollHeight+"px"; onReady&&onReady(ifr.contentDocument); }catch(e){} };
  container.innerHTML="";
  container.appendChild(ifr);
  return ifr;
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
function wrapQuotedDialogue(text){
  // Skip fenced code blocks (odd segments after this split) so raw JSON/code
  // containing "quotes" never gets HTML spliced into it before marked runs.
  return String(text||"").split(/(```[\s\S]*?```)/).map((seg,i)=>
    i%2===1 ? seg : seg.replace(/"([^"\n]+)"/g, '<span class="md-quote">"$1"</span>')
  ).join("");
}
function md(text){ try{ return DOMPurify.sanitize(marked.parse(wrapQuotedDialogue(text), {gfm:true,breaks:true}), {ADD_TAGS:["span"],ADD_ATTR:["class"]}); }catch(e){ return esc(text); } }
const AP_PREVIEW_TEXT='*She glances toward the door.* "Are you coming with us?" `I really hope so...` ***This changes everything!*** **We need to move, now.**';
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
  if(url) return `<img class="ava ${cls||""}" src="${esc(url)}"${pos} alt="">`;
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
function toast(m){ const t=$("#toast"); t.textContent=trNow(m); t.classList.add("show"); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("show"),2600); }
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
let _imagegenCheckpoints=null, _imagegenLoras=null;
async function getImagegenOptions(){
  if(_imagegenCheckpoints) return {checkpoints:_imagegenCheckpoints, loras:_imagegenLoras};
  const [checkpoints, loras]=await Promise.all([
    api("/api/imagegen/checkpoints").catch(()=>[]),
    api("/api/imagegen/loras").catch(()=>[]),
  ]);
  _imagegenCheckpoints=checkpoints; _imagegenLoras=loras;
  return {checkpoints, loras};
}
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
  const bubble=(g,i)=>`<div class="turn ai">
    <div class="name">${esc(c.name)}${greetings.length>1?` <span class="ooc-tag">${esc(t("doss_preview_variant"))} ${i+1}</span>`:""}</div>
    <div class="md">${md(substMacros(g, c.name, userName))}</div>
  </div>`;
  openModal(`
    <button class="modal-close" id="pgClose">${esc(t("btn_close"))}</button>
    <h3>${esc(t("doss_preview_title"))}</h3>
    <div class="preview-thread">${greetings.map(bubble).join("")}</div>`);
  $("#pgClose").onclick=closeModal;
}

async function checkConn(){
  const d=$("#conn .d"), ct=$("#connText");
  if(!d||!ct) return;
  try{ const h=await api("/api/health"); d.className="d "+(h.ok?"ok":"bad"); ct.textContent=(h.characters||0)+" "+t("conn_chars")+" · "+(h.memories||0)+" "+t("conn_mems"); }
  catch(e){ d.className="d bad"; ct.textContent=t("conn_offline"); }
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
            g.onclick = () => location.hash = "#/chat/" + g.parentElement.dataset.id
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
        <div style="text-align:center;margin-top:18px;"><a href="#/explore" style="color:var(--muted);font-size:13px;">${esc(t("explore_link"))}</a></div>
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
    `);
    document.getElementById("li_btn").addEventListener("click", doLogin);
    document.getElementById("li_pass").addEventListener("keydown", e=>{ if(e.key==="Enter") doLogin(); });
    document.getElementById("li_toreg").addEventListener("click", e=>{ e.preventDefault(); renderRegister(); });
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
    document.getElementById("li_ruser").focus();
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
      if(!r.ok){ const d=await r.json().catch(()=>({detail:"Login failed"})); if(errEl) errEl.textContent=d.detail||"Login failed"; return; }
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
        ${ME.is_admin?'<span class="badge always" style="font-size:9px;">admin</span>':""}
      </div>
    </div>
    <div class="modal-foot" style="justify-content:space-between;">
      <a class="btn" href="#/u/${encodeURIComponent(ME.username)}" onclick="closeModal()">${esc(t("nav_profile"))}</a>
      <button class="btn danger" id="railModalLogout">⎋ ${esc(t("sign_out"))}</button>
    </div>`);
  document.getElementById("railModalLogout").onclick = () => { closeModal(); _doLogout(); };
}
function renderUserMenu(){
  const info = document.getElementById("userInfo");
  if(!info) return;
  if(!ME){ info.innerHTML=""; info.classList.add("user-info-empty"); return; }
  info.classList.remove("user-info-empty");
  const avaHTML = ME.avatar
    ? `<img src="${esc(mediaURL(ME.avatar))}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex:none;">`
    : `<div style="width:28px;height:28px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;color:var(--accent);background:var(--accent-tint);">${esc((ME.username||"?")[0].toUpperCase())}</div>`;
  info.innerHTML = `
    <button id="userInfoBtn" style="width:100%;font-size:13px;color:var(--sec);padding:4px 10px 6px;display:flex;align-items:center;gap:8px;background:none;border:none;text-align:left;">
      ${avaHTML}
      <span style="flex:1;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(ME.username)}</span>
      ${ME.is_admin?'<span class="badge always" style="font-size:9px;flex:none;">admin</span>':""}
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
    const seg0=location.hash.replace(/^#/,"").split("/").filter(Boolean);
    if(seg0[0]==="explore") return route();
    showLoginScreen();
    return;
  }
  document.body.classList.remove("unauthed");
  renderUserMenu();
  route();
  checkConn();
  setInterval(checkConn, 60000);
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
      <a class="btn primary" href="#/">← ${esc(t("back_to_library"))}</a>
    </div>
  </div>`;
}

/* ============================ MOBILE DRAWER ============================ */
if(store.get("railCollapsed","false")==="true") document.body.classList.add("rail-collapsed");
const toggleRailCollapsed=()=>{
  const collapsed=document.body.classList.toggle("rail-collapsed");
  store.set("railCollapsed", collapsed?"true":"false");
};
$("#railGlyphBtn")?.addEventListener("click", (e)=>{ e.preventDefault(); toggleRailCollapsed(); });
$("#railCollapseBtn")?.addEventListener("click", toggleRailCollapsed);
function openDrawer(){ $("#rail").classList.add("open"); $("#scrimNav").classList.add("open"); }
function closeDrawer(){ $("#rail").classList.remove("open"); $("#scrimNav").classList.remove("open"); }
$("#mHamb")?.addEventListener("click", openDrawer);
$("#scrimNav")?.addEventListener("click", closeDrawer);
$("#mGear")?.addEventListener("click", ()=> $("#settingsBtn")?.click());
$("#tabMenu")?.addEventListener("click", (e)=>{ e.preventDefault(); openDrawer(); });
$("#nav")?.addEventListener("click", (e)=>{ if(e.target.closest("a")) closeDrawer(); });
// #settingsBtn/#themeBtn live in the drawer's footer (not #nav), so tapping
// them on mobile left the drawer open behind whatever they triggered.
$(".rail .foot")?.addEventListener("click", (e)=>{ if(e.target.closest("button")) closeDrawer(); });

/* ============================ EXPLORE (anonymous, read-only) ============================ */
function _exploreShell(){
  document.body.classList.add("unauthed");
  const main=$("#main");
  main.innerHTML=`
    <div class="explore-topbar">
      <a href="#/explore" class="brand explore-brand">
        <span class="glyph">❖</span>
        <div class="brand-text">
          <span class="name">StoryHaven AI</span>
          <span class="tagline">${esc(t("tagline"))}</span>
        </div>
      </a>
      <div class="explore-topbar-actions">
        <button type="button" class="btn" id="exploreThemeBtn">${THEME==="dark"?"☾":"☀"}</button>
        <a href="#/" class="btn primary explore-signin">${esc(t("explore_signin_register"))}</a>
      </div>
    </div>
    <div id="exploreMain"></div>
    <div class="explore-footnote">${esc(t("explore_nsfw_notice"))}</div>`;
  $("#exploreThemeBtn").onclick=()=>{ toggleTheme(); $("#exploreThemeBtn").textContent = THEME==="dark"?"☾":"☀"; };
  return $("#exploreMain");
}

async function routeExplore(seg){
  const box=_exploreShell();
  try{
    if(seg[0]==="c") return viewExploreCharacter(box, seg[1]);
    return viewExploreCommunity(box);
  }catch(e){
    errorPage(box, {title:"Something went wrong", message:"An error occurred while loading this page.", detail:e.message});
  }
}

async function viewExploreCommunity(main){
  let modeFilter = store.get("exploreMode","all");
  main.innerHTML=`<div class="wrap wrap-wide">
    <div class="explore-comm-head">
      <div>
        <div class="page-eyebrow">${esc(t("comm_eyebrow"))}</div>
        <h1 class="page">${esc(t("comm_title"))}</h1>
        <div class="page-sub">${esc(t("comm_sub"))}</div>
      </div>
      <div class="explore-comm-controls">
        <div class="search"><span class="ic">⌕</span><input id="q" placeholder="${esc(t("search_placeholder"))}"></div>
        <div class="view-switch" id="modeSwitch" role="group" aria-label="Mode">
          <button type="button" class="vs-btn" data-mode="all">${esc(t("comm_mode_all"))}</button>
          <button type="button" class="vs-btn" data-mode="rpg">${esc(t("badge_rpg"))}</button>
          <button type="button" class="vs-btn" data-mode="character">${esc(t("badge_character"))}</button>
        </div>
      </div>
    </div>
    <div class="catalog" id="catalog"></div>
  </div>`;
  const paintMode=()=>{ $("#modeSwitch").querySelectorAll(".vs-btn").forEach(b=>b.classList.toggle("on", b.dataset.mode===modeFilter)); };
  $("#modeSwitch").addEventListener("click", e=>{
    const b=e.target.closest(".vs-btn"); if(!b) return;
    modeFilter=b.dataset.mode; store.set("exploreMode",modeFilter); paintMode(); render();
  });
  paintMode();
  const render=async()=>{
    const q=$("#q").value.trim();
    const params=new URLSearchParams({scope:"community"}); if(q) params.set("q",q);
    let chars=await api("/api/characters?"+params);
    if(modeFilter!=="all") chars=chars.filter(c=>(c.mode||"character")===modeFilter);
    const box=$("#catalog");
    box.classList.add("catalog-card");
    if(!chars.length){ box.innerHTML=`<div class="empty"><div class="big">${esc(t("empty_lib"))}</div></div>`; return; }
    const r=_catalogView(chars, "card", id=>location.hash="#/explore/c/"+id);
    box.innerHTML=r.html; r.wire(box);
  };
  let qT; $("#q").addEventListener("input",()=>{clearTimeout(qT);qT=setTimeout(render,200);});
  render();
}

async function viewExploreCharacter(main, cid){
  const [c, lore]=await Promise.all([
    api("/api/characters/"+cid),
    api("/api/characters/"+cid+"/lore").catch(()=>[]),
  ]);
  const heroImg = mediaURL((c.assets||{}).banner||"") || mediaURL((c.assets&&c.assets.stage&&c.assets.stage.default)||"") || mediaURL(c.avatar);
  const hasCustom=(c.presentation_html||"").trim().length>0;
  const exploreDescription = substMacros(c.description, c.name, "You");
  main.innerHTML=`<div class="wrap">
    <div class="doss-hero"${heroImg?` style="background-image:url('${esc(heroImg)}')"`:""}><div class="doss-hero-fade"></div></div>
    <div class="doss-card">
      <div class="doss-card-ava">${avatar(c)}</div>
      <div class="doss-card-body">
        <div class="call">${esc(callno(c))}</div>
        <div class="doss-card-row">
          <h1>${esc(c.name)}</h1>
          <div class="doss-actions"><a class="btn primary" href="#/">${esc(t("explore_signin_to_chat"))}</a></div>
        </div>
        <div class="meta"><span class="tag mode-tag" style="${c.mode==='rpg'?'background:var(--accent-soft);color:var(--accent-deep);border-color:transparent;':''}">${esc(c.mode==='rpg'?t("badge_rpg"):t("badge_character"))}</span><span class="tag-group">${(c.tags||[]).map(tg=>`<span class="tag">${esc(tg)}</span>`).join("")}</span></div>
        ${c.description?`<div class="doss-desc">${esc(exploreDescription)}</div>`:""}
      </div>
    </div>
    ${(()=>{
      const loreCardHTML = `<div class="lore-card">
        <div class="lore-card-head"><span>${esc(t("doss_lore_card_title"))}</span></div>
        ${lore.length?lore.map(l=>`<div class="lore-link-row" data-lore="${esc(l.id)}">
          ${l.image?`<div class="lore-link-ava"><img class="ava" src="${esc(mediaURL(l.image))}" alt=""></div>`:""}
          <div class="lore-link-info">
            <div class="t">${esc(l.name||(l.keys&&l.keys[0])||l.category||t("doss_lore_untitled"))}</div>
            <div class="s">${esc(l.category||t("doss_lore_group"))}</div>
          </div>
        </div>`).join(""):`<div class="empty"><div class="big">${esc(t("doss_lore_empty"))}</div></div>`}
      </div>`;
      if(hasCustom){
        return `<div class="doss-layout">
          <div class="doss-main"><div class="doss-presentation" id="dossPresentation"></div></div>
          <div class="doss-sidebar">${loreCardHTML}</div>
        </div>`;
      }
      return loreCardHTML ? `<div class="section">${loreCardHTML}</div>` : "";
    })()}
  </div>`;
  if(hasCustom) mountSandboxedHTML($("#dossPresentation"), c.presentation_html);
  main.querySelectorAll("[data-lore]").forEach(row=>row.onclick=()=>{
    loreEntryModal(cid, lore.find(x=>x.id===row.dataset.lore), false, ()=>{});
  });
}

/* ============================ ROUTER ============================ */
async function route(){
  closeDrawer();
  const h=location.hash.replace(/^#/,"")||"/";
  if(!ME){
    const seg0=h.split("/").filter(Boolean);
    if(seg0[0]==="explore") return routeExplore(seg0.slice(1));
    _showingLogin=false; showLoginScreen();
    return;
  }
  const seg=h.split("/").filter(Boolean);
  const top=seg[0]||"library";
  document.querySelectorAll("#nav a[data-route], #tabbar a[data-route]").forEach(a=>a.classList.toggle("on", a.dataset.route===(seg.length?top:"library")));
  const main=$("#main");
  if(top!=="chat") ChatState.clear();
  loadRecent();
  try{
    if(seg.length===0) return viewLibrary(main);
    if(seg[0]==="community") return viewCommunity(main);
    if(seg[0]==="personas") return viewPersonas(main);
    if(seg[0]==="gallery") return viewImageGallery(main);
    if(seg[0]==="imagegen") return viewImageGen(main);
    if(seg[0]==="u")        return viewProfile(main, decodeURIComponent(seg[1]||""));
    if(seg[0]==="admin")   return viewAdmin(main);
    if(seg[0]==="create") return viewEditor(main, null);
    if(seg[0]==="edit")   return viewEditor(main, seg[1]);
    if(seg[0]==="c")      return viewDossier(main, seg[1]);
    if(seg[0]==="chat")   return viewChat(main, seg[1]);
    return errorPage(main, {code:"404", title:"Page not found",
      message:"There's nothing at this address."});
  }catch(e){
    if(e.message==="Not authenticated") return;
    const isOffline = e.message.includes("fetch") || e.message.includes("network") || e.message.includes("Failed");
    errorPage(main, {
      title: isOffline ? "Backend unreachable" : "Something went wrong",
      message: isOffline
        ? "Can't connect to the server. Make sure the backend is running and this page is served from it."
        : "An error occurred while loading this page.",
      detail: e.message,
    });
  }
}
window.addEventListener("hashchange", route);

/* ============================ LIBRARY ============================ */
function _catalogView(chars, view, linkFn){
  if(!chars.length) return null;
  const tagSpan=t=>`<span class="tag tag-filter" data-tag="${esc(t)}">${esc(t)}</span>`;
  const html = view==="card" ? chars.map(c=>`
    <div class="card-entry" data-id="${c.id}">
      <div class="card-media">
        ${avatar(c,"card-ava")}
        <div class="card-fade"></div>
      </div>
      <div class="card-body">
        <div class="meta"><span class="tag card-chats">💬 ${c.chats||0}</span>${(c.tags||[]).slice(0,3).map(tagSpan).join("")}</div>
        <h3>${esc(c.name)}</h3>
        <p class="log">${esc(logline(c))}</p>
        <span class="by">${esc(t("by_word"))} ${c.owner_username?`<a class="by-link" href="#/u/${encodeURIComponent(c.owner_username)}" onclick="event.stopPropagation()">${esc(c.creator||c.owner_username)}</a>`:esc(c.creator||"you")}</span>
      </div>
    </div>`).join("") : chars.map(c=>`
    <div class="entry" data-id="${c.id}">
      <div>
        <div class="call">${esc(callno(c))}</div>
        <h3>${esc(c.name)}</h3>
        <p class="log">${esc(logline(c))}</p>
        <div class="meta">
          ${(c.tags||[]).slice(0,4).map(tagSpan).join("")}
          <span class="by">${c.chats||0} ${esc(t("chats_word"))} · ${esc(t("by_word"))} ${esc(c.creator||"you")}</span>
        </div>
      </div>
      ${avatar(c)}
    </div>`).join("");
  return {html, wire: box => {
    localizeContent([...box.querySelectorAll(".entry, .card-entry")].flatMap(e=>{
      const c=chars.find(x=>x.id===e.dataset.id)||{};
      return [{el:e.querySelector(".log"), text:logline(c)},
              {el:e.querySelector("h3"),   text:c.name||""}];
    }).concat([...box.querySelectorAll(".tag-filter")].map(p=>({el:p, text:p.dataset.tag}))));
    box.querySelectorAll(".entry, .card-entry").forEach(e=>e.onclick=()=>linkFn(e.dataset.id));
    box.querySelectorAll(".tag-filter").forEach(pill=>pill.onclick=e=>{
      e.stopPropagation();
      const q=$("#q"); if(q){ q.value=pill.dataset.tag; q.dispatchEvent(new Event("input")); }
    });
    box.querySelectorAll(".card-media img.card-ava").forEach(img=>tintCardMedia(img));
  }};
}

async function viewLibrary(main){
  let view = store.get("libView","list");
  main.innerHTML=`<div class="wrap">
    <div class="page-eyebrow">${esc(t("lib_eyebrow"))}</div>
    <h1 class="page">${esc(t("lib_title"))}</h1>
    <div class="page-sub">${esc(t("lib_sub"))}</div>
    <div class="toolbar">
      <div class="search"><span class="ic">⌕</span><input id="q" placeholder="${esc(t("search_placeholder"))}"></div>
      <div class="view-switch" id="viewSwitch" role="group" aria-label="Layout">
        <button type="button" class="vs-btn" data-view="list" title="${esc(t("view_list"))}">☰</button>
        <button type="button" class="vs-btn" data-view="card" title="${esc(t("view_card"))}">▦</button>
      </div>
      <a class="btn primary" href="#/create">+ ${esc(t("btn_new"))}</a>
    </div>
    <div class="catalog" id="catalog"></div>
  </div>`;
  const paintSwitch=()=>{ $("#viewSwitch").querySelectorAll(".vs-btn").forEach(b=>b.classList.toggle("on", b.dataset.view===view)); };
  $("#viewSwitch").addEventListener("click", e=>{
    const b=e.target.closest(".vs-btn"); if(!b) return;
    view=b.dataset.view; store.set("libView",view); paintSwitch(); render();
  });
  paintSwitch();
  const render=async()=>{
    const q=$("#q").value.trim();
    const params=new URLSearchParams({scope:"mine"}); if(q) params.set("q",q);
    const chars=await api("/api/characters?"+params);
    const box=$("#catalog");
    box.classList.toggle("catalog-card", view==="card");
    if(!chars.length){ box.innerHTML=`<div class="empty"><div class="big">${esc(q?t("empty_search"):t("empty_lib"))}</div>${q?"":esc(t("empty_lib_hint"))}</div>`; return; }
    const r=_catalogView(chars, view, id=>location.hash="#/c/"+id);
    box.innerHTML=r.html; r.wire(box);
  };
  let qT; $("#q").addEventListener("input",()=>{clearTimeout(qT);qT=setTimeout(render,200);});
  render();
}

async function viewCommunity(main){
  let view = store.get("libView","list");
  let rating = store.get("commRating","sfw");   // "sfw" | "nsfw"
  let modeFilter = store.get("commMode","all"); // "all" | "rpg" | "character"
  main.innerHTML=`<div class="wrap wrap-wide">
    <div class="page-eyebrow">${esc(t("comm_eyebrow"))}</div>
    <h1 class="page">${esc(t("comm_title"))}</h1>
    <div class="page-sub">${esc(t("comm_sub"))}</div>
    <div class="toolbar">
      <div class="search"><span class="ic">⌕</span><input id="q" placeholder="${esc(t("search_placeholder"))}"></div>
      <div class="view-switch" id="ratingSwitch" role="group" aria-label="Rating">
        <button type="button" class="vs-btn" data-rating="sfw">${esc(t("comm_sfw"))}</button>
        <button type="button" class="vs-btn" data-rating="nsfw">${esc(t("comm_nsfw"))}</button>
        <button type="button" class="vs-btn" data-rating="both">${esc(t("comm_mode_all"))}</button>
      </div>
      <div class="view-switch" id="modeSwitch" role="group" aria-label="Mode">
        <button type="button" class="vs-btn" data-mode="all">${esc(t("comm_mode_all"))}</button>
        <button type="button" class="vs-btn" data-mode="rpg">${esc(t("badge_rpg"))}</button>
        <button type="button" class="vs-btn" data-mode="character">${esc(t("badge_character"))}</button>
      </div>
      <div class="view-switch" id="viewSwitch" role="group" aria-label="Layout">
        <button type="button" class="vs-btn" data-view="list" title="${esc(t("view_list"))}">☰</button>
        <button type="button" class="vs-btn" data-view="card" title="${esc(t("view_card"))}">▦</button>
      </div>
    </div>
    <div class="catalog" id="catalog"></div>
  </div>`;
  const paintSwitch=()=>{ $("#viewSwitch").querySelectorAll(".vs-btn").forEach(b=>b.classList.toggle("on", b.dataset.view===view)); };
  $("#viewSwitch").addEventListener("click", e=>{
    const b=e.target.closest(".vs-btn"); if(!b) return;
    view=b.dataset.view; store.set("libView",view); paintSwitch(); render();
  });
  paintSwitch();
  const paintRating=()=>{ $("#ratingSwitch").querySelectorAll(".vs-btn").forEach(b=>b.classList.toggle("on", b.dataset.rating===rating)); };
  $("#ratingSwitch").addEventListener("click", e=>{
    const b=e.target.closest(".vs-btn"); if(!b) return;
    rating=b.dataset.rating; store.set("commRating",rating); paintRating(); render();
  });
  paintRating();
  const paintMode=()=>{ $("#modeSwitch").querySelectorAll(".vs-btn").forEach(b=>b.classList.toggle("on", b.dataset.mode===modeFilter)); };
  $("#modeSwitch").addEventListener("click", e=>{
    const b=e.target.closest(".vs-btn"); if(!b) return;
    modeFilter=b.dataset.mode; store.set("commMode",modeFilter); paintMode(); render();
  });
  paintMode();
  const render=async()=>{
    const q=$("#q").value.trim();
    const params=new URLSearchParams({scope:"community"}); if(q) params.set("q",q);
    let chars=await api("/api/characters?"+params);
    if(rating!=="both") chars=chars.filter(c=>rating==="nsfw" ? !!c.is_explicit : !c.is_explicit);
    if(modeFilter!=="all") chars=chars.filter(c=>(c.mode||"character")===modeFilter);
    const box=$("#catalog");
    box.classList.toggle("catalog-card", view==="card");
    if(!chars.length){ box.innerHTML=`<div class="empty"><div class="big">${esc(q?t("empty_search"):t("empty_comm"))}</div>${q?"":esc(t("empty_comm_hint"))}</div>`; return; }
    const r=_catalogView(chars, view, id=>location.hash="#/c/"+id);
    box.innerHTML=r.html; r.wire(box);
  };
  let qT; $("#q").addEventListener("input",()=>{clearTimeout(qT);qT=setTimeout(render,200);});
  render();
}

/* ============================ ADMIN ============================ */
async function viewAdmin(main){
  if(!ME || !ME.is_admin){ main.innerHTML=`<div class="wrap"><div class="empty"><div class="big">${esc(t("access_denied"))}</div></div></div>`; return; }
  const render = async () => {
    const allUsers = await api("/api/admin/users");
    const pending = allUsers.filter(u => u.status === "pending");
    const active  = allUsers.filter(u => u.status !== "pending");
    const flagged = await api("/api/admin/flagged-endpoints").catch(()=>[]);

    const flaggedSection = flagged.length ? `
      <div class="section" style="border-color:var(--warn-soft,#4a3000);background:var(--warn-bg,rgba(255,170,0,.06));border-radius:12px;padding:14px 16px 6px;margin-bottom:20px;">
        <h4 style="color:var(--warn);">🚩 ${esc(t("admin_flagged_title"))} (${flagged.length})</h4>
        ${flagged.map(f=>`
          <div class="session-row" data-fid="${esc(f.id)}">
            <div class="go">
              <div class="t" style="font-family:var(--mono);font-size:13px;word-break:break-all;">${esc(f.url)}</div>
              <div class="p">${esc(f.username||f.user_id)} · ${esc(t("admin_flagged_reason"))}: ${esc(f.reason)}</div>
            </div>
            <div style="display:flex;gap:6px;flex:none;align-items:center;">
              <button class="btn" data-allow-ep="${esc(f.id)}" style="padding:5px 10px;font-size:12px;">${esc(t("admin_flagged_allow"))}</button>
              <button class="btn danger" data-block-ep="${esc(f.id)}" style="padding:5px 10px;font-size:12px;">${esc(t("admin_flagged_block"))}</button>
            </div>
          </div>`).join("")}
      </div>` : "";

    const pendingSection = pending.length ? `
      <div class="section" style="border-color:var(--warn-soft,#4a3000);background:var(--warn-bg,rgba(255,170,0,.06));border-radius:12px;padding:14px 16px 6px;margin-bottom:20px;">
        <h4 style="color:var(--warn);">⏳ ${esc(t("adm_pending"))} (${pending.length})</h4>
        ${pending.map(u=>`
          <div class="session-row">
            <div class="go">
              <div class="t">${esc(u.username)}</div>
              <div class="p">${esc(t("adm_awaiting"))} · <span style="font-family:var(--mono);font-size:11px;">${esc(u.id.slice(0,8))}…</span></div>
            </div>
            <div style="display:flex;gap:6px;flex:none;align-items:center;">
              <button class="btn primary" data-approve="${u.id}" style="padding:5px 10px;font-size:12px;">${esc(t("adm_approve"))}</button>
              <button class="btn danger"  data-deny="${u.id}"    style="padding:5px 10px;font-size:12px;">${esc(t("adm_deny"))}</button>
            </div>
          </div>`).join("")}
      </div>` : "";

    main.innerHTML = `<div class="wrap">
      <div class="page-eyebrow">${esc(t("adm_eyebrow"))}</div>
      <h1 class="page">${esc(t("adm_title"))}</h1>
      <div class="page-sub">${esc(t("adm_sub"))}</div>
      <div class="actions">
        <button class="btn primary" id="createUserBtn">+ ${esc(t("adm_new_user"))}</button>
        <button class="btn danger" id="purgeBtn">⚠ ${esc(t("adm_purge"))}</button>
      </div>
      ${pendingSection}
      <div class="section"><h4>${esc(t("adm_users"))} (${active.length})</h4>
        ${active.map(u=>`
          <div class="session-row">
            <div class="go">
              <div class="t">${esc(u.username)}${u.id===ME.id?` <span style="color:var(--muted);font-size:12px;font-weight:400;">${esc(t("adm_you"))}</span>`:''}</div>
              <div class="p">${u.is_admin?`${esc(t("adm_admin"))} · `:''}<span style="font-family:var(--mono);font-size:11px;">${esc(u.id.slice(0,8))}…</span></div>
            </div>
            <div style="display:flex;gap:6px;flex:none;align-items:center;">
              <button class="btn" data-resetpw="${u.id}" style="padding:5px 10px;font-size:12px;">${esc(t("adm_reset_pw"))}</button>
              ${u.is_admin
                ? `<button class="btn" data-role="${u.id}" data-toadmin="false" style="padding:5px 10px;font-size:12px;">${esc(t("adm_demote"))}</button>`
                : `<button class="btn" data-role="${u.id}" data-toadmin="true" style="padding:5px 10px;font-size:12px;">${esc(t("adm_make_admin"))}</button>`}
              ${u.id!==ME.id?`<button class="btn danger" data-delusr="${u.id}" style="padding:5px 10px;font-size:12px;">${esc(t("adm_delete"))}</button>`:''}
            </div>
          </div>`).join("")}
      </div>
      <div class="section">
        <h4>${esc(t("adm_logs"))}</h4>
        <p style="color:var(--muted);font-size:12.5px;margin:0 0 12px;">${esc(t("adm_logs_note"))}</p>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
          <select id="logLevel" style="background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:13px;color:var(--ink);">
            <option value="DEBUG">${esc(t("log_debug"))}</option>
            <option value="INFO" selected>${esc(t("log_info"))}</option>
            <option value="WARNING">${esc(t("log_warn"))}</option>
            <option value="ERROR">${esc(t("log_err"))}</option>
          </select>
          <button class="btn" id="logRefresh" style="padding:7px 12px;">↻ ${esc(t("adm_refresh"))}</button>
        </div>
        <div id="logView" style="max-height:420px;overflow-y:auto;background:var(--surface-2);border:1px solid var(--line);border-radius:9px;padding:10px 12px;font-family:var(--mono);font-size:12px;line-height:1.65;"></div>
      </div>
    </div>`;

    const renderLogs = async () => {
      const level = document.getElementById("logLevel")?.value || "INFO";
      const box = document.getElementById("logView"); if(!box) return;
      box.innerHTML = `<span style="color:var(--muted)">${esc(t("loading"))}</span>`;
      try{
        const {logs} = await api(`/api/admin/logs?level=${level}&limit=300`);
        box.innerHTML = logs.length ? logs.slice().reverse().map(l=>{
          const dt = new Date(l.ts*1000).toLocaleString();
          const color = (l.level==="ERROR"||l.level==="CRITICAL") ? "var(--warn)" : l.level==="WARNING" ? "var(--accent)" : "var(--sec)";
          return `<div style="padding:2px 0;white-space:pre-wrap;word-break:break-word;"><span style="color:var(--muted)">${esc(dt)}</span> <span style="color:${color};font-weight:600;">${esc(l.level)}</span> <span style="color:var(--muted)">${esc(l.logger)}:</span> ${esc(l.message)}</div>`;
        }).join("") : `<span style="color:var(--muted)">${esc(t("log_empty"))}</span>`;
      }catch(e){ box.innerHTML = `<span style="color:var(--warn)">${esc(t("log_fail"))} ${esc(e.message)}</span>`; }
    };
    document.getElementById("logLevel").onchange = renderLogs;
    document.getElementById("logRefresh").onclick = renderLogs;
    renderLogs();

    document.getElementById("createUserBtn").onclick = () => {
      openModal(`<h3>${esc(t("adm_create_user"))}</h3>
        <div class="field"><label>${esc(t("li_username"))}</label><input type="text" id="nu_name" autocomplete="off"></div>
        <div class="field"><label>${esc(t("li_password"))} <span class="hint">${esc(t("li_min8"))}</span></label><input type="password" id="nu_pass" autocomplete="new-password"></div>
        <label class="switch" style="margin-bottom:14px;"><input type="checkbox" id="nu_admin"> ${esc(t("adm_grant"))}</label>
        <div class="modal-foot"><button class="btn" id="nu_cancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="nu_save">${esc(t("adm_create"))}</button></div>`);
      document.getElementById("nu_cancel").onclick = closeModal;
      document.getElementById("nu_save").onclick = async () => {
        const username = document.getElementById("nu_name").value.trim();
        const password = document.getElementById("nu_pass").value;
        const is_admin = document.getElementById("nu_admin").checked;
        if(!username||!password){ toast("Username and password required."); return; }
        if(password.length<8){ toast("Password must be at least 8 characters."); return; }
        try{ await api("/api/admin/users", j("POST",{username,password,is_admin})); closeModal(); toast("User created."); render(); }
        catch(e){ toast("Failed: "+e.message); }
      };
    };

    document.getElementById("purgeBtn").onclick = () => {
      openModal(`<h3>${esc(t("adm_purge"))}</h3>
        <p style="color:var(--sec);font-size:14px;line-height:1.6;">${esc(t("adm_purge_p"))}</p>
        <div class="field"><label>${esc(t("adm_type_delete"))}</label><input type="text" id="purge_confirm" placeholder="DELETE" autocomplete="off"></div>
        <div class="modal-foot"><button class="btn" id="purge_cancel">${esc(t("btn_cancel"))}</button><button class="btn danger" id="purge_go">${esc(t("adm_purge_go"))}</button></div>`);
      document.getElementById("purge_cancel").onclick = closeModal;
      document.getElementById("purge_go").onclick = async () => {
        if(document.getElementById("purge_confirm")?.value!=="DELETE"){ toast("Type DELETE to confirm."); return; }
        try{ await api("/api/admin/purge",{method:"POST"}); closeModal(); toast("All content purged."); render(); }
        catch(e){ toast("Purge failed: "+e.message); }
      };
    };

    main.querySelectorAll("[data-approve]").forEach(b=>b.onclick=async()=>{
      const u=allUsers.find(x=>x.id===b.dataset.approve);
      try{ await api("/api/admin/users/"+b.dataset.approve+"/approve",{method:"POST"}); toast(`${u?.username} approved.`); render(); }
      catch(e){ toast("Failed: "+e.message); }
    });
    main.querySelectorAll("[data-deny]").forEach(b=>b.onclick=async()=>{
      const u=allUsers.find(x=>x.id===b.dataset.deny);
      if(!(await confirmAction(b, `Deny and delete "${u?.username}"?`))) return;
      try{ await api("/api/admin/users/"+b.dataset.deny+"/deny",{method:"POST"}); toast(`${u?.username} denied.`); render(); }
      catch(e){ toast("Failed: "+e.message); }
    });
    main.querySelectorAll("[data-delusr]").forEach(b=>b.onclick=async()=>{
      const u=allUsers.find(x=>x.id===b.dataset.delusr);
      if(!(await confirmAction(b, `Delete user "${u?.username}"? This cannot be undone.`))) return;
      try{ await api("/api/admin/users/"+b.dataset.delusr,{method:"DELETE"}); toast("User deleted."); render(); }
      catch(e){ toast("Failed: "+e.message); }
    });
    main.querySelectorAll("[data-resetpw]").forEach(b=>b.onclick=async()=>{
      const u=allUsers.find(x=>x.id===b.dataset.resetpw);
      const pw=prompt(`New password for "${u?.username}" (min 8 chars):`);
      if(!pw) return;
      if(pw.length<8){ toast("Password must be at least 8 characters."); return; }
      try{ await api("/api/admin/users/"+b.dataset.resetpw+"/password", j("PUT",{username:u?.username||"_",password:pw})); toast("Password updated."); }
      catch(e){ toast("Failed: "+e.message); }
    });
    main.querySelectorAll("[data-role]").forEach(b=>b.onclick=async()=>{
      const uid=b.dataset.role, toAdmin=b.dataset.toadmin==="true";
      const u=allUsers.find(x=>x.id===uid);
      try{ await api("/api/admin/users/"+uid+"/role", j("PUT",{username:u?.username||"_",password:"_",is_admin:toAdmin})); render(); }
      catch(e){ toast("Failed: "+e.message); }
    });
  };
  render();
}

/* ============================ DOSSIER ============================ */
async function viewDossier(main, cid, activeCat="__all"){
  const c=await api("/api/characters/"+cid);
  const [sessions, lore, dossUserName]=await Promise.all([
    api("/api/sessions?limit=200&char_id="+encodeURIComponent(cid)),
    api("/api/characters/"+cid+"/lore"),
    getDefaultPersonaName(),
  ]);
  const dossDescription = substMacros(c.description, c.name, dossUserName);
  const heroImg = mediaURL((c.assets||{}).banner||"") || mediaURL((c.assets&&c.assets.stage&&c.assets.stage.default)||"") || mediaURL(c.avatar);
  const hasCustom = (c.presentation_html||"").trim().length>0;
  const heroHTML = `<div class="doss-hero"${heroImg?` style="background-image:url('${esc(heroImg)}')"`:""}><div class="doss-hero-fade"></div></div>`;
  const canEdit = c.owner_id===ME.id||ME.is_admin;
  const isOwner = c.owner_id===ME.id;
  const greetingCount = (c.greeting?1:0) + (c.alt_greetings||[]).length;
  const messageCount = sessions.reduce((n,s)=>n+(s.message_count||0),0);
  const createdDate = c.created?new Date(c.created*1000).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"}):"";
  const activity = [...sessions].sort((a,b)=>b.updated-a.updated).slice(0,5);
  main.innerHTML=`<div class="wrap wrap-wide">
    ${heroHTML}
    <div class="doss-card">
      <div class="doss-card-ava">${avatar(c)}</div>
      <div class="doss-card-body">
        <div class="call">${esc(callno(c))}</div>
        <div class="doss-card-row">
          <h1>${esc(c.name)}</h1>
          <div class="doss-actions">
            <button class="btn primary" id="startBtn">▷ ${esc(t("doss_start"))}</button>
            <button class="btn" id="previewBtn">◎ ${esc(t("doss_preview"))}</button>
            <button class="btn" id="shareBtn">⤴ ${esc(t("doss_share"))}</button>
            ${isOwner?`<a class="btn" href="#/edit/${c.id}">✎ ${esc(t("doss_edit"))}</a>`:''}
            ${(isOwner||c.allow_download)?`<div class="dd" id="exportDD">
              <button class="btn" id="exportBtn">⤓ ${esc(t("doss_export"))} ▾</button>
              <div class="dd-menu">
                <a href="${API}/api/characters/${c.id}/export?spec=v2">${esc(t("doss_export_v2"))}</a>
                <a href="${API}/api/characters/${c.id}/export?spec=v3">${esc(t("doss_export_v3"))}</a>
              </div>
            </div>`:''}
            ${canEdit?`<button class="btn danger" id="delBtn">${esc(t("doss_delete"))}</button>`:''}
          </div>
        </div>
        <div class="meta"><span class="tag mode-tag" style="${c.mode==='rpg'?'background:var(--accent-soft);color:var(--accent-deep);border-color:transparent;':''}">${esc(c.mode==='rpg'?t("badge_rpg"):t("badge_character"))}</span><span class="tag-group">${(c.tags||[]).map(tg=>`<span class="tag" data-tag="${esc(tg)}">${esc(tg)}</span>`).join("")}</span></div>
        <div class="doss-stats">
          <span class="doss-stat">▣ <b>${lore.length}</b> ${esc(t("doss_stat_lore"))}</span>
          <span class="doss-stat">✉ <b>${messageCount}</b> ${esc(t("doss_stat_messages"))}</span>
          <span class="doss-stat">◈ <b>${greetingCount}</b> ${esc(t("doss_stat_greetings"))}</span>
          <span class="doss-stat">◷ <b>${sessions.length}</b> ${esc(t("doss_stat_chats"))}</span>
        </div>
        ${createdDate?`<div class="doss-created">${esc(t("doss_created"))} ${esc(createdDate)}</div>`:""}
        ${c.description?`<div class="doss-desc clamped" id="dossDescBrief">${esc(dossDescription)}</div><button class="doss-desc-toggle" id="dossDescToggle">${esc(t("doss_expand"))} ▾</button>`:""}
      </div>
    </div>
    ${(()=>{
      const loreCardHTML = `<div class="lore-card">
          <div class="lore-card-head">
            <span>${esc(t("doss_lore_card_title"))}</span>
            ${isOwner?`<a href="#" id="loreAddBtn" class="lore-add-top">+ ${esc(t("btn_add_entry"))}</a>`:""}
          </div>
          ${lore.length?`<div class="lore-cat-tabs" id="loreCatTabs">
            <button class="lore-cat-tab${activeCat==="__all"?" on":""}" data-cat="__all">${esc(t("doss_lore_all"))}</button>
            ${[...new Set(lore.map(l=>l.category||""))].filter(Boolean).map(cat=>
              `<button class="lore-cat-tab${activeCat===cat?" on":""}" data-cat="${esc(cat)}">${esc(cat)}</button>`
            ).join("")}
            ${lore.some(l=>!l.category)?`<button class="lore-cat-tab${activeCat==="__untagged"?" on":""}" data-cat="__untagged">${esc(t("doss_lore_untagged"))}</button>`:""}
          </div>`:""}
          ${lore.length?lore.map(l=>{
            const rowCat=l.category||"";
            return `<div class="lore-link-row" data-lore="${esc(l.id)}" data-cat="${esc(rowCat)}">
            ${l.image?`<div class="lore-link-ava"><img class="ava" src="${esc(mediaURL(l.image))}" alt=""></div>`:""}
            <div class="lore-link-info">
              <div class="t" data-lorename="${esc(l.id)}">${esc(l.name||(l.keys&&l.keys[0])||l.category||t("doss_lore_untitled"))}</div>
              <div class="s">${esc(l.category||(l.global?t("doss_lore_global"):t("doss_lore_group")))}</div>
            </div>
          </div>`;
          }).join(""):`<div class="empty"><div class="big">${esc(t("doss_lore_empty"))}</div></div>`}
          ${lore.length?`<div class="lore-pager" id="lorePager"></div>`:""}
        </div>`;
      if(hasCustom){
        return `<div class="doss-layout">
          <div class="doss-main">
            <div class="doss-presentation" id="dossPresentation"></div>
          </div>
          <div class="doss-sidebar">${loreCardHTML}</div>
        </div>`;
      }
      return loreCardHTML ? `<div class="section">${loreCardHTML}</div>` : "";
    })()}
  </div>`;

  if(hasCustom) mountSandboxedHTML($("#dossPresentation"), c.presentation_html);

  localizeContent([
    {el:main.querySelector(".doss-card-row h1"), text:c.name},
    {el:$("#dossDescBrief"), text:c.description},
    ...[...main.querySelectorAll(".doss-card [data-tag]")].map(el=>({el, text:el.dataset.tag})),
    ...[...main.querySelectorAll("[data-lorename]")].map(el=>({el, text:el.textContent})),
  ]).then(()=>{
    const el=$("#dossDescBrief");
    if(el) el.textContent = substMacros(el.textContent, c.name, dossUserName);
  });

  $("#startBtn").onclick=()=>startChat(cid, c.name);
  $("#previewBtn").onclick=()=>previewGreetingsModal(c);
  $("#shareBtn").onclick=()=>{
    const shareUrl=`${location.origin}/c/${cid}`;
    navigator.clipboard?.writeText(shareUrl).then(()=>toast(t("doss_share_copied"))).catch(()=>{});
  };
  const exportDD=$("#exportDD");
  if(exportDD){
    $("#exportBtn").onclick=(ev)=>{ ev.stopPropagation(); const wasOpen=exportDD.classList.contains("open"); closeAllDropdowns(); exportDD.classList.toggle("open", !wasOpen); };
    document.addEventListener("click", ()=>exportDD.classList.remove("open"));
  }
  if(c.owner_id===ME.id||ME.is_admin){
    $("#delBtn").onclick=async()=>{ if(!(await confirmAction($("#delBtn"), "Delete "+c.name+" and all its chats, lore, and memories?")))return;
      await api("/api/characters/"+cid,{method:"DELETE"}); toast("Deleted."); location.hash="#/"; };
  }
  const descToggle=$("#dossDescToggle"), descBrief=$("#dossDescBrief");
  if(descToggle) descToggle.onclick=()=>{
    const collapsed=descBrief.classList.toggle("clamped");
    descToggle.textContent = collapsed ? `${t("doss_expand")} ▾` : `${t("doss_collapse")} ▴`;
  };
  const LORE_PAGE_SIZE=10;
  let lorePage=1;
  const applyLoreView=()=>{
    const cat=main.querySelector(".lore-cat-tab.on")?.dataset.cat||"__all";
    const rows=[...main.querySelectorAll(".lore-link-row")];
    const matches=rows.filter(row=>{
      const rc=row.dataset.cat;
      return cat==="__all" || (cat==="__untagged" ? !rc : rc===cat);
    });
    const totalPages=Math.max(1,Math.ceil(matches.length/LORE_PAGE_SIZE));
    if(lorePage>totalPages) lorePage=totalPages;
    const start=(lorePage-1)*LORE_PAGE_SIZE;
    rows.forEach(row=>row.style.display="none");
    matches.slice(start,start+LORE_PAGE_SIZE).forEach(row=>row.style.display="");
    const pager=$("#lorePager");
    if(!pager) return;
    pager.innerHTML = totalPages>1 ? `<button class="btn" id="lorePrev"${lorePage<=1?" disabled":""}>‹</button><span>${esc(t("doss_lore_page"))} ${lorePage} / ${totalPages}</span><button class="btn" id="loreNext"${lorePage>=totalPages?" disabled":""}>›</button>` : "";
    if($("#lorePrev")) $("#lorePrev").onclick=()=>{ lorePage--; applyLoreView(); };
    if($("#loreNext")) $("#loreNext").onclick=()=>{ lorePage++; applyLoreView(); };
  };
  applyLoreView();
  main.querySelectorAll(".lore-cat-tab").forEach(tab=>tab.onclick=()=>{
    main.querySelectorAll(".lore-cat-tab").forEach(x=>x.classList.remove("on"));
    tab.classList.add("on");
    lorePage=1;
    applyLoreView();
  });
  const curCat=()=>main.querySelector(".lore-cat-tab.on")?.dataset.cat||"__all";
  main.querySelectorAll("[data-lore]").forEach(row=>row.onclick=async()=>{
    const all=await api("/api/characters/"+cid+"/lore");
    loreEntryModal(cid, all.find(x=>x.id===row.dataset.lore), isOwner, ()=>viewDossier(main,cid,curCat()));
  });
  const addBtn=$("#loreAddBtn");
  if(addBtn) addBtn.onclick=(ev)=>{ ev.preventDefault(); loreModal(cid, null, ()=>viewDossier(main,cid,curCat())); };
}

async function startChat(cid, cname){
  const [personas, pool]=await Promise.all([api("/api/personas"), api("/api/characters/persona-pool")]);
  const chars=pool.filter(pc=>pc.id!==cid);
  const begin=async(pid)=>{ const s=await api(`/api/characters/${cid}/sessions`, j("POST",{persona_id:pid||null})); invalidateRecent(); location.hash="#/chat/"+s.id; };
  if(!personas.length && !chars.length){ return begin(null); }
  openModal(`<h3>${esc(t("play_as"))}</h3><div id="pp">
    <div class="session-row" data-pid=""><div><div class="t">${esc(t("just_you"))}</div><div class="p">${esc(t("no_persona"))}</div></div></div>
    ${personas.map(p=>`<div class="session-row" data-pid="${p.id}"><div><div class="t">${esc(p.name)}${p.is_default?" · default":""}</div><div class="p">${esc((p.description||"").slice(0,72))}</div></div></div>`).join("")}
  </div>
  ${chars.length?`<div class="hint" style="margin:14px 0 8px;">${esc(t("play_as_character"))}</div><div id="ppChars">
    ${chars.map(pc=>`<div class="session-row" data-char="${pc.id}"><div><div class="t">${esc(pc.name)}</div><div class="p">${esc(logline(pc))}</div></div></div>`).join("")}
  </div>`:""}`);
  document.querySelectorAll("#pp .session-row").forEach(r=>r.onclick=()=>{ closeModal(); begin(r.dataset.pid); });
  document.querySelectorAll("#ppChars .session-row").forEach(r=>r.onclick=async()=>{
    closeModal();
    const p=await api(`/api/characters/${r.dataset.char}/persona`,{method:"POST"});
    begin(p.id);
  });
}

/* ============================ CHAT ============================ */
const ChatState={
  _s:null,
  set(state){ this.clear(); this._s=state; return state; },
  current(){ return this._s; },
  isActive(sid){ return !!this._s && this._s.sid===sid; },
  clear(){
    const s=this._s;
    this._s=null;
    if(s && s.abort){ try{ s.abort.abort(); }catch(e){} }
  },
};
async function viewChat(main, sid){
  ChatState.clear();
  const s=await api("/api/sessions/"+sid);
  const c=await api("/api/characters/"+s.char_id);
  const mode=c.mode||"character";
  const cs=ChatState.set({sid, c, mode, user_name: s.user_name || "You", language: s.language||"", authorNote: s.author_note||"", generating:false, abort:null, muted:true});
  const assets=c.assets||{};
  const hasStage = !!(assets.stage||assets.sprites||assets.music);
  const musicBtn = !!assets.music;
  main.innerHTML=`<div class="chat-shell ${hasStage?'has-stage':''}">
    <div class="stage" id="stage">
      <div class="stage-bg" id="stageBg"></div>
      <img class="stage-sprite" id="stageSprite" alt="">
    </div>
    ${hasStage?`<button class="stage-toggle" id="stageToggle" title="${esc(t("title_stage"))}">🖼</button>`:""}
    <audio id="stageAudio" loop></audio>
    <div class="chat-top">
      <a class="btn" href="#/c/${c.id}" style="padding:7px 11px;">←</a>
      ${avatar(c)}
      <div class="who"><a class="n" id="chatCharName" href="#/c/${c.id}">${esc(c.name)}</a><div class="s">${esc(t("chatting_as"))} ${esc(s.user_name||"You")}</div></div>
      <span class="mode-badge ${mode==="rpg"?"rpg":""}">${mode==="rpg"?"RPG":"Character"}</span>
      <div class="chat-top-actions">
        <button class="btn" id="thinkToggle" style="padding:7px 11px;" title="${esc(t("title_think"))}"></button>
      </div>
      <div style="position:relative;flex:none;">
        <button class="btn" id="chatMore" style="padding:7px 11px;" title="${esc(t("title_more"))}">⋯</button>
        <div id="chatMoreMenu" class="chat-more-menu" hidden>
          ${musicBtn?`<button id="musicBtn" class="chat-more-item">🔇 Mute music</button>`:""}
          <button id="memView" class="chat-more-item">◷ ${esc(t("mem_title"))}</button>
          <button id="charStateBtn" class="chat-more-item">👤 ${esc(t("title_char_state"))}</button>
          <button id="langBtn" class="chat-more-item">🌐 ${esc(t("reply_lang"))}</button>
          <button id="glossBtn" class="chat-more-item">📖 ${esc(t("glossary_title"))}</button>
          <button id="noteBtn" class="chat-more-item">📌 ${esc(t("authors_note"))}</button>
          <div class="chat-more-sep"></div>
          <button id="chatExport" class="chat-more-item">⬇ Export chat</button>
          <button id="chatDel" class="chat-more-item danger">🗑 Delete this chat</button>
        </div>
      </div>
    </div>
    <div class="chat-scroll" id="cscroll"><div class="thread" id="thread"></div><button id="scrollFab" title="${esc(t("title_scroll"))}">↓</button></div>
    <div class="composer"><div id="cmdPalette" class="cmd-palette" hidden></div>
    <div style="max-width:720px;margin:0 auto 6px;display:flex;align-items:center;gap:8px;">
      <button id="styleBtn" class="style-btn" title="${esc(t("style_title"))}">✦ ${esc(t("style_word"))}</button>
    </div>
    <div class="inner">
      <textarea id="cin" rows="1" placeholder="${esc(mode==="rpg"?t("ph_rpg"):t("ph_char"))}"></textarea>
      <button class="send" id="csend">↑</button>
    </div></div>
  </div>`;
  renderThread(s.messages);
  // greeting still translating in the background? show explicit progress + poll,
  // so a working setup can't be mistaken for a dead page
  const _greetPending = m => m.length===1 && m[0].role==="assistant" && !m[0].lang;
  if(_greetPending(s.messages)){
    const note=el(`<div class="think" style="margin:14px auto;max-width:720px;"><span class="pulse"></span><span>${esc(t("setting_up"))} <span style="color:var(--muted);font-size:12px;">${esc(t("setting_up_hint"))}</span></span></div>`);
    $("#thread").appendChild(note);
    let tries=0;
    const poll=async()=>{
      if(!ChatState.isActive(sid)) return;
      try{
        const fresh=await api("/api/sessions/"+sid);
        if(!_greetPending(fresh.messages)){ renderThread(fresh.messages); return; }
      }catch(e){}
      if(++tries<40) setTimeout(poll, 3000);
      else note.querySelector("span:last-child").textContent="⚠ still translating — it will appear on your next reload";
    };
    setTimeout(poll, 3000);
  }
  localizeContent([{el:$("#chatCharName"), text:c.name}]);
  applyScene(null);   // default background / sprite / music
  const stEl=$("#stageToggle");
  if(stEl){
    const shell=main.querySelector(".chat-shell");
    const hideKey="stageHidden:"+c.id;
    if(store.get(hideKey,"0")==="1") shell.classList.add("stage-hidden");
    stEl.onclick=()=>{ const hidden=shell.classList.toggle("stage-hidden"); store.set(hideKey, hidden?"1":"0"); };
  }
  const inp=$("#cin"), send=$("#csend");
  const _draftKey="draft:"+sid;
  // Restore draft
  const _draft=store.get(_draftKey,""); if(_draft){ inp.value=_draft; autosize(inp,170); }
  inp.addEventListener("input",()=>{ autosize(inp,170); updatePalette(inp.value); store.set(_draftKey, inp.value); });
  inp.addEventListener("keydown",e=>{
    const pal=$("#cmdPalette");
    if(pal&&!pal.hidden){
      if(e.key==="ArrowDown"){e.preventDefault();palNav(1);return;}
      if(e.key==="ArrowUp"){e.preventDefault();palNav(-1);return;}
      if(e.key==="Tab"){e.preventDefault();commitPalette();return;}
      if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();commitPalette();return;}
      if(e.key==="Escape"){hidePalette();return;}
    }
    if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();doSend();}
  });
  send.onclick=()=> cs.generating ? stopGen() : doSend();
  $("#memView").onclick=()=>openMemory(sid);
  $("#charStateBtn").onclick=()=>openCharState(sid, c.name);
  $("#chatExport").onclick=async()=>{ try{ const fresh=await api("/api/sessions/"+sid); exportChat(c,fresh); }catch(e){ toast("Export failed."); }};
  // Reply language
  const langBtn=$("#langBtn");
  const _updateLangBtn=()=>{ langBtn.classList.toggle("active", !!cs.language); langBtn.title=cs.language?`Reply language: ${cs.language}`:"Reply language"; };
  _updateLangBtn();
  langBtn.onclick=()=>openLanguageModal(sid, cs.language, lang=>{ cs.language=lang; _updateLangBtn(); });
  let _glossary={}; try{ _glossary=JSON.parse(s.glossary||"{}"); }catch(e){}
  const glossBtn=$("#glossBtn");
  const _updateGlossBtn=()=>glossBtn.classList.toggle("active", Object.keys(_glossary).length>0);
  _updateGlossBtn();
  glossBtn.onclick=()=>openGlossaryModal(sid, _glossary, gl=>{ _glossary=gl; _updateGlossBtn(); });
  // Author's Note (pinned reminder, re-sent on every turn)
  const noteBtn=$("#noteBtn");
  const _updateNoteBtn=()=>{ noteBtn.classList.toggle("active", !!cs.authorNote); };
  _updateNoteBtn();
  noteBtn.onclick=()=>openAuthorNoteModal(sid, cs.authorNote, note=>{ cs.authorNote=note; _updateNoteBtn(); });
  // Response style
  let _styleKey=s.style_key||"unspecified", _stylePrompt=s.style_prompt||"";
  function _updateStyleBtn(){
    const btn=$("#styleBtn"); if(!btn) return;
    const custom=_customStyles().find(x=>x.key===_styleKey);
    const found=custom||STYLES.find(x=>x.key===_styleKey);
    const label=custom?found.label:(found?t("style_"+found.key):t("style_word"));
    const active=_styleKey!=="unspecified";
    btn.innerHTML=`✦ ${esc(label)}`;
    btn.classList.toggle("active", active);
  }
  _updateStyleBtn();
  $("#styleBtn").onclick=()=>openStylePicker(sid, _styleKey, _stylePrompt, (key,prompt,label)=>{
    _styleKey=key; _stylePrompt=prompt; _updateStyleBtn();
    api(`/api/sessions/${sid}/style`,j("PUT",{key,prompt:prompt||null})).catch(()=>{});
  });
  // ⋯ more menu
  $("#chatMore").onclick=e=>{ e.stopPropagation(); const m=$("#chatMoreMenu"); const wasHidden=m.hidden; closeAllDropdowns(); m.hidden=!wasHidden; };
  document.addEventListener("click",()=>{ const m=$("#chatMoreMenu"); if(m) m.hidden=true; });
  $("#chatDel").onclick=async()=>{
    if(!(await confirmAction($("#chatDel"), "Delete this chat permanently?"))) return;
    try{ await api(`/api/sessions/${sid}`,{method:"DELETE"}); invalidateRecent(); location.hash="#/"; }catch(e){ toast("Delete failed."); }
  };
  // Scroll-to-bottom FAB
  const fab=$("#scrollFab"), sc=$("#cscroll");
  sc.addEventListener("scroll",()=>{ fab.classList.toggle("vis", sc.scrollHeight-sc.scrollTop-sc.clientHeight>200); });
  fab.onclick=()=>scrollDown(true);
  const mb=$("#musicBtn");
  if(mb) mb.onclick=()=>{ const au=$("#stageAudio"); cs.muted=!cs.muted; au.muted=cs.muted;
    mb.textContent=(cs.muted?"🔇":"🔊")+" "+(cs.muted?"Unmute music":"Mute music"); if(!cs.muted){ au.play().catch(()=>{}); } };
  const tt=$("#thinkToggle");
  const paintThink=()=>{ tt.textContent="🧠 "+t("think_word")+" "+(THINK?t("on_word"):t("off_word")); tt.style.color=THINK?"var(--accent)":"var(--muted)"; tt.style.borderColor=THINK?"var(--accent)":"var(--line-2)"; };
  tt.onclick=()=>{ THINK=!THINK; store.set("think",THINK?"1":"0"); paintThink(); toast("Thinking "+(THINK?"on":"off")); };
  paintThink();
  setTimeout(()=>{ scrollDown(true); inp.focus(); },50);
}

function pick(section, mood){
  // section = assets.stage / .music / .sprites ; returns mood url or default
  if(!section) return "";
  const m=(section.moods||{});
  if(mood && m[mood]) return m[mood];
  return section.default || "";
}
function applyScene(mood){
  const cs=ChatState.current(); const c=cs&&cs.c; if(!c) return;
  const a=c.assets||{};
  const bgEl=$("#stageBg"), spEl=$("#stageSprite"), au=$("#stageAudio");
  if(bgEl){ const url=pick(a.stage, mood); if(url){ bgEl.style.backgroundImage=`url("${url}")`; bgEl.classList.add("on"); } else { bgEl.classList.remove("on"); } }
  if(spEl){ const url=pick(a.sprites, mood); if(url){ spEl.src=url; spEl.classList.add("on"); } else { spEl.classList.remove("on"); spEl.removeAttribute("src"); } }
  if(au){ const url=pick(a.music, mood); if(url){ if(au.dataset.src!==url){ au.dataset.src=url; au.src=url; } au.muted=cs.muted; if(!cs.muted){ au.play().catch(()=>{}); } } }
}

function exportChat(c, s){
  const lines=[`# ${c.name}`,`Session: ${s.title||s.id}`,`Exported: ${new Date().toLocaleString()}`,"",...s.messages.map(m=>{
    const {body}=splitThink(m.content||"");
    const who=m.role==="assistant"?c.name:(s.user_name||"You");
    return `**${who}**\n${body}\n`;
  })];
  const blob=new Blob([lines.join("\n")],{type:"text/markdown"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download=`${c.name.replace(/[^a-z0-9]+/gi,"-")}-${s.id.slice(0,8)}.md`;
  a.click(); URL.revokeObjectURL(a.href);
}

async function openCharState(sid, charName){
  openModal(`<h3>${esc(charName)} — ${esc(t("right_now"))}</h3><div id="csBody" style="color:var(--muted)">${esc(t("loading"))}</div>`);
  const foot=`<div class="modal-foot"><button class="btn" id="csClose">Close</button></div>`;
  try{
    const st=await api(`/api/sessions/${sid}/state`);
    const rows=[];
    if(st.doing) rows.push(`<div class="section" style="margin:0 0 16px;"><h4>${esc(t("cs_doing"))}</h4><div class="prose-block" style="font-size:14.5px;">${esc(st.doing)}</div></div>`);
    if(st.location) rows.push(`<div class="section" style="margin:0 0 16px;"><h4>${esc(t("cs_location"))}</h4><div class="prose-block" style="font-size:14.5px;">${esc(st.location)}</div></div>`);
    if(st.known_names&&st.known_names.length) rows.push(`<div class="section" style="margin:0;"><h4>${esc(t("cs_established"))} (${st.known_names.length})</h4><div class="meta">${st.known_names.map(n=>`<span class="tag">${esc(n)}</span>`).join("")}</div></div>`);
    $("#csBody").innerHTML = rows.length
      ? rows.join("")+foot
      : `<div style="color:var(--muted);padding:6px 0 16px;">${esc(t("cs_nothing"))}</div>`+foot;
  }catch(e){
    $("#csBody").innerHTML = `<div style="color:var(--warn);padding:6px 0 16px;">Couldn't load character state: ${esc(e.message)}</div>`+foot;
  }
  const close=$("#csClose"); if(close) close.onclick=closeModal;
}
async function openMemory(sid){
  openModal(`<h3>${esc(t("mem_title"))}</h3><div id="memBody" style="color:var(--muted)">${esc(t("loading"))}</div>`);
  const render=async()=>{
    const mem=await api(`/api/sessions/${sid}/memory?k=50`);
    if(mem.length){
      $("#memBody").innerHTML=
        `<div style="margin-bottom:12px;color:var(--sec);font-size:13.5px;">${mem.length} ${esc(t("mem_intro"))}</div>`
        +mem.map(m=>`<div class="lore-entry mem-entry" data-mid="${esc(m.id)}"><div class="c">${esc(m.text)}</div><button class="tool danger mem-del" title="${esc(t("del_memory"))}">✕</button></div>`).join("")
        +`<div class="modal-foot"><button class="btn danger" id="clearMem">${esc(t("clear_all"))}</button><button class="btn" id="memClose">${esc(t("btn_close"))}</button></div>`;
      $("#memBody").querySelectorAll(".mem-del").forEach(b=>b.onclick=async()=>{
        const mid=b.closest(".mem-entry").dataset.mid;
        await api(`/api/sessions/${sid}/memory/${mid}`,{method:"DELETE"});
        b.closest(".mem-entry").remove();
        const rem=$("#memBody").querySelectorAll(".mem-entry").length;
        if(!rem) render();
      });
    } else {
      $("#memBody").innerHTML=`<div style="color:var(--muted);padding:6px 0 16px;">${esc(t("no_memories"))}</div><div class="modal-foot"><button class="btn" id="memClose">Close</button></div>`;
    }
    const close=$("#memClose"); if(close) close.onclick=closeModal;
    const cm=$("#clearMem"); if(cm) cm.onclick=async()=>{ if(!(await confirmAction(cm, "Clear memory for this chat? Other chats are unaffected.")))return;
      await api(`/api/sessions/${sid}/memory`,{method:"DELETE"}); toast("Memory cleared."); render(); };
  };
  render();
}
// ── Response Styles ──────────────────────────────────────────────────────────
const STYLES=[
  { key:"unspecified", emoji:"☰",  grad:"linear-gradient(150deg,#4a4462,#26223a)",  label:"Unspecified",
    desc:"Creator's intended voice / system default", prompt:"" },
  { key:"roleplay",    emoji:"🎮", grad:"linear-gradient(150deg,#6c56e0,#3a2f8f)",  label:"Roleplay",
    desc:"Narrative-driven and immersive storytelling",
    prompt:"Write in a rich, immersive narrative style. Use vivid prose descriptions, advance the scene organically, and maintain deep character voice throughout." },
  { key:"lust",        emoji:"😍", grad:"linear-gradient(150deg,#dd4e8c,#8a2f5e)",  label:"Lust",
    desc:"Flirtatious, suggestive, and NSFW",
    prompt:"Respond in an explicit, sensual, NSFW manner. Be bold about physical desire, use evocative sensory language, and don't shy away from graphic detail." },
  { key:"romance",     emoji:"❤️", grad:"linear-gradient(150deg,#d1546a,#7a2334)",  label:"Romance",
    desc:"Warm, intimate, and affectionate",
    prompt:"Respond with tenderness, emotional warmth, and romantic intimacy. Focus on feelings, connection, vulnerability, and the small moments between characters." },
  { key:"casual",      emoji:"🤙", grad:"linear-gradient(150deg,#d6a53f,#8f6a2f)",  label:"Casual",
    desc:"Short, relaxed, and straight to the point",
    prompt:"Keep responses short and casual. Skip flowery prose — just natural, snappy dialogue and minimal action beats." },
];
const CUSTOM_GRADS=["linear-gradient(150deg,#9b72e8,#5e3fa6)","linear-gradient(150deg,#e3bd6c,#a8791c)","linear-gradient(150deg,#6c9be0,#2f5e8f)","linear-gradient(150deg,#5ec9a8,#2f7a5e)"];

function _customStyles(){ try{ return JSON.parse(localStorage.getItem("personae_styles")||"[]"); }catch{ return []; } }
function _saveCustomStyles(arr){ localStorage.setItem("personae_styles", JSON.stringify(arr)); }

const COMMON_LANGUAGES=["Spanish","French","German","Japanese","Korean","Portuguese","Italian","Russian","Mandarin Chinese","Arabic"];
function openLanguageModal(sid, current, onApply){
  openModal(`<h3>${esc(t("reply_lang"))}</h3>
    <p style="margin:0 0 16px;font-size:13px;color:var(--muted);">${esc(t("lang_p"))}</p>
    <div class="field"><label>${esc(t("lang_label"))}</label><input type="text" id="lang_input" value="${esc(current||"")}" placeholder="${esc(t("lang_ph"))}"></div>
    <div class="macro-row" style="flex-wrap:wrap;margin:-8px 0 18px;">
      ${COMMON_LANGUAGES.map(l=>`<button type="button" class="chip" data-lang="${esc(l)}">${esc(l)}</button>`).join("")}
    </div>
    <div class="modal-foot">
      <button class="btn" id="lang_clear">${esc(t("btn_clear"))}</button>
      <button class="btn" id="lang_cancel">${esc(t("btn_cancel"))}</button>
      <button class="btn primary" id="lang_save">${esc(t("btn_save"))}</button>
    </div>`);
  const inp=$("#lang_input");
  document.querySelectorAll("[data-lang]").forEach(b=>b.onclick=()=>{ inp.value=b.dataset.lang; inp.focus(); });
  $("#lang_cancel").onclick=closeModal;
  const apply=async(lang)=>{
    try{
      await api(`/api/sessions/${sid}/language`, j("PUT",{language:lang||null}));
      closeModal();
      location.reload(); return;
    }catch(e){ toast("Failed: "+e.message); }
  };
  $("#lang_clear").onclick=()=>apply("");
  $("#lang_save").onclick=()=>apply(inp.value.trim());
}
function openGlossaryModal(sid, current, onApply){
  const rowHTML=(k="",v="")=>`<div class="gl-row" style="display:flex;gap:8px;margin-bottom:8px;">
    <input class="gl-k" placeholder="${esc(t("glossary_term"))}" value="${esc(k)}" style="flex:1">
    <input class="gl-v" placeholder="${esc(t("glossary_rendering"))}" value="${esc(v)}" style="flex:1">
    <button type="button" class="tool danger gl-x">✕</button></div>`;
  const entries=Object.entries(current||{});
  openModal(`<h3>📖 ${esc(t("glossary_title"))}</h3>
    <p style="margin:0 0 16px;font-size:13px;color:var(--muted);">${esc(t("glossary_sub"))}</p>
    <div id="glRows">${entries.length?entries.map(([k,v])=>rowHTML(k,v)).join(""):rowHTML()}</div>
    <button type="button" class="btn" id="gl_add" style="margin-bottom:16px;">+ ${esc(t("glossary_add"))}</button>
    <div class="modal-foot">
      <button class="btn" id="gl_cancel">${esc(t("btn_cancel"))}</button>
      <button class="btn primary" id="gl_save">${esc(t("btn_save"))}</button>
    </div>`);
  const rows=$("#glRows");
  rows.addEventListener("click",e=>{ const x=e.target.closest(".gl-x"); if(x) x.closest(".gl-row").remove(); });
  $("#gl_add").onclick=()=>{ rows.insertAdjacentHTML("beforeend", rowHTML()); rows.lastElementChild.querySelector(".gl-k").focus(); };
  $("#gl_cancel").onclick=closeModal;
  $("#gl_save").onclick=async()=>{
    const gl={};
    rows.querySelectorAll(".gl-row").forEach(r=>{
      const k=r.querySelector(".gl-k").value.trim(), v=r.querySelector(".gl-v").value.trim();
      if(k&&v) gl[k]=v;
    });
    try{
      await api(`/api/sessions/${sid}/glossary`, j("PUT",{glossary:gl}));
      closeModal();
      location.reload(); return;
    }catch(e){ toast("Failed: "+e.message); }
  };
}
function openAuthorNoteModal(sid, current, onApply){
  openModal(`<h3>${esc(t("authors_note"))}</h3>
    <p style="margin:0 0 16px;font-size:13px;color:var(--muted);">${esc(t("note_p"))}</p>
    <div class="field"><label>${esc(t("note_label"))}</label><textarea id="note_input" rows="5" placeholder="${esc(t("note_ph"))}">${esc(current||"")}</textarea></div>
    <div class="modal-foot">
      <button class="btn" id="note_clear">${esc(t("btn_clear"))}</button>
      <button class="btn" id="note_cancel">${esc(t("btn_cancel"))}</button>
      <button class="btn primary" id="note_save">${esc(t("btn_save"))}</button>
    </div>`);
  const inp=$("#note_input");
  $("#note_cancel").onclick=closeModal;
  const apply=async(note)=>{
    try{
      await api(`/api/sessions/${sid}/note`, j("PUT",{note:note||null}));
      onApply(note); closeModal();
      toast(note?"Author's Note pinned.":"Author's Note cleared.");
    }catch(e){ toast("Failed: "+e.message); }
  };
  $("#note_clear").onclick=()=>apply("");
  $("#note_save").onclick=()=>apply(inp.value.trim());
}
function openStylePicker(sid, currentKey, currentPrompt, onApply){
  function cardHTML(item, isCustom, activeKey){
    const key=item.key, emoji=isCustom?(item.emoji||"✏️"):item.emoji;
    const label=isCustom?esc(item.label):esc(t("style_"+item.key)), desc=isCustom?esc(item.desc||""):esc(t("style_"+item.key+"_desc"));
    const grad=isCustom?CUSTOM_GRADS[Math.abs([...key].reduce((h,c)=>h+c.charCodeAt(0),0))%CUSTOM_GRADS.length]:item.grad;
    const active=activeKey===key;
    const prompt=item.prompt||"";
    return `
      <div class="style-card${active?" active":""}" data-skey="${key}" ${isCustom?'data-custom="1"':""} style="background:${grad}">
        ${active?'<span class="sc-check">✓</span>':''}
        ${isCustom?`<button class="sc-edit" title="${esc(t("tool_edit"))}" onclick="event.stopPropagation();_editCustomStyle('${key}')">✏</button>
          <button class="sc-del" title="${esc(t("tool_delete"))}" onclick="event.stopPropagation();_deleteCustomStyle('${key}')">✕</button>`:''}
        <div class="sc-icon">${emoji}</div>
        <div class="sc-name">${label}</div>
        <div class="sc-desc">${desc}</div>
        ${prompt?`
          <button class="sc-info" title="${esc(t("title_see_instr"))}" onclick="event.stopPropagation();this.closest('.style-card').classList.toggle('flipped')">ⓘ</button>
          <div class="sc-back" onclick="event.stopPropagation()">
            <button class="sc-back-close" onclick="this.closest('.style-card').classList.remove('flipped')">×</button>
            <span class="sc-back-label">${esc(t("style_sent"))}</span>
            <div class="sc-back-text">${esc(prompt)}</div>
          </div>`:''}
      </div>`;
  }
  function render(){
    const custom=_customStyles();
    const activeKey=currentKey||"unspecified";
    openModal(`
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:14px;">
        <div><h3 style="margin:0 0 4px">${esc(t("style_title"))}</h3><p style="margin:0;font-size:13px;color:var(--muted)">${esc(t("style_sub"))}</p></div>
        <button onclick="closeModal()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted);line-height:1;padding:0">×</button>
      </div>
      <div class="style-grid">
        ${STYLES.map(s=>cardHTML(s,false,activeKey)).join("")}
        ${custom.length?`<div class="style-section-label">${esc(t("style_yours"))}</div>`:""}
        ${custom.map(c=>cardHTML(c,true,activeKey)).join("")}
        <div class="style-card sc-new" data-new="1"><div class="sc-plus">+</div><div class="sc-name">${esc(t("style_create"))}</div></div>
      </div>
    `);
    document.querySelectorAll(".style-card[data-skey]").forEach(card=>{
      card.onclick=()=>{
        const key=card.dataset.skey;
        const isCustom=card.dataset.custom==="1";
        let prompt="", label="Style";
        if(isCustom){
          const c=_customStyles().find(x=>x.key===key);
          if(c){ prompt=c.prompt||""; label=c.label; }
        } else {
          const s=STYLES.find(x=>x.key===key);
          if(s){ prompt=s.prompt; label=s.label; }
        }
        currentKey=key; currentPrompt=prompt;
        onApply(key, prompt, label);
        closeModal();
      };
    });
    const newCard=document.querySelector(".style-card[data-new]");
    if(newCard) newCard.onclick=()=>_editCustomStyle(null);
  }
  window._editCustomStyle=function(key){
    const all=_customStyles();
    const existing=key?all.find(c=>c.key===key):null;
    openModal(`
      <h3>${esc(existing?t("cs_edit"):t("cs_new"))}</h3>
      <div class="field"><label>${esc(t("ed_name"))}</label>
        <input type="text" id="csName" value="${esc(existing?.label||"")}" placeholder="${esc(t("cs_name_ph"))}"></div>
      <div class="field"><label>${esc(t("cs_desc"))} <span class="hint">${esc(t("cs_desc_hint"))}</span></label>
        <input type="text" id="csDesc" value="${esc(existing?.desc||"")}" placeholder="${esc(t("cs_desc_ph"))}"></div>
      <div class="field" style="margin-bottom:20px;"><label>${esc(t("cs_instr"))} <span class="hint">${esc(t("cs_instr_hint"))}</span></label>
        <textarea id="csPrompt" style="min-height:100px">${esc(existing?.prompt||"")}</textarea></div>
      <div class="modal-foot">
        <button class="btn" onclick="_styleBack()">← ${esc(t("btn_back"))}</button>
        <button class="btn primary" onclick="_saveCustomStyleForm('${existing?.key||""}')">${esc(t("btn_save"))}</button>
      </div>
    `);
  };
  window._styleBack=function(){ render(); };
  window._saveCustomStyleForm=function(existingKey){
    const name=$("#csName")?.value.trim();
    const desc=$("#csDesc")?.value.trim();
    const prompt=$("#csPrompt")?.value.trim();
    if(!name){ toast("Name required"); return; }
    const all=_customStyles();
    if(existingKey){
      const idx=all.findIndex(c=>c.key===existingKey);
      if(idx>=0) all[idx]={...all[idx],label:name,desc,prompt};
    } else {
      all.push({key:"custom_"+Date.now(),emoji:"✏️",label:name,desc,prompt});
    }
    _saveCustomStyles(all);
    render();
  };
  window._deleteCustomStyle=async function(key){
    if(!(await confirmAction(null, "Delete this style?"))) return;
    _saveCustomStyles(_customStyles().filter(c=>c.key!==key));
    if(currentKey===key){ currentKey="unspecified"; currentPrompt=""; onApply("unspecified","","Style"); }
    render();
  };
  render();
}

const THREAD_PAGE=40;
function renderThread(messages, from=0){
  const threadEl=$("#thread");
  const start=Math.max(0, messages.length - THREAD_PAGE - from);
  const showing=messages.slice(start);
  const hidden=start; // messages not yet rendered
  threadEl.innerHTML= hidden>0
    ? `<div id="loadMore" style="text-align:center;padding:14px 0 4px"><button class="btn" id="loadMoreBtn">↑ ${Math.min(THREAD_PAGE,hidden)} ${esc(t("load_earlier"))}</button></div>`
    : "";
  const lastAssistant=[...messages].reverse().find(m=>m.role==="assistant");
  let pending=null; // a directive-classified user message, held until the reply it triggered renders
  showing.forEach(m=>{
    if(m.role==="user"){
      const cls=classifyDirective(m.content);
      if(cls){ pending={cls,text:m.content}; return; }
      pending=null;
      threadEl.appendChild(turnEl(m));
      return;
    }
    const d=pending; pending=null;
    threadEl.appendChild(turnEl(m, d, lastAssistant && m.id===lastAssistant.id));
  });
  if(pending) threadEl.appendChild(el(`<div class="turn cmd-standalone">${directiveHTML(pending.cls,pending.text)}</div>`));
  const btn=$("#loadMoreBtn");
  if(btn) btn.onclick=()=>{ const first=threadEl.children[1]; renderThread(messages, from+THREAD_PAGE); first?.scrollIntoView({block:"start"}); };
}
/* commands (/ooc /note /scene /time /as /roll) render as a collapsible note
   attached to the reply they triggered, instead of a full chat bubble */
function classifyDirective(content){
  const s=String(content||"").trim();
  if(/^\(OOC:/i.test(s)) return {icon:"💬",label:t("dir_ooc")};
  if(/^\*\[Scene:/i.test(s)) return {icon:"🎬",label:t("dir_scene")};
  if(/^\*\[Author's Note:/i.test(s)) return {icon:"📝",label:t("dir_note")};
  if(/^\*\[Time skip/i.test(s)) return {icon:"⏭",label:t("dir_time")};
  if(/^\[[^\]]+ says\]:/i.test(s)) return {icon:"🎭",label:t("dir_spoke")};
  if(s.startsWith("🎲")) return {icon:"🎲",label:t("dir_dice")};
  return null;
}
function directiveHTML(cls, text){
  return `<details class="cmd-note"><summary>${cls.icon} ${esc(cls.label)}</summary><div class="cmd-note-body">${md(text)}</div></details>`;
}
function stripMood(text){ return String(text||"").replace(/\[mood:\s*[a-z0-9 _\-]+\]/ig,"").replace(/[ \t]+\n/g,"\n").trim(); }
function splitThink(content){
  const m=String(content||"").match(/<think>([\s\S]*?)<\/think>/);
  const think=m?m[1].trim():null;
  const body=stripMood(String(content||"").replace(/<think>[\s\S]*?<\/think>/,"")).trim();
  return {think, body};
}
const NON_LATIN=/[一-鿿぀-ヿ가-힯Ѐ-ӿ؀-ۿऀ-ॿ]/;
function myLanguage(){
  try{
    const code=(navigator.language||"en").split("-")[0];
    return new Intl.DisplayNames(["en"],{type:"language"}).of(code) || "English";
  }catch(e){ return "English"; }
}

/* ── Slash command palette ── */
const CMDS=[
  {cmd:"/ooc",     args:"<message>",      dk:"cmd_ooc"},
  {cmd:"/note",    args:"<text>",         dk:"cmd_note"},
  {cmd:"/scene",   args:"<description>",  dk:"cmd_scene"},
  {cmd:"/time",    args:"<skip>",         dk:"cmd_time"},
  {cmd:"/as",      args:"<name> <text>",  dk:"cmd_as"},
  {cmd:"/recap",   args:"",               dk:"cmd_recap"},
  {cmd:"/roll",    args:"[dice]",         dk:"cmd_roll"},
  {cmd:"/regen",   args:"",               dk:"cmd_regen"},
  {cmd:"/continue",args:"[direction]",    dk:"cmd_continue"},
  {cmd:"/think",   args:"",               dk:"cmd_think"},
  {cmd:"/memory",  args:"",               dk:"cmd_memory"},
  {cmd:"/search",  args:"<query>",        dk:"cmd_search"},
  {cmd:"/clear",   args:"",               dk:"cmd_clear"},
  {cmd:"/export",  args:"",               dk:"cmd_export"},
  {cmd:"/mood",    args:"<name>",         dk:"cmd_mood"},
  {cmd:"/language",args:"<name>",         dk:"cmd_language"},
  {cmd:"/help",    args:"",               dk:"cmd_help"},
];
function _cmdScore(c,q){
  const name=c.cmd.slice(1), full=(name+" "+c.args+" "+t(c.dk)).toLowerCase(); q=q.toLowerCase();
  if(name===q) return 1000;
  if(name.startsWith(q)) return 800;
  if(name.includes(q)) return 500;
  const words=q.split(/\s+/).filter(Boolean);
  if(words.length&&words.every(w=>full.includes(w))) return 300;
  if(words.some(w=>full.includes(w)||name.startsWith(w))) return 100;
  let i=0,j=0; while(i<q.length&&j<name.length){if(q[i]===name[j])i++;j++;}
  return i===q.length&&q.length>1?40:0;
}
let _palSel=0,_palItems=[];
function updatePalette(val){
  const pal=$("#cmdPalette"); if(!pal) return;
  const first=val.split("\n")[0];
  if(!first.startsWith("/")){pal.hidden=true;return;}
  const after=first.slice(1); // everything after /
  // Hide once the user has typed the command + space (they're now typing args)
  if(/\S+\s/.test(after)){pal.hidden=true;return;}
  _palItems=CMDS.map(c=>({...c,_s:_cmdScore(c,after)})).filter(c=>c._s>0).sort((a,b)=>b._s-a._s);
  if(!_palItems.length){pal.hidden=true;return;}
  _palSel=0;
  pal.innerHTML=_palItems.map((c,i)=>
    `<div class="cmd-item${i===0?" sel":""}" data-i="${i}"><span class="cmd-name">${esc(c.cmd)}</span><span class="cmd-args">${esc(c.args)}</span><span class="cmd-desc">${esc(t(c.dk))}</span></div>`
  ).join("");
  pal.hidden=false;
  pal.querySelectorAll(".cmd-item").forEach(item=>item.onclick=()=>{_palSel=+item.dataset.i;commitPalette();});
}
function palNav(dir){
  const pal=$("#cmdPalette"); if(!pal||pal.hidden||!_palItems.length) return;
  _palSel=(_palSel+dir+_palItems.length)%_palItems.length;
  pal.querySelectorAll(".cmd-item").forEach((el,i)=>el.classList.toggle("sel",i===_palSel));
  pal.querySelectorAll(".cmd-item")[_palSel]?.scrollIntoView({block:"nearest"});
}
function commitPalette(){
  const c=_palItems[_palSel]; if(!c) return;
  hidePalette();
  const inp=$("#cin"); if(!inp) return;
  if(c.args){
    inp.value=c.cmd+" "; inp.focus();
    // trigger auto-resize
    autosize(inp,170);
  } else {
    inp.value=""; inp.style.height="auto";
    _execSlashCmd(c.cmd,"");
  }
}
function hidePalette(){const pal=$("#cmdPalette");if(pal)pal.hidden=true;_palItems=[];}
/* every /command that produces displayable output shares this one collapsible
   card, appended inline in the thread — never a modal, never a full bubble */
function appendCmdNote(icon, label, openByDefault=true){
  const card=el(`<div class="turn cmd-standalone"><details class="cmd-note"${openByDefault?" open":""}><summary>${icon} ${esc(label)}</summary><div class="cmd-note-body">${esc(t("loading"))}</div></details></div>`);
  $("#thread").appendChild(card); scrollDown(true);
  return card.querySelector(".cmd-note-body");
}
function showHelpNote(){
  const body=appendCmdNote("❔",t("note_slash"));
  body.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12.5px;">
    <tbody>${CMDS.map(c=>`<tr><td style="padding:4px 10px 4px 0;font-family:var(--mono);color:var(--accent);white-space:nowrap;vertical-align:top;">${esc(c.cmd)}${c.args?` <span style="color:var(--muted)">${esc(c.args)}</span>`:""}</td><td style="padding:4px 0;color:var(--muted);">${esc(t(c.dk))}</td></tr>`).join("")}</tbody>
  </table>`;
}
async function showMemoryNote(sid){
  const body=appendCmdNote("◷",t("note_memory"));
  try{
    const mem=await api(`/api/sessions/${sid}/memory?k=50`);
    body.innerHTML = mem.length
      ? `<div style="margin-bottom:8px;">${mem.length} ${esc(t("mem_list_head"))}</div><ul style="margin:0;padding-left:18px;">${mem.map(m=>`<li style="margin:3px 0;">${esc(m.text)}</li>`).join("")}</ul>`
      : esc(t("no_memories"));
  }catch(e){ body.innerHTML = `<span style="color:var(--warn)">Couldn't load memory: ${esc(e.message)}</span>`; }
  scrollDown();
}
async function showSearchNote(sid, query){
  const body=appendCmdNote("⌕",t("note_search")+" "+query);
  try{
    const mem=await api(`/api/sessions/${sid}/memory?q=${encodeURIComponent(query)}&k=20`);
    body.innerHTML = mem.length
      ? `<div style="margin-bottom:8px;">${mem.length} ${esc(t("search_results_head"))}</div><ul style="margin:0;padding-left:18px;">${mem.map(m=>`<li style="margin:3px 0;">${esc(m.text)}</li>`).join("")}</ul>`
      : esc(t("no_matches"));
  }catch(e){ body.innerHTML = `<span style="color:var(--warn)">${esc(t("search_failed"))} ${esc(e.message)}</span>`; }
  scrollDown();
}
async function _execSlashCmd(cmd,args){
  const cs=ChatState.current();
  const sid=cs&&cs.sid;
  if(!sid) return;
  switch(cmd){
    case "/think":{
      THINK=!THINK; store.set("think",THINK?"1":"0");
      const tt=$("#thinkToggle");
      if(tt){tt.textContent="🧠 "+t("think_word")+" "+(THINK?t("on_word"):t("off_word"));tt.style.color=THINK?"var(--accent)":"var(--muted)";tt.style.borderColor=THINK?"var(--accent)":"var(--line-2)";}
      toast("Thinking "+(THINK?"on":"off")); break;}
    case "/memory": showMemoryNote(sid); break;
    case "/search": if(args) showSearchNote(sid,args); else showMemoryNote(sid); break;
    case "/export":
      try{const s=await api("/api/sessions/"+sid); exportChat(cs.c,s);}catch(e){toast("Export failed.");} break;
    case "/regen": regen(); break;
    case "/continue": await continueMessage(args); break;
    case "/clear":
      if(!(await confirmAction(null, "Clear all memories from this chat?"))) break;
      try{await api(`/api/sessions/${sid}/memory`,{method:"DELETE"});toast("Memory cleared.");}
      catch(e){toast("Failed: "+e.message);} break;
    case "/recap": showRecap(sid); break;
    case "/mood": if(args)applyScene(args.trim()); break;
    case "/language":{
      const lang=args.trim();
      const body=appendCmdNote("🌐",t("note_language"));
      try{
        await api(`/api/sessions/${sid}/language`, j("PUT",{language:lang||null}));
        cs.language=lang;
        const btn=$("#langBtn");
        if(btn){ btn.classList.toggle("active", !!lang); btn.title=lang?`Reply language: ${lang}`:"Reply language"; }
        body.innerHTML = lang ? `Now replying in <b>${esc(lang)}</b>.` : "Language reset to the default (English).";
      }catch(e){ body.innerHTML = `<span style="color:var(--warn)">Couldn't set language: ${esc(e.message)}</span>`; }
      break;}
    case "/help": showHelpNote(); break;
  }
}
async function showRecap(sid){
  const body=appendCmdNote("📖",t("note_recap"));
  try{
    const r=await api(`/api/sessions/${sid}/summarize`,{method:"POST"});
    body.innerHTML = r.summary ? md(r.summary) : "Nothing to recap yet — the story hasn't started.";
  }catch(e){
    body.innerHTML = `<span style="color:var(--warn)">Couldn't generate a recap: ${esc(e.message)}</span>`;
  }
  scrollDown();
}
function thinkBlock(text, open){
  if(!text) return "";
  const transBtn=NON_LATIN.test(text)?`<button class="think-trans" onclick="translateThinkEl(this)" title="${esc(t("title_translate_to"))} ${esc(myLanguage())}">🌐 ${esc(t("tool_translate"))}</button>`:"";
  return `<details class="think"${open?" open":""}><summary>💭 ${esc(t("thought_process"))}${transBtn}</summary><div class="think-body">${md(text)}</div></details>`;
}
async function translateThinkEl(btn){
  btn.disabled=true; btn.textContent="…";
  const det=btn.closest(".think"), body=det.querySelector(".think-body");
  try{
    const lang=myLanguage();
    const d=await api("/api/translate", j("POST",{text:body.innerText, target:lang, sid:(ChatState.current()||{}).sid}));
    if(d.translated){ body.innerHTML=md(d.translated); btn.textContent="✓"; btn.title=`Translated to ${lang}`; }
    else { btn.disabled=false; btn.textContent="🌐 "+t("tool_translate"); toast("Translation came back empty — try again."); }
  }catch(e){ btn.disabled=false; btn.textContent="🌐 "+t("tool_translate"); }
}
function turnEl(m, directive, isLast){
  const cs = ChatState.current();
  const c = cs.c;
  if(m.role === "assistant"){
    const {think, body} = splitThink(m.content);
    // Only render thinkBlock if THINK is enabled
    const showThink = THINK && think;
    const bodyIsOOC = /^\(OOC:/i.test(body.trim());
    // Regenerate/continue rewrite the trailing turn server-side (db.pop_trailing_assistant),
    // so they only make sense on the newest reply — offering them on older ones would silently
    // discard every message that came after, which looks like data loss to the user.
    const canRegen = isLast!==false;
    const e = el(`<div class="turn ai${bodyIsOOC?" ooc":""}" data-id="${m.id}" data-raw="${esc(m.content||"")}">
      <div class="name">${esc(c.name)}${bodyIsOOC?' <span class="ooc-tag">OOC</span>':""}</div>
      ${directive ? directiveHTML(directive.cls, directive.text) : ""}
      ${showThink ? thinkBlock(think, false) : ""}
      <div class="md">${md(body)}</div>
      ${m.image?`<details class="cmd-note msg-image-note" open><summary>🎨 ${esc(t("dir_image"))}</summary><div class="cmd-note-body"><img src="${esc(mediaURL(m.image))}" alt=""></div></details>`:""}
      <div class="tools">
        <button class="tool" data-act="copy">${esc(t("tool_copy"))}</button>
        <button class="tool" data-act="translate">${esc(t("tool_translate"))}</button>
        ${canRegen ? `<button class="tool" data-act="regen">${esc(t("tool_regenerate"))}</button>` : ""}
        <button class="tool" data-act="edit">${esc(t("tool_edit"))}</button>
        ${canRegen ? `<button class="tool" data-act="continue">${esc(t("tool_continue"))}</button>
        <button class="tool" data-act="cont_dir">${esc(t("tool_continue_with"))}</button>` : ""}
        <button class="tool" data-act="image">${esc(m.image?t("tool_image_regen"):t("tool_image"))}</button>
        <button class="tool danger" data-act="del">${esc(t("tool_delete"))}</button>
      </div></div>`);
    wireTools(e, m); return e;
  }
  const e=el(`<div class="turn you" data-id="${m.id}" data-raw="${esc(m.content||"")}">
    <div class="you-label">${esc(cs.user_name||"You")}</div>
    <div>
      <div class="bubble">
        <div class="md">${md(m.content)}</div>
      </div>
      <div class="tools">
        <button class="tool" data-act="copy">${esc(t("tool_copy"))}</button>
        <button class="tool" data-act="translate">${esc(t("tool_translate"))}</button>
        <button class="tool" data-act="edit">${esc(t("tool_edit"))}</button>
        <button class="tool danger" data-act="del">${esc(t("tool_delete"))}</button>
      </div>
    </div>
  </div>`);
  wireTools(e,m); return e;
}
function recallHTML(meta){
  if(!meta||(!meta.lore?.length&&!meta.memory?.length)) return "";
  const block=(title,arr)=> arr&&arr.length?`<b>${title}</b><ul>${arr.map(x=>`<li>${esc(x.replace(/^- /,""))}</li>`).join("")}</ul>`:"";
  return `<details class="recall"><summary>▸ ${esc(t("drew_on"))} (${(meta.lore?.length||0)+(meta.memory?.length||0)})</summary><div class="body">${block(esc(t("recall_lore")),meta.lore)}${block(esc(t("recall_memory")),meta.memory)}</div></details>`;
}
function wireTools(e,m){ e.querySelectorAll(".tool").forEach(b=>b.onclick=()=>msgAction(b.dataset.act,m.id)); }
async function msgAction(act, mid){
  const cs=ChatState.current(); if(!cs||cs.generating) return;
  const {sid} = cs;

  if(act === "copy"){
    const node=[...$("#thread").children].find(x=>x.dataset.id===mid);
    const text=node?.querySelector(".md")?.innerText||"";
    navigator.clipboard.writeText(text).then(()=>toast("Copied.")).catch(()=>toast("Copy failed."));
    return;
  } else if(act === "translate"){
    const node=[...$("#thread").children].find(x=>x.dataset.id===mid); if(!node) return;
    const mdEl=node.querySelector(".md"); const btn=node.querySelector('[data-act="translate"]');
    if(!mdEl||!btn) return;
    btn.disabled=true; const label=btn.textContent; btn.textContent="…";
    try{
      const lang=myLanguage();
      const d=await api("/api/translate", j("POST",{text:mdEl.innerText, target:lang, sid:cs.sid}));
      if(d.translated){ mdEl.innerHTML=md(d.translated); btn.textContent="✓ translated"; btn.title=`Translated to ${lang}`; }
      else { btn.disabled=false; btn.textContent=label; toast("Translation came back empty — try again."); }
    }catch(e){ btn.disabled=false; btn.textContent=label; toast("Translate failed: "+e.message); }
    return;
  } else if(act === "del"){
    await api(`/api/sessions/${sid}/messages/${mid}`, {method: "DELETE"});
    invalidateRecent(); loadRecent(true);
    reload();
  } else if(act === "edit"){
    const node=[...$("#thread").children].find(x=>x.dataset.id===mid); if(!node) return;
    const mdEl=node.querySelector(".md");
    const toolsEl=node.querySelector(".tools");
    const raw=node.dataset.raw||mdEl.innerText||"";
    const ta=document.createElement("textarea");
    ta.className="inline-edit-ta"; ta.value=raw; ta.rows=Math.max(3,raw.split("\n").length);
    const bar=el(`<div class="inline-edit-bar"><button class="btn primary" id="ied_save">${esc(t("btn_save"))}</button><button class="btn" id="ied_cancel">${esc(t("btn_cancel"))}</button></div>`);
    mdEl.replaceWith(ta); toolsEl.replaceWith(bar); ta.focus();
    const restore=()=>{ ta.replaceWith(mdEl); bar.replaceWith(toolsEl); };
    bar.querySelector("#ied_cancel").onclick=restore;
    bar.querySelector("#ied_save").onclick=async()=>{
      const next=ta.value;
      await api(`/api/sessions/${sid}/messages/${mid}`,j("PATCH",{content:next}));
      invalidateRecent(); loadRecent(true);
      reload();
    };
    ta.addEventListener("keydown",e=>{ if(e.key==="Escape"){ e.preventDefault(); restore(); }
      if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); bar.querySelector("#ied_save").click(); } });
  } else if(act === "image"){
    const openImageGenModal=async()=>{
      const {checkpoints, loras}=await getImagegenOptions();
      if(!checkpoints.length){ toast("No ComfyUI checkpoints found — check the Image generation settings."); return; }
      openModal(`
        <div class="img-gen-head"><span class="img-gen-icon">🎨</span><h3>${esc(t("img_gen_title"))}</h3></div>
        <div class="field-group">
          <div class="field"><label>${esc(t("img_gen_checkpoint"))}</label>
            <div id="ig_ckpt"></div></div>
          <div class="field"><label>${esc(t("img_gen_lora"))}</label>
            <div id="ig_lora"></div></div>
          <div class="field" id="ig_strength_row" style="display:none;margin-bottom:0;"><label>${esc(t("img_gen_strength"))} <span class="hint" id="ig_strength_val">0.8</span></label>
            <input type="range" id="ig_strength" min="0" max="1.5" step="0.05" value="0.8"></div>
        </div>
        <div class="field"><label>${esc(t("img_gen_positive"))}</label>
          <textarea id="ig_positive" class="ig-autosize" rows="1" placeholder="${esc(t("img_gen_prompt_loading"))}"></textarea></div>
        <div class="field"><label>${esc(t("img_gen_negative"))}</label>
          <textarea id="ig_negative" class="ig-autosize" rows="1" placeholder="${esc(t("img_gen_prompt_loading"))}"></textarea></div>
        <div class="modal-foot"><button class="btn" id="ig_cancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="ig_go">${esc(t("img_gen_generate"))}</button></div>`);
      $("#ig_cancel").onclick=closeModal;
      const ckptSel=mountCustomSelect($("#ig_ckpt"), checkpoints.map(c=>({value:c,label:c})), {getDesc:describeCheckpoint});
      const loraSel=mountCustomSelect($("#ig_lora"),
        [{value:"",label:t("img_gen_lora_none")}, ...loras.map(l=>({value:l,label:l}))],
        {onChange:v=>{ $("#ig_strength_row").style.display=v?"":"none"; }});
      $("#ig_strength").oninput=()=>{ $("#ig_strength_val").textContent=$("#ig_strength").value; };
      [$("#ig_positive"), $("#ig_negative")].forEach(ta=>{ ta.addEventListener("input",()=>autosize(ta)); ta.addEventListener("paste",()=>setTimeout(()=>autosize(ta),0)); });
      $("#ig_positive").disabled=$("#ig_negative").disabled=true;
      api(`/api/sessions/${sid}/messages/${mid}/image-prompt`,{method:"POST"}).then(r=>{
        $("#ig_positive").value=r.positive; $("#ig_negative").value=r.negative;
        $("#ig_positive").disabled=$("#ig_negative").disabled=false;
        autosize($("#ig_positive")); autosize($("#ig_negative"));
      }).catch(e=>{
        $("#ig_positive").placeholder=$("#ig_negative").placeholder=t("img_gen_prompt_failed");
        $("#ig_positive").disabled=$("#ig_negative").disabled=false;
      });
      $("#ig_go").onclick=()=>{
        const body={checkpoint:ckptSel.value, lora:loraSel.value||null,
          lora_strength:parseFloat($("#ig_strength").value)||0.8,
          positive:$("#ig_positive").value.trim()||null, negative:$("#ig_negative").value.trim()||null};
        closeModal();
        const imgNode=[...$("#thread").children].find(x=>x.dataset.id===mid);
        const existing=imgNode?.querySelector(".msg-image-note .cmd-note-body");
        const noteBody = existing || appendCmdNote("🎨", t("dir_image_generating"));
        if(existing){
          existing.closest("details").querySelector("summary").innerHTML=`🎨 ${esc(t("dir_image_generating"))}`;
          existing.textContent=t("loading");
        }
        api(`/api/sessions/${sid}/messages/${mid}/image`, j("POST",body)).then(r=>{
          noteBody.closest("details").querySelector("summary").innerHTML=`🎨 ${esc(t("dir_image"))}`;
          noteBody.innerHTML=`<img src="${esc(mediaURL(r.image))}" alt="">`;
        }).catch(e=>{
          noteBody.closest("details").querySelector("summary").innerHTML=`🎨 ${esc(t("img_gen_failed"))}`;
          noteBody.textContent=e.message;
        });
      };
    };
    const imgNode=[...$("#thread").children].find(x=>x.dataset.id===mid);
    const imgTools=imgNode?.querySelector(".tools");
    const imgBtn=imgTools?.querySelector("[data-act='image']");
    if(!imgNode?.querySelector(".msg-image-note") || !imgBtn){ openImageGenModal(); return; }
    if(imgBtn.dataset.confirming){ return; }
    imgBtn.dataset.confirming="1";
    imgBtn.textContent=t("tool_image_confirm"); imgBtn.style.color="var(--warn)";
    const cancelBtn=el(`<button class="tool">${esc(t("btn_cancel"))}</button>`);
    imgTools.appendChild(cancelBtn);
    const restore=()=>{
      delete imgBtn.dataset.confirming;
      imgBtn.textContent=t("tool_image_regen"); imgBtn.style.color="";
      cancelBtn.remove(); clearTimeout(timer);
    };
    const timer=setTimeout(restore, 3000);
    cancelBtn.onclick=restore;
    imgBtn.onclick=()=>{ restore(); openImageGenModal(); };
    return;
  } else if(act === "regen"){
    const regenNode=[...$("#thread").children].find(x=>x.dataset.id===mid);
    const regenTools=regenNode?.querySelector(".tools");
    const regenBtn=regenTools?.querySelector("[data-act='regen']");
    if(!regenBtn){ regen(); return; }
    if(regenBtn.dataset.confirming){ return; } // already waiting — ignore extra clicks
    regenBtn.dataset.confirming="1";
    regenBtn.textContent="confirm ↺"; regenBtn.style.color="var(--warn)";
    const cancelBtn=el(`<button class="tool">cancel</button>`);
    regenTools.appendChild(cancelBtn);
    const restore=()=>{
      delete regenBtn.dataset.confirming;
      regenBtn.textContent="regenerate"; regenBtn.style.color="";
      regenBtn.onclick=()=>msgAction("regen",mid);
      cancelBtn.remove(); clearTimeout(timer);
    };
    const timer=setTimeout(restore, 3000);
    cancelBtn.onclick=restore;
    regenBtn.onclick=()=>{ restore(); regen(); };
  } else if(act === "continue" || act === "cont_dir"){
    if(act === "cont_dir"){
      const node=[...document.querySelectorAll(".turn.ai")].pop(); if(!node) return;
      const toolsEl=node.querySelector(".tools");
      const bar=el(`<div class="inline-edit-bar"><input class="inline-dir-input" placeholder="${esc(t("steer_ph"))}" style="flex:1"><button class="btn primary" id="icd_go">${esc(t("btn_go"))}</button><button class="btn" id="icd_cancel">${esc(t("btn_cancel"))}</button></div>`);
      toolsEl.replaceWith(bar); const inp=bar.querySelector("input"); inp.focus();
      const restore=()=>bar.replaceWith(toolsEl);
      bar.querySelector("#icd_cancel").onclick=restore;
      const go=()=>{ restore(); continueMessage(inp.value.trim()); };
      bar.querySelector("#icd_go").onclick=go;
      inp.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); go(); } if(e.key==="Escape"){ e.preventDefault(); restore(); } });
    } else {
      await continueMessage("");
    }
  }
}

async function continueMessage(content) {
  const cs=ChatState.current(); if(!cs) return;
  const lastAiNode = [...document.querySelectorAll(".turn.ai")].pop();
  if (!lastAiNode) return;
  await streamReply(`/api/sessions/${cs.sid}/continue`,
                    j("POST", {content: content, think: THINK}),
                    lastAiNode);
}
async function reload(){ const cs=ChatState.current(); if(!cs) return; const s=await api("/api/sessions/"+cs.sid); if(!ChatState.isActive(cs.sid)) return; renderThread(s.messages); }
function scrollDown(force){ const sc=$("#cscroll"); if(!sc) return; if(force||sc.scrollHeight-sc.scrollTop-sc.clientHeight<140) sc.scrollTop=sc.scrollHeight; }
function setGen(on){ const cs=ChatState.current(); if(cs) cs.generating=on; const b=$("#csend"); if(!b) return; b.classList.toggle("stop",on); b.textContent=on?"■":"↑"; }
function stopGen(){ const cs=ChatState.current(); if(cs&&cs.abort) cs.abort.abort(); }
async function doSend(){
  const cs=ChatState.current(); if(!cs) return;
  const inp=$("#cin"); let text=inp.value.trim(); if(!text||cs.generating) return;
  inp.value=""; inp.style.height="auto"; hidePalette();
  store.set("draft:"+cs.sid,"");
  if(text.startsWith("/")){
    const sp=text.indexOf(" "); const cmd=(sp===-1?text:text.slice(0,sp)).toLowerCase();
    const args=sp===-1?"":text.slice(sp+1).trim();
    switch(cmd){
      case "/ooc":   text="(OOC: "+(args||"…")+")"; break;
      case "/note":  text=`*[Author's Note: ${args}]*`; break;
      case "/scene": text=`*[Scene: ${args}]*`; break;
      case "/time":  text=`*[Time skip — ${args}]*`; break;
      case "/as":{const ns=args.indexOf(" ");const name=ns===-1?args:args.slice(0,ns);const said=ns===-1?"…":args.slice(ns+1).trim(); text=`[${name} says]: "${said}"`; break;}
      case "/roll":
        await streamReply(`/api/sessions/${cs.sid}/roll`,j("POST",{expr:args||"1d20",think:THINK}),
                          null,{cls:{icon:"🎲",label:t("dir_dice")},text:"🎲 "+(args||"1d20")});
        return;
      default: await _execSlashCmd(cmd,args); return;
    }
  }
  const cls=classifyDirective(text);
  if(!cls){ $("#thread").appendChild(turnEl({id:"tmp"+Date.now(),role:"user",content:text})); scrollDown(true); }
  await streamReply(`/api/sessions/${cs.sid}/chat`, j("POST",{content:text, think:THINK}), null, cls?{cls,text}:null);
}
async function regen(){
  const cs=ChatState.current(); if(!cs||cs.generating) return;
  let n=$("#thread").lastElementChild;
  while(n && n.classList.contains("ai")){ const p=n.previousElementSibling; n.remove(); n=p; }
  await streamReply(`/api/sessions/${cs.sid}/regenerate`, j("POST",{think:THINK}));
}
function finalizeStreamedTurn(aiNode, doneMsg, userMid, directive, meta){
  const finalNode = turnEl(doneMsg, directive, true);
  if(meta){ const rEl=el(recallHTML(meta)); if(rEl) finalNode.appendChild(rEl); }
  aiNode.replaceWith(finalNode);
  // the previously-last reply is no longer the tail: drop its regenerate/continue
  // actions (which only make sense on the newest turn), matching turnEl(isLast:false).
  $("#thread").querySelectorAll(".turn.ai").forEach(node=>{
    if(node===finalNode) return;
    node.querySelectorAll('[data-act="regen"],[data-act="continue"],[data-act="cont_dir"]').forEach(b=>b.remove());
  });
  // promote the optimistic user bubble to its persisted id so edit/delete target it
  if(userMid){
    const tmp=[...$("#thread").children].find(x=>x.dataset && String(x.dataset.id||"").startsWith("tmp"));
    if(tmp){ tmp.dataset.id=userMid; wireTools(tmp,{id:userMid}); }
  }
  return finalNode;
}
async function streamReply(path, opts, targetNode = null, directive = null) {
  const cs=ChatState.current(); if(!cs) return;
  setGen(true);

  // If targetNode is provided, use it. Otherwise, create new.
  const aiNode = targetNode || el(`<div class="turn ai"><div class="name">${esc(cs.c.name)}</div>${directive?directiveHTML(directive.cls,directive.text):""}<div class="md"><span class="cursor"></span></div></div>`);

  if (!targetNode) {
    $("#thread").appendChild(aiNode);
  }

  scrollDown(true);
  const mdEl = aiNode.querySelector(".md");

  // Clear cursor if updating existing content
  if (targetNode) mdEl.innerHTML = md(mdEl.innerText) + '<span class="cursor"></span>';

  cs.abort = new AbortController();
  // The model's canon generation happens in Chinese and is never sent to the client —
  // the backend buffers it, translates it, and streams *that*. So instead of a live
  // token-by-token thinking bubble, show a single Gemini-style status placeholder
  // until the first translated delta arrives; the real (translated) thought process,
  // if any, is attached afterward from the final `done` message, same as reload does.
  let acc="", meta=null, statusEl=null, thinkAcc="", thinkEl=null, doneMsg=null, userMid=null;
  const STATUS_LABEL={generating:t("status_generating"), translating:t("status_translating")};
  const setStatus=(phase)=>{
    if(!statusEl){ statusEl=el(`<div class="think"><span class="pulse"></span><span class="status-label"></span></div>`);
      aiNode.insertBefore(statusEl, mdEl); }
    statusEl.querySelector(".status-label").textContent=STATUS_LABEL[phase]||phase;
  };
  try{
    const res=await fetch(API+path,{...opts, headers:{"Content-Type":"application/json", ...(opts.headers||{})}, signal:cs.abort.signal});
    if(!res.ok||!res.body) throw new Error("HTTP "+res.status);
    await sseEvents(res, ev=>{
        if(ev.type==="meta"){ meta=(ev.lore?.length||ev.memory?.length)?ev:null; userMid=ev.user_mid||null;
          if(ev.retrieve_error && !cs.warnedRetrieve){ cs.warnedRetrieve=true;
            toast("⚠ Memory/lore lookup failed — check the embedding backend in Settings."); } }
        else if(ev.type==="status"){ setStatus(ev.phase); }
        else if(ev.type==="thinking"){
          if(statusEl){ statusEl.remove(); statusEl=null; }
          if(!thinkEl){
            thinkEl=el(`<details class="think" open><summary>💭 ${esc(t("thought_process"))}</summary><div class="think-body"></div></details>`);
            aiNode.insertBefore(thinkEl, mdEl);
          }
          thinkAcc+=ev.content;
          thinkEl.querySelector(".think-body").innerHTML=md(thinkAcc);
          scrollDown();
        }
        else if(ev.type==="delta"){ if(statusEl){ statusEl.remove(); statusEl=null; } acc+=ev.content; mdEl.innerHTML=md(stripMood(acc))+'<span class="cursor"></span>'; scrollDown(); }
        else if(ev.type==="error"){ acc+="\n\n*— "+ev.message+"*"; }
        else if(ev.type==="done"){
          doneMsg=ev.message||null;
          if(typeof applyScene==="function" && cs.c && cs.c.assets) applyScene(ev.mood||null);
          if(ev.memory_error) toast("⚠ This turn wasn't saved to memory — check the embedding backend in Settings.");
          // thinking (already translated) is rendered from message.content by
          // turnEl (finalizeStreamedTurn) once the stream ends, same splitThink/
          // thinkBlock path used for history — no need to do it here too.
        }
    });
    if(statusEl){ statusEl.remove(); statusEl=null; }
    mdEl.innerHTML=md(stripMood(acc)||"*"+t("no_response")+"*");
  }catch(err){
    if(err.name==="AbortError") mdEl.innerHTML=md(acc||"*"+t("stopped")+"*");
    else mdEl.innerHTML=md(acc)+`<p style="color:var(--warn)">${esc(t("backend_unreachable"))} (${esc(err.message)}).</p>`;
  }finally {
    cs.abort = null;
    if(doneMsg) invalidateRecent();
    // Navigated away mid-stream: the chat DOM is gone and this state is stale — don't
    // touch #thread / #csend. ChatState.clear() already aborted us into the catch above.
    if(ChatState.isActive(cs.sid)){
      setGen(false);
      // Only NEW turns are appended incrementally (from the persisted `done` message);
      // if the stream was aborted/errored with no `done`, fall back to a full reload.
      if(doneMsg) finalizeStreamedTurn(aiNode, doneMsg, userMid, directive, meta);
      else await reload();
      scrollDown();
      // Auto-name the session on first reply
      const _sid=cs.sid;
      const _cur=document.querySelector(`.session-row[data-id="${_sid}"] .t`);
      if(_sid && acc && ["Chat", trNow("Chat")].includes((_cur?.textContent||"").trim())){
        const _title=acc.replace(/<[^>]+>|\(OOC:[^)]*\)|[*_`#>\[\]()~]/g,"").trim()
                        .split(/[.!?\n]/)[0].trim().slice(0,60).replace(/\s+\S{0,15}$/,"").trim()||"Chat";
        if(_title!=="Chat") api(`/api/sessions/${_sid}`,j("PATCH",{title:_title})).then(()=>{ invalidateRecent(); if(_cur) _cur.textContent=_title; }).catch(()=>{});
      }
      loadRecent(true);
    }
  }
}
/* ============================ EDITOR ============================ */
async function viewEditor(main, cid){
  const c = cid ? await api("/api/characters/"+cid)
                : {name:"",persona:"",scenario:"",greeting:"",dialogue:"",tags:[],creator:"you",mode:"character"};
  main.innerHTML=`<div class="wrap wrap-wide">
    <div class="page-eyebrow">${esc(cid?t("ed_edit"):t("ed_new"))}</div>
    <h1 class="page">${cid?esc(c.name):esc(t("ed_create_title"))}</h1>
    <div class="page-sub">${esc(t("ed_sub"))}</div>
    ${cid?"":`<div class="dropzone" id="drop">
      <div class="t">${esc(t("ed_import_t"))}</div>
      <div class="s"><span class="browse">${esc(t("ed_import_s"))}</span></div>
      <input type="file" id="file" accept=".png,.json" hidden></div>`}
    <div class="field"><label>${esc(t("ed_mode"))} <span class="hint">${esc(t("ed_mode_hint"))}</span></label>
      <div class="seg" id="modeSeg">
        <button type="button" class="seg-btn ${(c.mode||'character')!=='rpg'?'on':''}" data-mode="character"><b>${esc(t("ed_mode_char"))}</b><span>${esc(t("ed_mode_char_hint"))}</span></button>
        <button type="button" class="seg-btn ${(c.mode||'character')==='rpg'?'on':''}" data-mode="rpg"><b>${esc(t("ed_mode_rpg"))}</b><span>${esc(t("ed_mode_rpg_hint"))}</span></button>
      </div>
    </div>
    <div class="field"><label>${esc(t("ed_avatar"))} <span class="hint">${esc(t("ed_avatar_hint"))}</span></label>
      <div class="ava-edit" id="avaEdit">
        ${avatar(c,"ava-edit-img")}
        <div class="ava-edit-right">
          <div class="ava-edit-btns">
            <button type="button" class="btn" id="avaPick">⬆ ${esc(t("ed_upload"))}</button>
            ${c.avatar?`<button type="button" class="btn danger" id="avaClear">${esc(t("ed_remove"))}</button>`:""}
          </div>
          <div class="ava-url-row">
            <input type="text" id="avaUrl" placeholder="${esc(t("ed_ava_url_ph"))}" value="${esc(c.avatar&&c.avatar.startsWith('http')?c.avatar:'')}">
          </div>
        </div>
        <input type="file" id="avaFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
      </div>
    </div>
    <div class="field"><label>${esc(t("ed_banner"))} <span class="hint">${esc(t("ed_banner_hint"))}</span></label>
      <div class="banner-edit" id="bannerEdit"${((c.assets||{}).banner)?` style="background-image:url('${esc(mediaURL((c.assets||{}).banner))}')"`:""}></div>
      <div class="ava-edit-right" style="margin-top:10px;">
        <div class="ava-edit-btns">
          <button type="button" class="btn" id="bannerPick">⬆ ${esc(t("ed_upload"))}</button>
          ${((c.assets||{}).banner)?`<button type="button" class="btn danger" id="bannerClear">${esc(t("ed_remove"))}</button>`:""}
        </div>
        <div class="ava-url-row">
          <input type="text" id="f_banner" placeholder="https://…/banner.jpg" value="${esc((c.assets||{}).banner||"")}">
        </div>
      </div>
      <input type="file" id="bannerFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
    </div>
    <div class="field"><label>${esc(t("ed_name"))} <span class="counter" id="nC"></span></label><input type="text" id="f_name" value="${esc(c.name)}"></div>
    <div class="field"><label>${esc(t("ed_description"))} <span class="hint">${esc(t("ed_description_hint"))}</span></label>
      <textarea id="f_description" style="min-height:80px">${esc(c.description||"")}</textarea></div>
    <div class="field"><label>${esc(t("ed_persona"))} <span class="hint">${esc(t("ed_persona_hint"))}</span><span class="counter" id="pC"></span></label>
      <textarea id="f_persona" style="min-height:160px">${esc(c.persona)}</textarea>${macroRow("f_persona")}</div>
    <div class="field"><label>${esc(t("ed_scenario"))} <span class="hint">${esc(t("ed_scenario_hint"))}</span></label>
      <textarea id="f_scenario">${esc(c.scenario)}</textarea>${macroRow("f_scenario")}</div>
    <div class="field"><label>${esc(t("ed_opening"))} <span class="hint">${esc(t("ed_opening_hint"))}</span></label>
      <textarea id="f_greeting" style="min-height:120px">${esc(c.greeting)}</textarea>${macroRow("f_greeting")}</div>
    <div class="field"><label>${esc(t("ed_dialogue"))} <span class="hint">${esc(t("ed_dialogue_hint"))}</span></label>
      <textarea id="f_dialogue" placeholder="{{user}}: Hello, how are you?&#10;{{char}}: *adjusts glasses* I'm well, thank you for asking.">${esc(c.dialogue)}</textarea>${macroRow("f_dialogue")}</div>
    <div class="field"><label>${esc(t("ed_tags"))} <span class="hint">${esc(t("ed_tags_hint"))}</span></label><input type="text" id="f_tags" value="${esc((c.tags||[]).join(", "))}"></div>
    <div class="field"><label>${esc(t("ed_creator"))} <span class="hint">${esc(t("ed_creator_hint"))}</span></label><input type="text" id="f_creator" value="${esc(c.creator||"")}"></div>
    <div class="field"><label>${esc(t("ed_sysprompt"))} <span class="hint">${esc(t("ed_sysprompt_hint"))}</span></label>
      <textarea id="f_sysprompt" style="min-height:80px">${esc(c.system_prompt||"")}</textarea>${macroRow("f_sysprompt")}</div>
    <div class="field"><label>${esc(t("ed_altgreet"))} <span class="hint">${esc(t("ed_altgreet_hint"))}</span></label>
      <div id="altGreets">${(c.alt_greetings||[]).map(g=>`<div class="gl-row" style="margin-bottom:8px;"><textarea class="ag-t" style="flex:1;min-height:64px">${esc(g)}</textarea><button type="button" class="tool danger gl-x">✕</button></div>`).join("")}</div>
      <button type="button" class="btn" id="agAdd">+ ${esc(t("ed_add_greeting"))}</button></div>
    <label class="switch" style="margin-bottom:20px;"><input type="checkbox" id="f_community" ${c.is_public?"checked":""}> ${esc(t("ed_share"))}</label>
    <label class="switch" id="canBePersonaRow" style="margin-bottom:20px;${(c.mode||"character")==="rpg"?"display:none;":""}"><input type="checkbox" id="f_can_be_persona" ${c.can_be_persona?"checked":""}> ${esc(t("ed_can_be_persona"))}</label>
    <label class="switch" style="margin-bottom:20px;"><input type="checkbox" id="f_allow_download" ${c.allow_download?"checked":""}> ${esc(t("ed_allow_download"))}</label>
    <label class="switch" style="margin-bottom:20px;"><input type="checkbox" id="f_is_explicit" ${c.is_explicit?"checked":""}> ${esc(t("ed_is_explicit"))}</label>
    <details class="stage-editor"${(c.assets&&Object.keys(c.assets).length)?" open":""}>
      <summary>🎬 ${esc(t("stage_summary"))}</summary>
      <div class="stage-body">
        <div class="page-sub" style="font-size:13px;margin:0 0 16px;">${esc(t("stage_sub"))}</div>
        <div class="stage-grid">
          <div><label>${esc(t("stage_bg"))}</label><div class="media-field"><input type="text" id="a_bg" placeholder="https://…/room.jpg" value="${esc(((c.assets||{}).stage||{}).default||"")}"><button type="button" class="btn s-upload" data-target="a_bg" data-accept="image/*" title="Upload">⬆</button></div></div>
          <div><label>${esc(t("stage_music"))}</label><div class="media-field"><input type="text" id="a_music" placeholder="https://…/theme.mp3" value="${esc(((c.assets||{}).music||{}).default||"")}"><button type="button" class="btn s-upload" data-target="a_music" data-accept="audio/*" title="Upload">⬆</button></div></div>
          <div><label>${esc(t("stage_sprite"))}</label><div class="media-field"><input type="text" id="a_sprite" placeholder="https://…/neutral.png" value="${esc(((c.assets||{}).sprites||{}).default||"")}"><button type="button" class="btn s-upload" data-target="a_sprite" data-accept="image/*" title="Upload">⬆</button></div></div>
        </div>
        <label class="moods-label">${esc(t("stage_moods"))}</label>
        <div class="mood-head"><span>${esc(t("mood_col"))}</span><span>${esc(t("mood_bg"))}</span><span>${esc(t("mood_music"))}</span><span>${esc(t("mood_sprite"))}</span><span></span></div>
        <div id="moodRows"></div>
        <button type="button" class="btn" id="addMood" style="margin-top:6px;">+ ${esc(t("stage_add_mood"))}</button>
      </div>
    </details>
    <details class="stage-editor"${(c.presentation_html||"").trim()?" open":""}>
      <summary>🖌 ${esc(t("pres_summary"))}</summary>
      <div class="stage-body">
        <div class="page-sub" style="font-size:13px;margin:0 0 16px;">${esc(t("pres_sub"))}</div>
        <div class="pres-warning">${esc(t("pres_b64_warning"))}</div>
        <div class="pres-tip">${esc(t("pres_prompt_tip"))}</div>
        <div class="pres-split">
          <div class="pres-col">
            <div class="pres-col-label">${esc(t("pres_code_label"))}</div>
            <textarea id="f_presentation" placeholder="&lt;div class=&quot;my-card&quot;&gt;…&lt;/div&gt;&#10;&lt;style&gt;.my-card{…}&lt;/style&gt;">${esc(c.presentation_html||"")}</textarea>
          </div>
          <div class="pres-col">
            <div class="pres-col-label">${esc(t("pres_preview_label"))}</div>
            <div class="pres-preview" id="presPreview"></div>
          </div>
        </div>
      </div>
    </details>
    <div class="actions">
      <button class="btn primary" id="saveBtn">${esc(cid?t("ed_save"):t("ed_create"))}</button>
      ${cid?`<button type="button" class="btn" id="reimportBtn">⟳ ${esc(t("ed_reimport"))}</button>
      <input type="file" id="reimportFile" accept=".png,.json" hidden>`:""}
      <a class="btn" href="${cid?("#/c/"+c.id):"#/"}">${esc(t("ed_cancel"))}</a>
    </div>
  </div>`;

  const count=(id,c2)=>{ const f=$("#"+id); const u=()=>{$("#"+c2).textContent=f.value.length;}; f.addEventListener("input",u); u(); };
  count("f_name","nC"); count("f_persona","pC");
  wireMacros();

  const presEl=$("#f_presentation"), presPreview=$("#presPreview");
  const renderPresPreview=()=>{ mountSandboxedHTML(presPreview, presEl.value, {autoHeight:false}); };
  renderPresPreview();
  let _presT; presEl.addEventListener("input", ()=>{ clearTimeout(_presT); _presT=setTimeout(renderPresPreview,300); });

  // Avatar — curAvatar is merged into the save payload; upload goes to the server immediately.
  let curAvatar = c.avatar || "";
  let avaPos = (c.assets&&c.assets.avatar_pos)||"";
  const wireAvaDrag=()=>{
    const img=$("#avaEdit").querySelector(".ava-edit-img");
    if(!img||img.tagName!=="IMG") return;
    img.style.cursor="move"; img.title=t("ed_ava_drag");
    if(avaPos) img.style.objectPosition=avaPos;
    let drag=false;
    const setPos=e=>{
      const r=img.getBoundingClientRect();
      const x=Math.max(0,Math.min(100,Math.round((e.clientX-r.left)/r.width*100)));
      const y=Math.max(0,Math.min(100,Math.round((e.clientY-r.top)/r.height*100)));
      avaPos=`${x}% ${y}%`; img.style.objectPosition=avaPos;
    };
    img.onpointerdown=e=>{ drag=true; img.setPointerCapture(e.pointerId); setPos(e); e.preventDefault(); };
    img.onpointermove=e=>{ if(drag) setPos(e); };
    img.onpointerup=img.onpointercancel=()=>{ drag=false; };
  };
  const refreshAva=()=>{
    const holder=$("#avaEdit");
    const img=holder.querySelector(".ava-edit-img");
    img.outerHTML = avatar({avatar:curAvatar, name:c.name}, "ava-edit-img");
    const clearBtn=$("#avaClear");
    if(curAvatar && !clearBtn){ $("#avaPick").insertAdjacentHTML("afterend", `<button type="button" class="btn danger" id="avaClear">Remove</button>`); wireClear(); }
    if(!curAvatar && clearBtn) clearBtn.remove();
    wireAvaDrag();
  };
  const wireClear=()=>{ const b=$("#avaClear"); if(b) b.onclick=()=>{ curAvatar=""; $("#avaUrl").value=""; refreshAva(); }; };
  // URL input — live preview on input, applied on blur/enter
  const avaUrlEl=$("#avaUrl");
  const applyUrl=()=>{ const v=avaUrlEl.value.trim(); if(v!==curAvatar){ curAvatar=v; refreshAva(); } };
  avaUrlEl.addEventListener("blur", applyUrl);
  avaUrlEl.addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); applyUrl(); } });
  // Also update preview live with small debounce
  let _avaT; avaUrlEl.addEventListener("input",()=>{ clearTimeout(_avaT); _avaT=setTimeout(()=>{ const v=avaUrlEl.value.trim(); if(v){ const img=$("#avaEdit").querySelector(".ava-edit-img"); if(img) img.src=v; } },400); });
  wireAvaDrag();
  $("#avaPick").onclick=()=>$("#avaFile").click();
  $("#avaFile").onchange=async()=>{
    const f=$("#avaFile").files[0]; if(!f) return;
    if(!cid){ toast("Save the character first, then set its avatar."); $("#avaFile").value=""; return; }
    if(f.type==="image/gif"){
      const fd=new FormData(); fd.append("file",f,f.name);
      try{ const r=await api(`/api/characters/${cid}/avatar`,{method:"POST",body:fd});
        curAvatar=r.avatar; avaUrlEl.value=""; refreshAva(); toast("Avatar updated."); }
      catch(e){ toast("Upload failed: "+e.message); }
      $("#avaFile").value="";
      return;
    }
    openCropper(URL.createObjectURL(f), "1", 512, 512, async blob=>{
      const fd=new FormData(); fd.append("file",blob,"avatar.jpg");
      try{ const r=await api(`/api/characters/${cid}/avatar`,{method:"POST",body:fd});
        curAvatar=r.avatar; avaUrlEl.value=""; refreshAva(); toast("Avatar updated."); }
      catch(e){ toast("Upload failed: "+e.message); }
      $("#avaFile").value="";
    });
  };
  wireClear();

  // Banner — same crop-on-upload flow as the avatar; pasted URLs skip cropping.
  const bannerPreview=v=>{ $("#bannerEdit").style.backgroundImage = v ? `url('${v}')` : ""; };
  const wireBannerClear=()=>{ const b=$("#bannerClear"); if(b) b.onclick=()=>{ $("#f_banner").value=""; bannerPreview(""); }; };
  wireBannerClear();
  let _bnT; $("#f_banner").addEventListener("input",()=>{ clearTimeout(_bnT); _bnT=setTimeout(()=>bannerPreview($("#f_banner").value.trim()),400); });
  $("#bannerPick").onclick=()=>$("#bannerFile").click();
  $("#bannerFile").onchange=()=>{
    const f=$("#bannerFile").files[0]; if(!f) return;
    if(!cid){ toast("Save the character first, then upload a banner."); $("#bannerFile").value=""; return; }
    openCropper(URL.createObjectURL(f), "3", 1200, 400, async blob=>{
      const fd=new FormData(); fd.append("file",blob,"banner.jpg");
      try{ const r=await api(`/api/characters/${cid}/media`,{method:"POST",body:fd});
        $("#f_banner").value=r.url; bannerPreview(r.url);
        if(!$("#bannerClear")){ $("#bannerPick").insertAdjacentHTML("afterend",
          `<button type="button" class="btn danger" id="bannerClear">${esc(t("ed_remove"))}</button>`); wireBannerClear(); }
        toast("Banner updated.");
      }catch(e){ toast("Upload failed: "+e.message); }
      $("#bannerFile").value="";
    });
  };

  let charMode = c.mode || "character";
  const mseg=$("#modeSeg");
  mseg.querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{ charMode=b.dataset.mode;
    mseg.querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("on",x===b));
    $("#canBePersonaRow").style.display = charMode==="rpg" ? "none" : ""; });

  // Stage editor rows
  const A=c.assets||{};
  const sM=(A.stage||{}).moods||{}, muM=(A.music||{}).moods||{}, spM=(A.sprites||{}).moods||{};
  const mr=$("#moodRows");
  [...new Set([...Object.keys(sM),...Object.keys(muM),...Object.keys(spM)])].forEach(n=>
    mr.appendChild(el(moodRowHTML(n, sM[n]||"", muM[n]||"", spM[n]||""))));
  $("#addMood").onclick=()=>mr.appendChild(el(moodRowHTML()));
  mr.addEventListener("click",e=>{ if(e.target.classList.contains("m-del")) e.target.closest(".mood-row").remove(); });

  // Stage media uploads (backgrounds, music, sprites)
  const stageFile=el('<input type="file" hidden>'); document.body.appendChild(stageFile);
  let _stageCb=null;
  stageFile.onchange=async()=>{
    const f=stageFile.files[0]; if(!f||!_stageCb) return;
    if(!cid){ toast("Save the character first, then upload media."); return; }
    const fd=new FormData(); fd.append("file",f);
    try{ const r=await api(`/api/characters/${cid}/media`,{method:"POST",body:fd}); _stageCb(r.url); toast("Uploaded."); }
    catch(e){ toast("Upload failed: "+e.message); }
  };
  const triggerStage=(accept,cb)=>{ _stageCb=cb; stageFile.accept=accept; stageFile.value=""; stageFile.click(); };
  // Static default fields
  document.querySelectorAll(".s-upload[data-target]").forEach(btn=>
    btn.onclick=()=>triggerStage(btn.dataset.accept, url=>{ const inp=$("#"+btn.dataset.target); if(inp) inp.value=url; }));
  // Mood row fields (event delegation)
  mr.addEventListener("click",e=>{
    const btn=e.target.closest(".s-upload[data-cls]"); if(!btn) return;
    const inp=btn.closest(".media-field").querySelector("input");
    triggerStage(btn.dataset.accept, url=>{ inp.value=url; });
  });
  const collectAssets=()=>{
    const bg={},mu={},sp={};
    mr.querySelectorAll(".mood-row").forEach(r=>{
      const n=r.querySelector(".m-name").value.trim().toLowerCase(); if(!n) return;
      const b=r.querySelector(".m-bg").value.trim(), m=r.querySelector(".m-music").value.trim(), s=r.querySelector(".m-sprite").value.trim();
      if(b)bg[n]=b; if(m)mu[n]=m; if(s)sp[n]=s;
    });
    const a={}, dbg=$("#a_bg").value.trim(), dmu=$("#a_music").value.trim(), dsp=$("#a_sprite").value.trim();
    if(dbg||Object.keys(bg).length) a.stage={default:dbg,moods:bg};
    if(dmu||Object.keys(mu).length) a.music={default:dmu,moods:mu};
    if(dsp||Object.keys(sp).length) a.sprites={default:dsp,moods:sp};
    const banner=$("#f_banner").value.trim();
    if(banner) a.banner=banner;
    return a;
  };

  if(!cid){
    const drop=$("#drop"), file=$("#file");
    drop.onclick=()=>file.click();
    file.onchange=()=>doImport(file.files[0]);
    ["dragover","dragenter"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add("over");}));
    ["dragleave","drop"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove("over");}));
    drop.addEventListener("drop",e=>{ const f=e.dataTransfer.files[0]; if(f) doImport(f); });
  }

  $("#altGreets").addEventListener("click",e=>{ const x=e.target.closest(".gl-x"); if(x) x.closest(".gl-row").remove(); });
  $("#agAdd").onclick=()=>{ $("#altGreets").insertAdjacentHTML("beforeend",
    `<div class="gl-row" style="margin-bottom:8px;"><textarea class="ag-t" style="flex:1;min-height:64px"></textarea><button type="button" class="tool danger gl-x">✕</button></div>`); };
  if(cid && $("#reimportBtn")){
    $("#reimportBtn").onclick=()=>$("#reimportFile").click();
    $("#reimportFile").onchange=async()=>{
      const f=$("#reimportFile").files[0]; if(!f) return;
      const fd=new FormData(); fd.append("file",f);
      try{
        await api(`/api/characters/${cid}/reimport`,{method:"POST",body:fd});
        toast(t("ed_reimport_done"));
        viewEditor($("#main"), cid);   // re-render with the refreshed fields
      }catch(e){ toast("Reimport failed: "+e.message); }
    };
  }
  $("#saveBtn").onclick=async()=>{
    const body={ name:$("#f_name").value.trim()||"Unnamed", description:$("#f_description").value,
      persona:$("#f_persona").value,
      scenario:$("#f_scenario").value, greeting:$("#f_greeting").value, dialogue:$("#f_dialogue").value,
      tags:$("#f_tags").value.split(",").map(s=>s.trim()).filter(Boolean),
      creator:$("#f_creator").value.trim()||c.creator||"you",
      system_prompt:$("#f_sysprompt").value,
      alt_greetings:[...document.querySelectorAll("#altGreets .ag-t")].map(t2=>t2.value.trim()).filter(Boolean),
      mode:charMode, assets:{...collectAssets(), ...(avaPos?{avatar_pos:avaPos}:{})}, avatar:curAvatar,
      is_public: !!$("#f_community")?.checked,
      can_be_persona: charMode!=="rpg" && !!$("#f_can_be_persona")?.checked,
      allow_download: !!$("#f_allow_download")?.checked,
      is_explicit: !!$("#f_is_explicit")?.checked,
      presentation_html: $("#f_presentation")?.value || "" };
    try{
      if(cid){ await api("/api/characters/"+cid, j("PUT",body)); toast("Saved."); location.hash="#/c/"+cid; }
      else{ const nc=await api("/api/characters", j("POST",body)); toast("Created."); location.hash="#/c/"+nc.id; }
    }catch(e){ toast("Save failed: "+e.message); }
  };
}
function moodRowHTML(mood="",bg="",music="",sprite=""){
  return `<div class="mood-row">
    <input type="text" class="m-name" placeholder="happy" value="${esc(mood)}">
    <div class="media-field"><input type="text" class="m-bg" placeholder="background url" value="${esc(bg)}"><button type="button" class="btn s-upload" data-cls="m-bg" data-accept="image/*" title="Upload">⬆</button></div>
    <div class="media-field"><input type="text" class="m-music" placeholder="music url" value="${esc(music)}"><button type="button" class="btn s-upload" data-cls="m-music" data-accept="audio/*" title="Upload">⬆</button></div>
    <div class="media-field"><input type="text" class="m-sprite" placeholder="sprite url" value="${esc(sprite)}"><button type="button" class="btn s-upload" data-cls="m-sprite" data-accept="image/*" title="Upload">⬆</button></div>
    <button type="button" class="tool danger m-del" title="remove">✕</button>
  </div>`;
}
function macroRow(target){ return `<div class="macro-row"><button class="chip" data-ins="{{user}}" data-t="${target}">+ {{user}}</button><button class="chip" data-ins="{{char}}" data-t="${target}">+ {{char}}</button></div>`; }
function wireMacros(){
  document.querySelectorAll(".chip[data-ins]").forEach(b=>b.onclick=()=>{
    const ta=$("#"+b.dataset.t); const s=ta.selectionStart??ta.value.length;
    ta.value=ta.value.slice(0,s)+b.dataset.ins+ta.value.slice(ta.selectionEnd??s); ta.focus();
  });
}
async function doImport(f){
  if(!f) return; toast("Reading card…");
  const fd=new FormData(); fd.append("file",f);
  try{ const c=await api("/api/characters/import",{method:"POST",body:fd});
    toast("Imported "+c.name+(c.lore_imported?` (+${c.lore_imported} lore)`:"")); location.hash="#/c/"+c.id;
  }catch(e){ toast("Import failed: "+e.message); }
}

function renderProfileLinksHTML(links){
  const entries = SOCIAL_PLATFORMS.filter(sp=>(links||{})[sp.key]);
  if(!entries.length) return "";
  return `<div class="gl-links">${entries.map(sp=>{
    const raw=(links[sp.key]||"").trim();
    const href = /^https?:\/\//.test(raw) ? raw
      : sp.key==="twitter" ? `https://x.com/${raw.replace(/^@/,"")}`
      : sp.key==="twitch" ? `https://twitch.tv/${raw}`
      : sp.key==="instagram" ? `https://instagram.com/${raw.replace(/^@/,"")}`
      : sp.key==="pixiv" ? `https://pixiv.net/users/${raw}`
      : sp.key==="youtube" ? `https://youtube.com/${raw.startsWith('@')?raw:'@'+raw}`
      : sp.key==="patreon" ? `https://patreon.com/${raw}`
      : sp.key==="kofi" ? `https://ko-fi.com/${raw}`
      : raw;
    return `<a class="gl-link" data-platform="${sp.key}" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(t("pf_social_"+sp.key))}" style="--gl-color:${sp.color}">
      <svg class="gl-link-icon" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">${sp.icon}</svg>
      <span class="gl-link-host">${esc(sp.host)}</span>
    </a>`;
  }).join("")}</div>`;
}
function renderProfileCharactersHTML(chars){
  if(!chars || !chars.length) return `<div class="empty"><div class="big">${esc(t("pf_no_chars"))}</div></div>`;
  return `<div class="gl-characters">${chars.map(c=>`
    <a class="gl-character-card" href="#/c/${c.id}">
      <div class="gl-character-thumb">${avatar(c,"gl-character-img")}</div>
      <div class="gl-character-title">${esc(c.name)}</div>
      <div class="gl-character-summary">${esc(logline(c))}</div>
      <div class="gl-character-meta">
        <span class="gl-character-chats">${c.chats||0}</span>
        ${(c.tags||[]).length?`<span class="gl-character-tags">${(c.tags||[]).slice(0,3).map(tg=>`<span class="gl-tag">${esc(tg)}</span>`).join("")}</span>`:""}
      </div>
    </a>`).join("")}</div>`;
}
const PROFILE_GL_DEFAULT_CSS = `
.gl-links{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;}
.gl-link{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;gap:6px;background:var(--gl-color,#c9a227);color:#fff;flex:none;text-decoration:none;transition:transform .15s,opacity .15s;}
.gl-link:hover{transform:translateY(-2px);opacity:.9;}
.gl-link-host{display:none;}
.gl-characters{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;}
.gl-character-card{display:block;background:#1a1a1a;border:1px solid #333;border-radius:12px;overflow:hidden;color:inherit;text-decoration:none;transition:.15s;}
.gl-character-card:hover{border-color:#c9a227;transform:translateY(-2px);}
.gl-character-thumb{aspect-ratio:1;overflow:hidden;background:#222;}
.gl-character-thumb .gl-character-img{width:100%;height:100%;object-fit:cover;display:block;border-radius:0;border:none;}
.gl-character-title{font-weight:600;font-size:14px;padding:8px 10px 0;color:#fff;}
.gl-character-summary{font-size:12px;color:#999;padding:2px 10px 8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.gl-character-meta{display:flex;align-items:center;gap:8px;font-size:11px;color:#c9a227;padding:0 10px 10px;flex-wrap:wrap;}
.gl-character-chats{color:#c9a227;}
.gl-character-chats::before{content:'💬';margin-right:4px;}
.gl-character-tags{display:flex;gap:5px;flex-wrap:wrap;}
.gl-tag{background:rgba(255,255,255,.08);color:#ccc;padding:1px 6px;border-radius:4px;text-transform:uppercase;font-size:9px;letter-spacing:.03em;}
.gl-share{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;background:rgba(255,255,255,.08);color:#fff;text-decoration:none;font-size:13px;cursor:pointer;border:1px solid rgba(255,255,255,.15);}
.gl-share:hover{background:rgba(255,255,255,.15);}
.gl-edit{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;background:var(--profile-gradient-start,#E3BD6C);color:#111;text-decoration:none;font-size:13px;font-weight:600;cursor:pointer;border:1px solid transparent;}
.gl-edit:hover{opacity:.9;}
`;
function substituteProfileTemplate(html, p, socialLinks, own){
  const shareUrl = `${location.origin}/u/${encodeURIComponent(p.username||"")}`;
  const map = {
    "{{share}}": `<a class="gl-share" href="${esc(shareUrl)}" data-share-url="${esc(shareUrl)}">⤴ ${esc(t("doss_share"))}</a>`,
    "{{edit}}": own ? `<a class="gl-edit" href="#" data-edit="1">✎ ${esc(t("pf_edit"))}</a>` : "",
    "{{display_name}}": esc(p.display_name||p.username||""),
    "{{bio}}": esc(p.bio||""),
    "{{rank}}": p.is_admin?esc(t("pf_admin")):"",
    "{{avatar_url}}": esc(mediaURL(p.avatar||"")),
    "{{banner_url}}": esc(mediaURL(p.banner_img||"")),
    "{{character_count}}": String((p.stats&&p.stats.characters)||(p.characters||[]).length||0),
    "{{chat_count}}": String((p.stats&&p.stats.chats)||0),
    "{{member_since}}": p.joined ? new Date(p.joined*1000).toLocaleDateString() : "",
    "{{characters}}": renderProfileCharactersHTML(p.characters||[]),
    "{{links}}": renderProfileLinksHTML(socialLinks||p.social_links),
  };
  const out = html.replace(/\{\{[a-z_]+\}\}/g, m=>map[m]!==undefined?map[m]:m);
  const g1=esc(p.banner_color||"#E3BD6C"), g2=esc(p.accent_color||p.banner_color||"#A97F2C");
  const bannerUrl = p.banner_img ? `url('${esc(mediaURL(p.banner_img))}')` : "none";
  const varStyle = `<style>:root{--profile-gradient-start:${g1};--profile-gradient-end:${g2};--profile-banner-url:${bannerUrl};}\n${PROFILE_GL_DEFAULT_CSS}</style>`;
  return varStyle + out;
}
function wireProfileTemplateButtons(doc, {onEdit}={}){
  doc.querySelectorAll(".gl-share, #pfShare").forEach(el=>{
    el.addEventListener("click", e=>{
      e.preventDefault();
      const url=el.dataset.shareUrl || `${location.origin}/u/${encodeURIComponent(ME?.username||"")}`;
      navigator.clipboard?.writeText(url).then(()=>toast(t("doss_share_copied"))).catch(()=>{});
    });
  });
  if(onEdit) doc.querySelectorAll(".gl-edit, #pfEdit").forEach(el=>{
    el.addEventListener("click", e=>{ e.preventDefault(); onEdit(); });
  });
}

/* ============================ PERSONAS ============================ */
async function viewProfile(main, username){
  let p=null;
  try{ p=await api("/api/users/"+encodeURIComponent(username)); }
  catch(e){ return errorPage(main, {code:"404", title:"Page not found", message:t("pf_not_found")}); }
  const own = ME && ME.username===p.username;
  const c1=p.banner_color||"#E3BD6C", c2=p.accent_color||p.banner_color||"#A97F2C";
  const banner = p.banner_img
    ? `background:url('${esc(mediaURL(p.banner_img))}') center/cover`
    : `background:linear-gradient(100deg,${esc(c1)},${esc(c2)})`;
  const cardTint = `background:linear-gradient(160deg, color-mix(in srgb, ${esc(c1)} 16%, var(--surface)), color-mix(in srgb, ${esc(c2)} 10%, var(--surface)) 55%, var(--surface));`;
  const avaHTML = p.avatar
    ? `<img class="pf-ava" src="${esc(mediaURL(p.avatar))}" alt="">`
    : `<div class="pf-ava mono">${esc((p.display_name||p.username||"?")[0].toUpperCase())}</div>`;
  const joined = p.joined ? new Date(p.joined*1000).toLocaleDateString() : "";
  if(p.profile_html && p.profile_html.trim()){
    main.innerHTML=`<div class="wrap wrap-wide"><div id="pfCustom"></div></div>`;
    mountSandboxedHTML($("#pfCustom"), substituteProfileTemplate(p.profile_html, p, null, own), {onReady:doc=>wireProfileTemplateButtons(doc, {
      onEdit: own ? ()=>openProfileEditor(p, ()=>viewProfile(main, username)) : null,
    })});
    return;
  }
  const linksHTML = renderProfileLinksHTML(p.social_links);
  main.innerHTML=`
    <div class="pf-banner-full" style="${banner}"></div>
    <div class="wrap wrap-wide">
    <div class="pf-card pf-glass">
      <div class="pf-body">
        <div class="pf-head">
          <div class="pf-ava-wrap">${avaHTML}</div>
          <div class="pf-id">
            <div class="pf-name-row">
              <span class="pf-name">${esc(p.display_name||p.username)}</span>
              ${p.is_admin?`<span class="pf-badge">${esc(t("pf_admin"))}</span>`:""}
            </div>
            <div class="pf-user">@${esc(p.username)}</div>
          </div>
          <div style="display:flex;gap:8px;margin-left:auto;">
            <button class="btn" id="pfShare" data-share-url="${esc(location.origin)}/u/${esc(encodeURIComponent(p.username))}">⤴ ${esc(t("doss_share"))}</button>
            ${own?`<button class="btn primary" id="pfEdit">✎ ${esc(t("pf_edit"))}</button>`:""}
          </div>
        </div>
        <div class="pf-stats">
          <span><b>${p.stats.characters}</b> ${esc(t("pf_characters"))}</span>
          <span><b>${p.stats.chats}</b> ${esc(t("pf_chats"))}</span>
          ${joined?`<span>${esc(t("pf_joined"))} ${esc(joined)}</span>`:""}
        </div>
        ${p.bio?`<div class="pf-bio" id="pfBio">${esc(p.bio)}</div>`:""}
        ${linksHTML}
      </div>
    </div>
    <div class="section-heading" style="margin-top:26px;display:flex;align-items:center;justify-content:space-between;">
      <span>${esc(t("pf_characters"))}</span>
      <div class="view-switch" id="pfViewSwitch" role="group" aria-label="Layout">
        <button type="button" class="vs-btn" data-view="list" title="${esc(t("view_list"))}">☰</button>
        <button type="button" class="vs-btn" data-view="card" title="${esc(t("view_card"))}">▦</button>
      </div>
    </div>
    <div class="catalog pf-cat" id="pfCatalog"></div>
  </div>`;
  localizeContent([{el:$("#pfBio"), text:p.bio}]);
  const box=$("#pfCatalog");
  let _v=store.get("libView","list");
  const paintPfSwitch=()=>{ $("#pfViewSwitch").querySelectorAll(".vs-btn").forEach(b=>b.classList.toggle("on", b.dataset.view===_v)); };
  const renderPfCatalog=()=>{
    box.classList.toggle("catalog-card", _v==="card");
    const r=_catalogView(p.characters, _v, id=>location.hash="#/c/"+id);
    if(r){ box.innerHTML=r.html; r.wire(box); }
    else box.innerHTML=`<div class="empty"><div class="big">${esc(t("pf_no_chars"))}</div></div>`;
  };
  paintPfSwitch();
  renderPfCatalog();
  $("#pfViewSwitch").addEventListener("click", e=>{
    const b=e.target.closest(".vs-btn"); if(!b) return;
    _v=b.dataset.view; store.set("libView",_v); paintPfSwitch(); renderPfCatalog();
  });
  if(own && $("#pfEdit")) $("#pfEdit").onclick=()=>openProfileEditor(p, ()=>viewProfile(main, username));
  wireProfileTemplateButtons(document);
}
function openProfileEditor(p, onSave){
  let curAvatar = p.avatar || "";
  openModal(`<h3>${esc(t("pf_edit"))}</h3>
    <div class="field"><label>${esc(t("pf_display"))}</label><input type="text" id="pf_dn" maxlength="48" value="${esc(p.display_name||"")}" placeholder="${esc(p.username)}"></div>
    <div class="field"><label>${esc(t("pf_bio"))} <span class="hint">${esc(t("pf_bio_hint"))}</span></label>
      <textarea id="pf_bio_in" maxlength="600" style="min-height:100px">${esc(p.bio||"")}</textarea></div>
    <div class="field-group">
      <div class="field-group-label">${esc(t("pf_social"))}</div>
      ${SOCIAL_PLATFORMS.map(sp=>`
        <div class="field"><label>${esc(t("pf_social_"+sp.key))}</label>
          <input type="text" id="pf_soc_${sp.key}" maxlength="300" placeholder="${esc(sp.ph)}" value="${esc((p.social_links||{})[sp.key]||"")}"></div>`).join("")}
    </div>
    <div class="field"><label>${esc(t("pf_accent"))}</label>
      <div style="display:flex;gap:10px;align-items:center;">
        <input type="color" id="pf_bc" value="${esc(p.banner_color||"#E3BD6C")}" style="width:64px;height:38px;padding:2px;border:1px solid var(--line);border-radius:8px;background:var(--surface);">
        <input type="color" id="pf_ac" value="${esc(p.accent_color||p.banner_color||"#A97F2C")}" style="width:64px;height:38px;padding:2px;border:1px solid var(--line);border-radius:8px;background:var(--surface);">
        <div id="pf_grad_preview" style="flex:1;height:38px;border-radius:8px;border:1px solid var(--line);"></div>
      </div></div>
    <div class="field"><label>${esc(t("pf_upload_ava"))} <span class="hint">${esc(t("pf_ava_hint"))}</span></label>
      <div class="ava-edit" id="pfAvaEdit">
        ${avatar({avatar:curAvatar,name:p.display_name||p.username},"ava-edit-img")}
        <div class="ava-edit-right">
          <div class="ava-edit-btns">
            <button type="button" class="btn" id="pf_ava_btn">⬆ ${esc(t("ed_upload"))}</button>
            ${curAvatar?`<button type="button" class="btn danger" id="pf_ava_clear">${esc(t("ed_remove"))}</button>`:""}
          </div>
          <div class="ava-url-row">
            <input type="text" id="pf_ava_url" placeholder="${esc(t("ed_ava_url_ph"))}" value="${esc(curAvatar&&curAvatar.startsWith('http')?curAvatar:'')}">
          </div>
        </div>
        <input type="file" id="pf_ava_file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
      </div></div>
    <div class="field"><label>${esc(t("pf_banner_img"))} <span class="hint">${esc(t("pf_banner_hint"))}</span></label>
      <div class="banner-edit" id="pf_banner_edit"${p.banner_img?` style="background-image:url('${esc(mediaURL(p.banner_img))}')"`:""}></div>
      <div class="ava-edit-right" style="margin-top:10px;">
        <div class="ava-edit-btns">
          <button type="button" class="btn" id="pf_banner_btn">⬆ ${esc(t("ed_upload"))}</button>
          ${p.banner_img?`<button type="button" class="btn danger" id="pf_banner_clear">${esc(t("ed_remove"))}</button>`:""}
        </div>
      </div>
      <input type="file" id="pf_banner_file" accept="image/png,image/jpeg,image/webp" hidden></div>
    <details class="stage-editor">
      <summary>${esc(t("pf_html_summary"))}</summary>
      <p class="hint">${esc(t("pf_html_sub"))}</p>
      <p class="hint"><b>${esc(t("pf_html_placeholders"))}</b><br>
        <code>{{display_name}} {{bio}} {{rank}} {{avatar_url}} {{banner_url}} {{character_count}} {{chat_count}} {{member_since}}</code></p>
      <p class="hint"><b>${esc(t("pf_html_characters_label"))}</b> ${esc(t("pf_html_characters_hint"))}</p>
      <p class="hint"><b>${esc(t("pf_html_links_label"))}</b> ${esc(t("pf_html_links_hint"))}</p>
      <p class="hint"><b>${esc(t("pf_html_share_label"))}</b> ${esc(t("pf_html_share_hint"))}</p>
      <p class="hint"><b>${esc(t("pf_html_edit_label"))}</b> ${esc(t("pf_html_edit_hint"))}</p>
      <p class="hint"><b>${esc(t("pf_html_vars_label"))}</b> ${esc(t("pf_html_vars_hint"))}</p>
      <p class="hint">${esc(t("pf_html_example"))} <code>&lt;style&gt;body{display:grid;grid-template-columns:200px 1fr;gap:24px;padding:24px}&lt;/style&gt; &lt;h1&gt;{{display_name}}&lt;/h1&gt;&lt;p&gt;{{bio}}&lt;/p&gt;{{share}} {{edit}}&lt;h2&gt;Cast&lt;/h2&gt;{{characters}}</code></p>
      <button type="button" class="btn" id="pf_html_upload_btn">⬆ ${esc(t("pf_html_upload_btn"))}</button>
      <input type="file" id="pf_html_file" accept=".html,.css,.txt" hidden>
      <div class="field" style="margin-top:10px;"><label>${esc(t("pf_html_code_label"))}</label>
        <textarea id="pf_html_in" style="min-height:160px;font-family:var(--mono);font-size:12.5px;">${esc(p.profile_html||"")}</textarea></div>
      <div class="field"><label>${esc(t("pf_html_preview_label"))}</label>
        <div class="pres-preview" id="pfHtmlPreview"></div></div>
    </details>
    <div class="modal-foot"><button class="btn" id="pf_cancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="pf_save">${esc(t("btn_save"))}</button></div>`, "modal-wide");
  $("#pf_cancel").onclick=closeModal;
  const _grad=()=>{ $("#pf_grad_preview").style.background=`linear-gradient(100deg,${$("#pf_bc").value},${$("#pf_ac").value})`; };
  $("#pf_bc").oninput=_grad; $("#pf_ac").oninput=_grad; _grad();

  const refreshPfAva=()=>{
    const holder=$("#pfAvaEdit");
    const img=holder.querySelector(".ava-edit-img");
    img.outerHTML = avatar({avatar:curAvatar, name:p.display_name||p.username}, "ava-edit-img");
    const clearBtn=$("#pf_ava_clear");
    if(curAvatar && !clearBtn){ $("#pf_ava_btn").insertAdjacentHTML("afterend", `<button type="button" class="btn danger" id="pf_ava_clear">${esc(t("ed_remove"))}</button>`); wirePfAvaClear(); }
    if(!curAvatar && clearBtn) clearBtn.remove();
  };
  const wirePfAvaClear=()=>{ const b=$("#pf_ava_clear"); if(b) b.onclick=()=>{ curAvatar=""; $("#pf_ava_url").value=""; refreshPfAva(); }; };
  wirePfAvaClear();
  const pfAvaUrlEl=$("#pf_ava_url");
  const applyPfAvaUrl=()=>{ const v=pfAvaUrlEl.value.trim(); if(v!==curAvatar){ curAvatar=v; refreshPfAva(); } };
  pfAvaUrlEl.addEventListener("blur", applyPfAvaUrl);
  pfAvaUrlEl.addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); applyPfAvaUrl(); } });
  $("#pf_ava_btn").onclick=()=>$("#pf_ava_file").click();
  $("#pf_ava_file").onchange=()=>{
    const f=$("#pf_ava_file").files[0]; if(!f) return;
    const pending={display_name:$("#pf_dn").value, bio:$("#pf_bio_in").value, banner_color:$("#pf_bc").value, accent_color:$("#pf_ac").value};
    if(f.type==="image/gif"){
      const fd=new FormData(); fd.append("file",f,f.name);
      api("/api/me/avatar",{method:"POST",body:fd}).then(r=>{
        toast(t("pf_saved")); onSave(); openProfileEditor({...p, ...pending, avatar:r.avatar}, onSave);
      }).catch(e=>{ toast("Upload failed: "+e.message); openProfileEditor({...p, ...pending}, onSave); });
      return;
    }
    openCropper(URL.createObjectURL(f), "1", 512, 512, async blob=>{
      const fd=new FormData(); fd.append("file",blob,"avatar.jpg");
      try{ const r=await api("/api/me/avatar",{method:"POST",body:fd});
        toast(t("pf_saved")); onSave(); openProfileEditor({...p, ...pending, avatar:r.avatar}, onSave); }
      catch(e){ toast("Upload failed: "+e.message); openProfileEditor({...p, ...pending}, onSave); }
    });
  };

  const pfBannerPreview=v=>{ const el=$("#pf_banner_edit"); if(el) el.style.backgroundImage = v ? `url('${v}')` : ""; };
  const wirePfBannerClear=()=>{ const b=$("#pf_banner_clear"); if(b) b.onclick=async()=>{
    try{ await api("/api/me/profile", j("PUT",{banner_img:""})); pfBannerPreview(""); b.remove(); toast(t("pf_saved")); onSave(); }
    catch(e){ toast("Failed: "+e.message); }
  }; };
  wirePfBannerClear();
  $("#pf_banner_btn").onclick=()=>$("#pf_banner_file").click();
  $("#pf_banner_file").onchange=()=>{
    const f=$("#pf_banner_file").files[0]; if(!f) return;
    const pending={display_name:$("#pf_dn").value, bio:$("#pf_bio_in").value, banner_color:$("#pf_bc").value, accent_color:$("#pf_ac").value};
    openCropper(URL.createObjectURL(f), "3", 1200, 400, async blob=>{
      const fd=new FormData(); fd.append("file",blob,"banner.jpg");
      try{ const r=await api("/api/me/banner",{method:"POST",body:fd});
        toast(t("pf_saved")); onSave(); openProfileEditor({...p, ...pending, avatar:curAvatar, banner_img:r.banner_img}, onSave); }
      catch(e){ toast("Upload failed: "+e.message); openProfileEditor({...p, ...pending, avatar:curAvatar}, onSave); }
    });
  };

  const collectSocialLinks=()=>{
    const links={};
    SOCIAL_PLATFORMS.forEach(sp=>{ const v=$("#pf_soc_"+sp.key).value.trim(); if(v) links[sp.key]=v; });
    return links;
  };
  const renderPfHtmlPreview=()=>{
    const html=$("#pf_html_in").value;
    const box=$("#pfHtmlPreview"); if(!box) return;
    if(!html.trim()){ box.innerHTML=""; return; }
    const previewP={...p, display_name:$("#pf_dn").value, bio:$("#pf_bio_in").value,
      avatar:curAvatar, banner_img:p.banner_img, is_admin:p.is_admin, joined:p.joined,
      stats:p.stats, characters:p.characters};
    mountSandboxedHTML(box, substituteProfileTemplate(html, previewP, collectSocialLinks(), true));
  };
  let _pfHtmlT; $("#pf_html_in").addEventListener("input",()=>{ clearTimeout(_pfHtmlT); _pfHtmlT=setTimeout(renderPfHtmlPreview,400); });
  renderPfHtmlPreview();
  $("#pf_html_upload_btn").onclick=()=>$("#pf_html_file").click();
  $("#pf_html_file").onchange=()=>{
    const f=$("#pf_html_file").files[0]; if(!f) return;
    const reader=new FileReader();
    reader.onload=()=>{ $("#pf_html_in").value=reader.result; renderPfHtmlPreview(); };
    reader.readAsText(f);
    $("#pf_html_file").value="";
  };

  $("#pf_save").onclick=async()=>{
    const htmlIn=$("#pf_html_in").value;
    if(htmlIn.trim() && !htmlIn.includes("{{share}}")){
      toast(t("pf_html_share_required")); return;
    }
    if(htmlIn.trim() && !htmlIn.includes("{{edit}}")){
      toast(t("pf_html_edit_required")); return;
    }
    try{
      await api("/api/me/profile", j("PUT",{display_name:$("#pf_dn").value.trim(),
        bio:$("#pf_bio_in").value, banner_color:$("#pf_bc").value, accent_color:$("#pf_ac").value,
        avatar:curAvatar, social_links:collectSocialLinks(), profile_html:$("#pf_html_in").value}));
      closeModal(); toast(t("pf_saved")); onSave();
    }catch(e){ toast("Failed: "+e.message); }
  };
}
async function viewImageGen(main){
  const {checkpoints, loras}=await getImagegenOptions();
  const saved=await api("/api/imagegen/standalone").catch(()=>[]);
  const savedGrid=list=>list.length?`<div class="codex-entry-grid">${list.map(s=>`
    <div class="gallery-card" data-iid="${esc(s.id)}">
      <div class="gallery-thumb"><img src="${esc(mediaURL(s.image))}" alt=""></div>
      <div class="gallery-meta"><button class="tool danger" data-act="ig-saved-del">${esc(t("tool_delete"))}</button></div>
    </div>`).join("")}</div>` : `<div class="empty"><div class="big">${esc(t("ig_saved_empty"))}</div></div>`;
  main.innerHTML=`<div class="wrap wrap-wide">
    <div class="page-eyebrow">${esc(t("nav_imagegen"))}</div><h1 class="page">${esc(t("ig_page_title"))}</h1>
    <div class="page-sub">${esc(t("ig_page_sub"))}</div>
    <div class="field-group">
      <div class="field"><label>${esc(t("img_gen_checkpoint"))}</label><div id="ig_ckpt"></div></div>
      <div class="field"><label>${esc(t("img_gen_lora"))}</label><div id="ig_lora"></div></div>
      <div class="field" id="ig_strength_row" style="display:none;margin-bottom:0;"><label>${esc(t("img_gen_strength"))} <span class="hint" id="ig_strength_val">0.8</span></label>
        <input type="range" id="ig_strength" min="0" max="1.5" step="0.05" value="0.8"></div>
    </div>
    <div class="field"><label>${esc(t("img_gen_positive"))}</label>
      <textarea id="ig_positive" class="ig-autosize" rows="2" placeholder="${esc(t("ig_positive_ph"))}"></textarea></div>
    <div class="field"><label>${esc(t("img_gen_negative"))}</label>
      <textarea id="ig_negative" class="ig-autosize" rows="1" placeholder="${esc(t("ig_negative_ph"))}"></textarea></div>
    <div class="actions">
      <button class="btn primary" id="ig_go">${esc(t("ig_generate"))}</button>
    </div>
    <div id="igPreviewWrap" style="display:none;margin:20px 0;">
      <div class="ig-preview-box"><img id="igPreviewImg" alt=""></div>
      <div class="actions" id="igResultActions" style="display:none;">
        <button class="btn primary" id="ig_save">${esc(t("ig_save"))}</button>
        <button class="btn" id="ig_regen">${esc(t("ig_regenerate"))}</button>
        <button class="btn danger" id="ig_discard">${esc(t("ig_discard"))}</button>
      </div>
    </div>
    <div class="section-heading" style="margin-top:34px;">${esc(t("ig_saved_title"))}</div>
    <div id="igSavedGrid">${savedGrid(saved)}</div>
  </div>`;
  const ckptSel=mountCustomSelect($("#ig_ckpt"), checkpoints.map(c=>({value:c,label:c})), {getDesc:describeCheckpoint});
  const loraSel=mountCustomSelect($("#ig_lora"),
    [{value:"",label:t("img_gen_lora_none")}, ...loras.map(l=>({value:l,label:l}))],
    {onChange:v=>{ $("#ig_strength_row").style.display=v?"":"none"; }});
  $("#ig_strength").oninput=()=>{ $("#ig_strength_val").textContent=$("#ig_strength").value; };
  [$("#ig_positive"), $("#ig_negative")].forEach(ta=>{
    ta.addEventListener("input",()=>autosize(ta));
    ta.addEventListener("paste",()=>setTimeout(()=>autosize(ta),0));
    autosize(ta);
  });

  let lastImage=null;
  const runGenerate=async()=>{
    const positive=$("#ig_positive").value.trim();
    if(!positive){ toast(t("ig_positive_ph")); return; }
    const goBtn=$("#ig_go"); goBtn.disabled=true; goBtn.textContent=t("ig_generating");
    $("#igResultActions").style.display="none";
    $("#igPreviewWrap").style.display="";
    const body={positive, negative:$("#ig_negative").value.trim(),
      checkpoint:ckptSel.value, lora:loraSel.value||null, lora_strength:parseFloat($("#ig_strength").value)||0.8};
    try{
      const res=await fetch(API+"/api/imagegen/standalone/stream",{method:"POST",
        headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
      if(!res.ok||!res.body) throw new Error("HTTP "+res.status);
      await sseEvents(res, ev=>{
        if(ev.type==="preview"||ev.type==="done"){ $("#igPreviewImg").src=ev.image; }
        if(ev.type==="done"){ lastImage=ev.image; $("#igResultActions").style.display=""; }
        if(ev.type==="error"){ toast("Image generation failed: "+ev.message); }
      });
    }catch(e){ toast("Image generation failed: "+e.message); }
    goBtn.disabled=false; goBtn.textContent=t("ig_generate");
  };
  $("#ig_go").onclick=runGenerate;
  $("#ig_regen").onclick=runGenerate;
  $("#ig_discard").onclick=()=>{ lastImage=null; $("#igPreviewWrap").style.display="none"; };
  $("#ig_save").onclick=async()=>{
    if(!lastImage) return;
    try{
      await api("/api/imagegen/standalone/save", j("POST",{image:lastImage,
        positive:$("#ig_positive").value.trim(), negative:$("#ig_negative").value.trim()}));
      toast(t("ig_saved_toast"));
      const refreshed=await api("/api/imagegen/standalone").catch(()=>[]);
      $("#igSavedGrid").innerHTML=savedGrid(refreshed);
    }catch(e){ toast(t("ig_save_failed")+": "+e.message); }
  };
  $("#igSavedGrid").addEventListener("click", e=>{
    const btn=e.target.closest("[data-act='ig-saved-del']"); if(!btn) return;
    const card=btn.closest(".gallery-card"); const iid=card.dataset.iid;
    if(btn.dataset.confirming){ return; }
    btn.dataset.confirming="1"; btn.textContent=t("gallery_delete_confirm");
    const timer=setTimeout(()=>{ delete btn.dataset.confirming; btn.textContent=t("tool_delete"); }, 3000);
    btn.onclick=async()=>{
      clearTimeout(timer);
      try{ await api("/api/imagegen/standalone/"+iid,{method:"DELETE"}); card.remove(); }
      catch(err){ toast(t("gallery_delete_failed")+": "+err.message); }
    };
  });
}
async function viewImageGallery(main){
  const images = await api("/api/me/images");
  const bySession = new Map();
  images.forEach(img=>{
    if(!bySession.has(img.sid)) bySession.set(img.sid, []);
    bySession.get(img.sid).push(img);
  });
  const entryHTML=(sid, imgs)=>{
    const first=imgs[0];
    return `<div class="codex-entry">
      <div class="codex-entry-head">
        ${avatar({avatar:first.char_avatar, name:first.char_name}, "codex-entry-ava")}
        <div class="codex-entry-title">
          <a href="#/chat/${esc(sid)}">${esc(first.char_name||t("gallery_open_chat"))}</a>
          <div class="codex-entry-sub">${esc(first.session_title||"")}</div>
        </div>
        <span class="codex-entry-count">${imgs.length}</span>
      </div>
      <div class="codex-entry-grid">${imgs.map(img=>`
        <div class="gallery-card" data-mid="${esc(img.mid)}">
          <div class="gallery-thumb" data-act="gallery-view"><img src="${esc(mediaURL(img.image))}" alt=""></div>
          <div class="gallery-scene" data-act="gallery-view">${esc(img.scene||"")}</div>
          <div class="gallery-meta">
            <button class="tool danger" data-act="gallery-del">${esc(t("tool_delete"))}</button>
          </div>
        </div>`).join("")}</div>
    </div>`;
  };
  const imagesById = new Map(images.map(img=>[img.mid, img]));
  main.innerHTML = `<div class="wrap wrap-wide">
    <div class="page-eyebrow">${esc(t("nav_gallery"))}</div><h1 class="page">${esc(t("gallery_title"))}</h1>
    <div class="page-sub">${esc(t("gallery_sub"))}</div>
    ${bySession.size ? `<div class="codex" id="galleryGrid">${[...bySession.entries()].map(([sid,imgs])=>entryHTML(sid,imgs)).join("")}</div>`
    : `<div class="empty"><div class="big">${esc(t("gallery_empty"))}</div></div>`}
  </div>`;
  $("#galleryGrid")?.addEventListener("click", e=>{
    const viewEl=e.target.closest("[data-act='gallery-view']");
    if(viewEl){ const mid=viewEl.closest(".gallery-card").dataset.mid; const img=imagesById.get(mid); if(img) imageDetailModal(img); return; }
    const btn=e.target.closest("[data-act='gallery-del']"); if(!btn) return;
    const card=btn.closest(".gallery-card"); const mid=card.dataset.mid;
    if(btn.dataset.confirming){ return; }
    btn.dataset.confirming="1"; btn.textContent=t("gallery_delete_confirm");
    const timer=setTimeout(()=>{ delete btn.dataset.confirming; btn.textContent=t("tool_delete"); }, 3000);
    btn.onclick=async()=>{
      clearTimeout(timer);
      try{ await api("/api/me/images/"+mid, {method:"DELETE"}); card.remove(); toast(t("gallery_deleted"));
        if(!card.closest(".codex-entry-grid").children.length) viewImageGallery(main); }
      catch(err){ toast(t("gallery_delete_failed")+": "+err.message); }
    };
  });
}
function imageDetailModal(img){
  const ts = img.image_ts || img.ts;
  const when = ts ? new Date(ts*1000).toLocaleString() : "";
  const tagRow=(tags, cls, label)=>{
    const list=(tags||"").split(",").map(x=>x.trim()).filter(Boolean);
    if(!list.length) return "";
    return `<div class="lore-entry-label">${esc(label)}</div>
      <div class="ig-tags-row ig-tags-row-copy" data-tags="${esc(tags)}">
        <span class="ig-tags-label ${cls==='pos'?'ig-tags-pos':'ig-tags-neg'}">${cls==='pos'?'+':'−'}</span>
        ${list.map(tg=>`<span class="ig-tag ${cls==='pos'?'ig-tag-pos':'ig-tag-neg'}">${esc(tg)}</span>`).join("")}
        <button type="button" class="tool" data-act="copy-tags">${esc(t("gallery_copy_tags"))}</button>
      </div>`;
  };
  openModal(`
    <button class="modal-close" id="idClose">${esc(t("btn_close"))}</button>
    <div class="lore-entry-modal">
      <div class="lore-entry-img"><img src="${esc(mediaURL(img.image))}" alt=""></div>
      <div class="lore-entry-body">
        <div class="lore-entry-eyebrow">${esc(when)}</div>
        <div class="lore-entry-label">${esc(t("gallery_scene_label"))}</div>
        <div class="lore-entry-text md" style="font-style:italic;">${md(img.scene_full||img.scene||"")}</div>
        ${(img.image_positive||img.image_negative) ? `
          ${tagRow(img.image_positive, "pos", t("gallery_positive_label"))}
          ${tagRow(img.image_negative, "neg", t("gallery_negative_label"))}`
        : `<div class="hint" style="margin-top:8px;">${esc(t("gallery_tags_unrecorded"))}</div>`}
      </div>
    </div>`, "modal-wide");
  $("#idClose").onclick=closeModal;
  $(".modal").querySelectorAll("[data-act='copy-tags']").forEach(b=>b.onclick=()=>{
    const tags=b.closest(".ig-tags-row").dataset.tags;
    navigator.clipboard?.writeText(tags).then(()=>toast(t("gallery_tags_copied"))).catch(()=>{});
  });
}
async function viewPersonas(main){
  const render=async()=>{
    const ps=await api("/api/personas");
    main.innerHTML=`<div class="wrap">
      <div class="page-eyebrow">${esc(t("personas_eyebrow"))}</div><h1 class="page">${esc(t("personas_title"))}</h1>
      <div class="page-sub">${esc(t("personas_sub"))}</div>
      <div class="actions"><button class="btn primary" id="addP">+ ${esc(t("btn_new_persona"))}</button></div>
      <div id="plist">${
        ps.length? ps.map(p=>`<div class="lore-entry"><div class="top"><b style="font-family:var(--sans);font-size:16px;color:var(--ink)">${esc(p.name)}</b>${p.is_default?'<span class="badge always">default</span>':""}</div>
          <div class="c">${esc(p.description||"—")}</div>
          <div class="row-tools"><button class="tool" data-edit="${p.id}">edit</button><button class="tool danger" data-del="${p.id}">delete</button></div></div>`).join("")
        : `<div class="empty"><div class="big">${esc(t("empty_personas"))}</div>${esc(t("empty_personas_hint"))}</div>`
      }</div></div>`;
    localizeContent([...main.querySelectorAll("#plist .lore-entry")].map((el,i)=>({
      el:el.querySelector(".c"), text:ps[i]?.description||""})));
    $("#addP").onclick=()=>personaModal(null,render);
    main.querySelectorAll("[data-edit]").forEach(b=>b.onclick=async()=>{ const all=await api("/api/personas"); personaModal(all.find(x=>x.id===b.dataset.edit),render); });
    main.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{ if(await confirmAction(b, "Delete this persona?")){ await api("/api/personas/"+b.dataset.del,{method:"DELETE"}); render(); }});
  };
  render();
}
function personaModal(p, onSave){
  const e=p||{name:"",description:"",is_default:false};
  openModal(`<h3>${esc(p?t("pm_edit"):t("pm_new"))}</h3>
    <div class="field"><label>${esc(t("ed_name"))}</label><input type="text" id="p_name" value="${esc(e.name)}" placeholder="e.g. Alex"></div>
    <div class="field"><label>${esc(t("pm_desc"))} <span class="hint">${esc(t("pm_desc_hint"))}</span></label>
      <textarea id="p_desc" style="min-height:110px">${esc(e.description)}</textarea></div>
    <label class="switch"><input type="checkbox" id="p_def" ${e.is_default?"checked":""}> ${esc(t("pm_default"))}</label>
    <div class="modal-foot"><button class="btn" id="p_cancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="p_save">${esc(t("btn_save"))}</button></div>`);
  $("#p_cancel").onclick=closeModal;
  $("#p_save").onclick=async()=>{
    const body={name:$("#p_name").value.trim()||"You", description:$("#p_desc").value, is_default:$("#p_def").checked};
    if(p) await api("/api/personas/"+p.id, j("PUT",body));
    else await api("/api/personas", j("POST",body));
    closeModal(); toast("Saved."); onSave();
  };
}

/* ============================ LOREBOOK ============================ */
function loreModal(cid, entry, onSave){
  const e=entry||{content:"",keys:[],always:false,global:false,image:"",category:"",hidden:true,name:"",appearance_tags:"",appearance_tags_negative:""};
  let curImage=e.image||"";
  openModal(`<h3>${esc(entry?t("lm_edit"):t("lm_new"))}</h3>
    <div class="field"><label>${esc(t("lm_name"))} <span class="hint">${esc(t("lm_name_hint"))}</span></label>
      <input type="text" id="l_name" value="${esc(e.name||"")}" placeholder="e.g. Maeve"></div>
    <label class="switch"><input type="checkbox" id="l_has_image" ${curImage?"checked":""}> ${esc(t("lm_has_image"))}</label>
    <div class="field" id="lImgField" style="${curImage?"":"display:none;"}"><label>${esc(t("lm_image"))}</label>
      <div class="lore-img-edit" id="lImgEdit">
        ${curImage?`<img class="lore-img-preview" id="lImgPrev" src="${esc(mediaURL(curImage))}" alt="">`:`<div class="lore-img-preview lore-img-empty" id="lImgPrev">▣</div>`}
        <div class="lore-img-actions">
          <button type="button" class="btn" id="lImgPick">${esc(t("ed_upload"))}</button>
          ${curImage?`<button type="button" class="btn danger" id="lImgClear">${esc(t("ed_remove"))}</button>`:""}
          <input type="file" id="lImgFile" accept="image/*" hidden>
        </div>
      </div>
      ${curImage?`<div id="lImgUrlWrap">
        <div class="lore-img-url"><input type="text" id="lImgUrlBox" readonly value="${esc(mediaURL(curImage))}"><button type="button" class="btn" id="lImgUrlCopy">${esc(t("lm_copy_url"))}</button></div>
        <div class="hint">${esc(t("lm_image_url_hint"))}</div>
      </div>`:""}
      <div class="field" style="margin-top:14px;margin-bottom:10px;"><label>${esc(t("lm_appearance_tags"))} <span class="hint">${esc(t("lm_appearance_tags_hint"))}</span></label>
        <textarea id="l_appearance_tags" class="ig-autosize" rows="1" placeholder="${esc(t("lm_appearance_tags_ph"))}">${esc(e.appearance_tags||"")}</textarea></div>
      <div class="field" style="margin-bottom:0;"><label>${esc(t("lm_appearance_tags_negative"))} <span class="hint">${esc(t("lm_appearance_tags_negative_hint"))}</span></label>
        <textarea id="l_appearance_tags_negative" class="ig-autosize" rows="1" placeholder="${esc(t("lm_appearance_tags_negative_ph"))}">${esc(e.appearance_tags_negative||"")}</textarea></div>
    </div>
    <div class="field"><label>${esc(t("lm_category"))} <span class="hint">${esc(t("lm_category_hint"))}</span></label>
      <input type="text" id="l_category" value="${esc(e.category||"")}" placeholder="e.g. Character, Location, Item"></div>
    <div class="field"><label>${esc(t("lm_keys"))} <span class="hint">${esc(t("lm_keys_hint"))}</span></label>
      <input type="text" id="l_keys" value="${esc((e.keys||[]).join(", "))}" placeholder="e.g. the King, royal palace"></div>
    <div class="field"><label>${esc(t("lm_content"))} <span class="hint">${esc(t("lm_content_hint"))}</span></label>
      <textarea id="l_content" style="min-height:130px">${esc(e.content)}</textarea></div>
    <label class="switch"><input type="checkbox" id="l_always" ${e.always?"checked":""}> ${esc(t("lm_always"))}</label>
    <label class="switch"><input type="checkbox" id="l_hidden" ${e.hidden?"checked":""}> ${esc(t("lm_hidden"))}</label>
    ${entry?"":`<label class="switch"><input type="checkbox" id="l_global"> ${esc(t("lm_global"))}</label>`}
    <div class="modal-foot"><button class="btn" id="l_cancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="l_save">${esc(t("btn_save"))}</button></div>`);
  $("#l_cancel").onclick=closeModal;
  [$("#l_appearance_tags"), $("#l_appearance_tags_negative")].forEach(ta=>{
    ta.addEventListener("input",()=>autosize(ta)); autosize(ta);
  });
  const wireImgClear=()=>{ const b=$("#lImgClear"); if(b) b.onclick=()=>{
    curImage=""; $("#lImgPrev").outerHTML=`<div class="lore-img-preview lore-img-empty" id="lImgPrev">▣</div>`; b.remove();
    $("#lImgUrlWrap")?.remove();
  }; };
  wireImgClear();
  $("#l_has_image").onchange=()=>{
    const on=$("#l_has_image").checked;
    $("#lImgField").style.display = on ? "" : "none";
    if(!on){ curImage=""; }
  };
  const wireUrlCopy=()=>{ const b=$("#lImgUrlCopy"); if(b) b.onclick=()=>{
    $("#lImgUrlBox").select();
    navigator.clipboard?.writeText($("#lImgUrlBox").value).then(()=>toast(t("lm_url_copied"))).catch(()=>{});
  }; };
  wireUrlCopy();
  $("#lImgPick").onclick=()=>$("#lImgFile").click();
  $("#lImgFile").onchange=()=>{
    const f=$("#lImgFile").files[0]; if(!f) return;
    if(!cid){ toast("Save the character first, then add lore images."); $("#lImgFile").value=""; return; }
    // openCropper always closes the current modal before its callback runs,
    // so we snapshot the in-progress edits and reopen this modal with them.
    const pending={
      content:$("#l_content").value, keys:$("#l_keys").value.split(",").map(k=>k.trim()).filter(Boolean),
      always:$("#l_always").checked, hidden:$("#l_hidden").checked, category:$("#l_category").value,
      name:$("#l_name").value, global:$("#l_global")?.checked||false,
      appearance_tags:$("#l_appearance_tags")?.value||"",
      appearance_tags_negative:$("#l_appearance_tags_negative")?.value||"",
    };
    openCropper(URL.createObjectURL(f), "1", 512, 512, async blob=>{
      const fd=new FormData(); fd.append("file",blob,"lore.jpg");
      try{ const r=await api(`/api/characters/${cid}/media`,{method:"POST",body:fd});
        toast("Image updated."); loreModal(cid, {...e, ...pending, image:r.url}, onSave); }
      catch(err){ toast("Upload failed: "+err.message); loreModal(cid, {...e, ...pending}, onSave); }
    });
  };
  $("#l_save").onclick=async()=>{
    const body={ content:$("#l_content").value, keys:$("#l_keys").value, always:$("#l_always").checked, hidden:$("#l_hidden").checked, image:curImage, category:$("#l_category").value.trim(), name:$("#l_name").value.trim(), appearance_tags:$("#l_appearance_tags")?.value.trim()||"", appearance_tags_negative:$("#l_appearance_tags_negative")?.value.trim()||"" };
    if(!body.content.trim()){ toast("Content required."); return; }
    if(entry) await api("/api/lore/"+entry.id, j("PUT",body));
    else { body.global=$("#l_global")?.checked||false; await api("/api/characters/"+cid+"/lore", j("POST",body)); }
    closeModal(); toast("Saved."); onSave();
  };
}

function loreEntryModal(cid, entry, canEdit, onChange){
  const renderView=()=>{
    const e2=entry;
    const eyebrow=(e2.category||t("lm_category_default")).toUpperCase();
    const title=e2.name||(e2.keys&&e2.keys[0])||t("doss_lore_untitled");
    const img=mediaURL(e2.image);
    $(".modal").innerHTML=`
      <button class="modal-close" id="leClose">${esc(t("btn_close"))}</button>
      <div class="lore-entry-modal">
        ${img?`<div class="lore-entry-img"><img src="${esc(img)}" alt=""></div>`:""}
        <div class="lore-entry-body">
          <div class="lore-entry-eyebrow">${esc(eyebrow)}</div>
          <h3>${esc(title)}</h3>
          <div class="lore-entry-keys">${(e2.keys||[]).map(k=>`<span class="tag gold">${esc(k)}</span>`).join("")}</div>
          <div class="lore-entry-label">${esc(t("lm_content"))}</div>
          <div class="lore-entry-text"${(e2.hidden&&!canEdit)?' style="font-style:italic;color:var(--muted);"':""}>${(e2.hidden&&!canEdit)?esc(t("lm_hidden_notice")):esc(e2.content)}</div>
          <div class="lore-entry-stats">
            <span>${esc(t("lm_always"))} <b>${e2.always?t("yes"):t("no")}</b></span>
            <span>${esc(t("lm_global"))} <b>${e2.global?t("yes"):t("no")}</b></span>
          </div>
          ${(canEdit && (e2.appearance_tags||e2.appearance_tags_negative))?`
          <details class="stage-editor ig-tags-owner">
            <summary>🎨 ${esc(t("lm_owner_tags_summary"))} <span class="ig-tags-lock" title="${esc(t("lm_owner_tags_lock"))}">🔒</span></summary>
            <p class="hint">${esc(t("lm_owner_tags_hint"))}</p>
            ${e2.appearance_tags?`<div class="ig-tags-row"><span class="ig-tags-label ig-tags-pos">+</span>${e2.appearance_tags.split(",").map(x=>x.trim()).filter(Boolean).map(tg=>`<span class="ig-tag ig-tag-pos">${esc(tg)}</span>`).join("")}</div>`:""}
            ${e2.appearance_tags_negative?`<div class="ig-tags-row"><span class="ig-tags-label ig-tags-neg">−</span>${e2.appearance_tags_negative.split(",").map(x=>x.trim()).filter(Boolean).map(tg=>`<span class="ig-tag ig-tag-neg">${esc(tg)}</span>`).join("")}</div>`:""}
          </details>`:""}
          ${canEdit?`<div class="modal-foot"><button class="btn" id="leEdit">${esc(t("btn_edit"))}</button><button class="btn danger" id="leDel">${esc(t("btn_delete"))}</button></div>`:""}
        </div>
      </div>`;
    $("#leClose").onclick=closeModal;
    if(canEdit){
      $("#leEdit").onclick=()=>loreModal(cid, entry, ()=>{ closeModal(); onChange(); });
      $("#leDel").onclick=async()=>{ if(!(await confirmAction($("#leDel"), "Delete this entry?")))return;
        await api("/api/lore/"+entry.id,{method:"DELETE"}); closeModal(); toast("Deleted."); onChange(); };
    }
  };
  openModal("");
  renderView();
}

/* ============================ MODAL + SETTINGS ============================ */
function openModal(html, extraClass){ const s=$("#scrim"); s.innerHTML=`<div class="modal${extraClass?" "+extraClass:""}">${html}</div>`; s.classList.add("open"); s.onclick=e=>{if(e.target===s)closeModal();}; }
function closeModal(){ $("#scrim").classList.remove("open"); $("#scrim").innerHTML=""; }

/* ---------- lightweight pan/zoom cropper (no external deps) ----------
   Used for local file uploads (avatar/banner) only — canvas.toBlob on a
   remote URL would need CORS and can silently taint the canvas, so pasted
   URLs skip cropping and go straight to the field. */
function openCropper(objectUrl, aspect, outW, outH, onDone){
  openModal(`<h3>${esc(t("crop_title"))}</h3>
    <div class="crop-wrap" style="aspect-ratio:${aspect};"><img id="cropImg" src="${esc(objectUrl)}" draggable="false" alt=""></div>
    <div class="field" style="margin-top:14px;"><label>${esc(t("crop_zoom"))}</label>
      <input type="range" id="cropZoom" min="1" max="3" step="0.01" value="1"></div>
    <div class="modal-foot">
      <button type="button" class="btn" id="cropCancel">${esc(t("btn_cancel"))}</button>
      <button type="button" class="btn primary" id="cropApply">${esc(t("crop_apply"))}</button>
    </div>`);
  const wrap=$(".crop-wrap"), img=$("#cropImg"), zoomEl=$("#cropZoom");
  let scale=1, tx=0, ty=0, natW=0, natH=0, baseScale=1, drag=false, sx=0, sy=0, stx=0, sty=0;
  const clampPan=()=>{
    const ww=wrap.clientWidth, wh=wrap.clientHeight;
    const dw=natW*baseScale*scale, dh=natH*baseScale*scale;
    const maxX=Math.max(0,(dw-ww)/2), maxY=Math.max(0,(dh-wh)/2);
    tx=Math.max(-maxX,Math.min(maxX,tx)); ty=Math.max(-maxY,Math.min(maxY,ty));
  };
  const render=()=>{ clampPan(); img.style.transform=`translate(-50%,-50%) translate(${tx}px,${ty}px) scale(${scale})`; };
  const setup=()=>{
    natW=img.naturalWidth; natH=img.naturalHeight;
    const ww=wrap.clientWidth, wh=wrap.clientHeight;
    baseScale=Math.max(ww/natW, wh/natH);
    img.style.width=natW*baseScale+"px"; img.style.height=natH*baseScale+"px";
    render();
  };
  if(img.complete && img.naturalWidth) setup(); else img.onload=setup;
  img.onpointerdown=e=>{ drag=true; img.setPointerCapture(e.pointerId); sx=e.clientX; sy=e.clientY; stx=tx; sty=ty; img.style.cursor="grabbing"; };
  img.onpointermove=e=>{ if(!drag) return; tx=stx+(e.clientX-sx); ty=sty+(e.clientY-sy); render(); };
  img.onpointerup=img.onpointercancel=()=>{ drag=false; img.style.cursor="grab"; };
  zoomEl.oninput=()=>{ scale=parseFloat(zoomEl.value); render(); };
  $("#cropCancel").onclick=()=>{ URL.revokeObjectURL(objectUrl); closeModal(); };
  $("#cropApply").onclick=()=>{
    const ww=wrap.clientWidth, wh=wrap.clientHeight;
    const dw=natW*baseScale*scale, dh=natH*baseScale*scale;
    const left=(ww-dw)/2+tx, top=(wh-dh)/2+ty;
    const srcScale=1/(baseScale*scale);
    const sxCrop=(0-left)*srcScale, syCrop=(0-top)*srcScale, swCrop=ww*srcScale, shCrop=wh*srcScale;
    const canvas=document.createElement("canvas");
    canvas.width=outW; canvas.height=outH;
    canvas.getContext("2d").drawImage(img, sxCrop, syCrop, swCrop, shCrop, 0, 0, outW, outH);
    canvas.toBlob(blob=>{ URL.revokeObjectURL(objectUrl); closeModal(); onDone(blob); }, "image/jpeg", 0.92);
  };
}

$("#settingsBtn").onclick=async()=>{
  const prevTheme=THEME;
  const isAdmin=ME&&ME.is_admin;
  let st={}, userSt={overrides:{},defaults:{}};
  try{ userSt=await api("/api/me/settings"); }catch(e){ toast("Couldn't load your settings — showing defaults."); }
  if(isAdmin){ try{ st=await api("/api/settings"); }catch(e){ toast("Couldn't load instance settings."); } }
  const uo=userSt.overrides||{}, ud=userSt.defaults||{};
  const a=APPEARANCE||{};
  const f=(id,label,val,hint="")=>`<div class="field" style="margin:0 0 12px"><label>${label}${hint?` <span class="hint">${hint}</span>`:""}</label><input type="text" id="${id}" value="${esc(val??"")}"></div>`;
  const row=(...items)=>`<div style="display:grid;grid-template-columns:repeat(${items.length},1fr);gap:10px">${items.join("")}</div>`;
  const sf=(id,label,val,{min=0,max=1,step=0.01,hint="",fallback=0}={})=>{
    const has=val!==""&&val!==null&&val!==undefined;
    const rangeVal=has?val:fallback;
    return `<div class="field slider-field"><label>${label}${hint?` <span class="hint">${hint}</span>`:""}</label>
      <div class="slider-row">
        <input type="range" class="sf-range" data-target="${id}" min="${min}" max="${max}" step="${step}" value="${rangeVal}">
        <input type="number" id="${id}" class="sf-num" min="${min}" max="${max}" step="${step}" value="${has?esc(val):""}" placeholder="${has?"":rangeVal}">
      </div></div>`;
  };
  const sliderGrid=(...items)=>`<div class="slider-grid">${items.join("")}</div>`;
  const colorField=(id,label,val,placeholder)=>{
    const isHex=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(val||"");
    return `<div class="field ap-color-field" style="margin:0 0 12px">
      <label>${label}</label>
      <div class="ap-color-controls">
        <input type="text" id="${id}" value="${esc(val||"")}" placeholder="${placeholder}">
        <button type="button" class="ap-swatch ap-color-picker" data-for="${id}" style="background:${isHex?esc(val):"#E3BD6C"}"></button>
      </div>
    </div>`;
  };
  const styleToggles=(cat,flagsVal,defaults)=>{
    const flags=flagsVal!==undefined&&flagsVal!==null?flagsVal:defaults;
    const btn=(letter,label,title)=>`<button type="button" class="style-toggle-btn${flags.includes(letter)?" on":""}" data-flag="${letter}" title="${title}">${label}</button>`;
    return `<div class="style-toggle-group" data-category="${cat}" data-default="${esc(defaults)}">
      ${btn("i","I","Italic")}${btn("b","B","Bold")}${btn("u","U","Underline")}${btn("s","S","Strikethrough")}
    </div>`;
  };
  const styleRow=(fontId,colorId,label,fontVal,colorVal,colorDflt,cat,catFlags,catDefaults)=>`<div class="field ap-style-row" style="margin:0 0 14px">
    <label>${label}</label>
    <div class="ap-style-controls">
      <input type="text" class="ap-style-font" id="${fontId}" value="${esc(fontVal||"")}" placeholder="default">
      ${styleToggles(cat,catFlags,catDefaults)}
      <button type="button" class="ap-swatch" id="${colorId}" data-default="${esc(colorDflt)}" data-value="${esc(colorVal||colorDflt)}" style="background:${esc(colorVal||colorDflt)}"></button>
    </div>
  </div>`;
  const hasOwnEndpoint=!!uo.base_url;

  const kobold="http://koboldcpp:5001/v1";
  const worldLangOptions=worldLanguages().map(n=>`<option value="${esc(n)}">`).join("");

  const generalTab=`
    <div class="field"><label data-i18n="settings_theme">${esc(t("settings_theme"))}</label>
      <div class="seg" id="themeSeg">
        <button class="seg-btn ${THEME!=="dark"?"on":""}" data-theme="light"><b data-i18n="theme_light">${esc(t("theme_light"))}</b><span data-i18n="theme_light_hint">${esc(t("theme_light_hint"))}</span></button>
        <button class="seg-btn ${THEME==="dark"?"on":""}" data-theme="dark"><b data-i18n="theme_dark">${esc(t("theme_dark"))}</b><span data-i18n="theme_dark_hint">${esc(t("theme_dark_hint"))}</span></button>
      </div>
    </div>
    <h3 class="sec" style="margin-top:0;border-top:none;padding-top:0;">🌐 <span data-i18n="settings_language_heading">${esc(t("settings_language_heading"))}</span></h3>
    <div class="field" style="margin:0 0 12px"><label><span data-i18n="settings_iface_lang">${esc(t("settings_iface_lang"))}</span> <span class="hint" data-i18n="settings_iface_lang_hint">${esc(t("settings_iface_lang_hint"))}</span></label>
      <input type="text" id="u_iface_lang" list="ifaceLangList" value="${esc(uo.interface_language||"")}" placeholder="English" autocomplete="off">
      <datalist id="ifaceLangList">${worldLangOptions}</datalist></div>
    <h3 class="sec">${esc(t("ap_title"))}</h3>
    <div class="field"><label>${esc(t("ap_font"))} <span class="hint">${esc(t("ap_font_hint_pre"))}<a class="hint-link" href="https://fonts.google.com" target="_blank" rel="noopener noreferrer">${esc(t("ap_font_hint_link"))}</a>${esc(t("ap_font_hint_post"))}</span></label>
      <input type="text" id="ap_font" value="${esc(a.font||"")}" placeholder="default"></div>
    ${row(colorField("ap_text",t("ap_text"),a.text,"default"), colorField("ap_accent",t("ap_accent"),a.accent,"default"),
          `<div class="field" style="margin:0 0 12px"><label>${esc(t("ap_size"))}</label><input type="text" id="ap_scale" value="${esc(a.scale||"")}" placeholder="16"></div>`)}
    ${row(colorField("ap_appbg",t("ap_appbg"),a.appBg,"default"), colorField("ap_chatbg",t("ap_chatbg"),a.chatBg,"default"))}
    <div style="margin-top:10px;margin-bottom:20px;"><button class="btn" id="ap_reset" type="button">${esc(t("ap_reset"))}</button></div>
    <h3 class="sec">${esc(t("ap_md_title"))}</h3>
    <div class="ap-md-layout">
      <div class="ap-md-controls">
        <div class="field" style="margin:0 0 16px"><label>${esc(t("ap_msgfont"))}</label>
          <input type="text" id="ap_msgfont" value="${esc(a.msgFont||"")}" placeholder="Aptos">
          <span class="hint">${esc(t("ap_msgfont_hint_pre"))}<a class="hint-link" href="https://fonts.google.com" target="_blank" rel="noopener noreferrer">${esc(t("ap_msgfont_hint_link"))}</a>${esc(t("ap_msgfont_hint_post"))}</span></div>
        ${styleRow("ap_narration_font","ap_narration",t("ap_narration"),a.narrationFont,a.narrationColor,"#E3BD6C","narration",a.narrationFlags,"i")}
        ${styleRow("ap_dialogue_font","ap_dialogue",t("ap_dialogue"),a.dialogueFont,a.dialogueColor,"#E3BD6C","dialogue",a.dialogueFlags,"")}
        ${styleRow("ap_thoughts_font","ap_thoughts",t("ap_thoughts"),a.thoughtFont,a.thoughtColor,"#E3BD6C","thought",a.thoughtFlags,"")}
        ${styleRow("ap_voice_font","ap_voice",t("ap_voice"),a.voiceFont,a.voiceColor,"#E3BD6C","voice",a.voiceFlags,"ib")}
        ${styleRow("ap_bold_font","ap_bold",t("ap_bold"),a.boldFont,a.boldColor,"#E3BD6C","bold",a.boldFlags,"b")}
      </div>
      <div class="ap-md-preview">
        <div class="ap-preview-label">${esc(t("ap_preview"))}</div>
        <div class="ap-preview-card md" id="apPreview">${md(AP_PREVIEW_TEXT)}</div>
      </div>
    </div>`;

  const modelTab=`
    <h3 class="sec" style="margin-top:0;border-top:none;padding-top:0;" data-i18n="settings_llm_endpoint">${esc(t("settings_llm_endpoint"))}</h3>
    <label class="switch" style="margin-bottom:14px;"><input type="checkbox" id="u_use_own" ${hasOwnEndpoint?"checked":""}> <span data-i18n="settings_use_own_endpoint">${esc(t("settings_use_own_endpoint"))}</span></label>
    <div id="u_own_fields" style="display:${hasOwnEndpoint?"block":"none"}">
      <div class="ep-group">
        <div class="ep-group-head">${esc(t("set_chat"))}</div>
        <div class="field"><label>${esc(t("set_base_url"))}</label>
          <input type="text" id="u_base" value="${esc(uo.base_url||"")}" placeholder="${esc(ud.base_url||kobold)}"></div>
        <div class="field"><label>${esc(t("set_api_key"))} <span class="hint">${esc(t("set_optional"))}</span></label>
          <input type="password" id="u_key" value="" placeholder="${uo.has_api_key?t("set_keep"):t("set_none")}"></div>
        <div class="field"><label>${esc(t("set_model"))}</label>
          <div style="display:flex;gap:8px;">
            <input type="text" id="u_chat" value="${esc(uo.chat_model||"")}" placeholder="${esc(ud.chat_model||"")}" style="flex:1">
            <button class="btn" id="u_fetch" type="button">${esc(t("set_fetch"))}</button></div>
          <div id="u_model_list" style="display:none;margin-top:6px;display:none;flex-wrap:wrap;gap:6px;"></div></div>
      </div>
      <p class="hint" style="margin:4px 0 0;">${esc(t("set_embed_shared_hint"))}</p>
    </div>
    <div class="settings-row">
      <div class="field" style="margin:0"><label><span data-i18n="settings_past_messages">${esc(t("settings_past_messages"))}</span> <span class="hint" data-i18n="settings_past_messages_hint">${esc(t("settings_past_messages_hint"))}</span></label>
        <input type="text" id="u_hist" value="${uo.history_turns??""}" placeholder="${ud.history_turns||16}"></div>
      <div class="field" style="margin:0"><label><span data-i18n="settings_max_tokens">${esc(t("settings_max_tokens"))}</span> <span class="hint" data-i18n="settings_max_tokens_hint">${esc(t("settings_max_tokens_hint"))}</span></label>
        <input type="text" id="u_max" value="${uo.max_tokens??""}" placeholder="${ud.max_tokens||4096}"></div>
    </div>
    <label class="switch" style="margin-bottom:10px;margin-top:12px;"><input type="checkbox" id="u_think" ${(uo.enable_thinking!==undefined?uo.enable_thinking:ud.enable_thinking)?"checked":""}> <span data-i18n="settings_thinking_default">${esc(t("settings_thinking_default"))}</span></label>
    <label class="switch" style="margin-bottom:16px;"><input type="checkbox" id="u_scene" ${(uo.scene_style!==undefined?uo.scene_style:ud.scene_style)?"checked":""}> ${esc(t("settings_scene"))} <span class="hint">${esc(t("settings_scene_hint"))}</span></label>`;

  const advancedTab=`
    <div style="font-size:12px;margin:0 0 14px;color:var(--muted);">${esc(t("set_inherit"))}</div>
    ${sliderGrid(
      sf("u_temp",t("samp_temp"),uo.temperature??"",{min:0,max:2,step:0.01,fallback:ud.temperature??0.85}),
      sf("u_topp","Top-p",uo.top_p??"",{min:0,max:1,step:0.01,fallback:ud.top_p??0.9}),
      sf("u_topk","Top-k",uo.top_k??"",{min:0,max:100,step:1,fallback:ud.top_k??0}),
      sf("u_minp","Min-p",uo.min_p??"",{min:0,max:1,step:0.01,fallback:ud.min_p??0}),
      sf("u_topa","Top-a",uo.top_a??"",{min:0,max:1,step:0.01,fallback:ud.top_a??0}),
      sf("u_typ","Typical-p",uo.typical_p??"",{min:0,max:1,step:0.01,fallback:ud.typical_p??1}),
      sf("u_rep",t("samp_rep"),uo.repetition_penalty??"",{min:0.5,max:2,step:0.01,fallback:ud.repetition_penalty??1}),
      sf("u_freq",t("samp_freq"),uo.frequency_penalty??"",{min:0,max:2,step:0.01,fallback:ud.frequency_penalty??0}),
      sf("u_pres",t("samp_pres"),uo.presence_penalty??"",{min:0,max:2,step:0.01,fallback:ud.presence_penalty??0}),
    )}
    ${row(f("u_seed",t("samp_seed"),uo.seed??"",t("samp_seed_hint")))}
    <div class="field" style="margin:0 0 16px"><label>${esc(t("samp_stop"))} <span class="hint">${esc(t("samp_stop_hint"))}</span></label><textarea id="u_stop" style="min-height:52px;font-family:var(--mono);font-size:12.5px">${esc((uo.stop||[]).join("\n"))}</textarea></div>
    <h3 class="sec" data-i18n="settings_prompt_injection">${esc(t("settings_prompt_injection"))}</h3>
    <div class="field"><label>${esc(t("set_suffix"))} <span class="hint">${esc(t("set_suffix_hint"))}</span></label>
      <textarea id="u_suffix" style="min-height:68px">${esc(uo.system_suffix||"")}</textarea></div>
    <div class="field" style="margin:0"><label>${esc(t("set_posthist"))} <span class="hint">${esc(t("set_posthist_hint"))}</span></label>
      <textarea id="u_posthist" style="min-height:68px">${esc(uo.post_history||"")}</textarea></div>`;

  const adminTab=isAdmin?`
    <h3 class="sec" style="margin-top:0;border-top:none;padding-top:0;">${esc(t("set_global"))} <span class="hint" style="font-size:12px;font-weight:400;">${esc(t("set_global_hint"))}</span></h3>
    <div class="field"><label>${esc(t("set_deflang"))} <span class="hint">${esc(t("set_deflang_hint"))}</span></label>
      <input type="text" id="s_deflang" list="ifaceLangList" value="${esc(st.default_language||"English")}" placeholder="English" autocomplete="off"></div>
    <div class="ep-group">
      <div class="ep-group-head">${esc(t("set_chat_ep"))}</div>
      <div class="field"><label>${esc(t("set_base_url"))}</label>
        <input type="text" id="s_base" value="${esc(st.base_url||"")}" placeholder="${kobold}"></div>
      <div class="field"><label>API key <span class="hint">${st.has_api_key?t("set_keep"):t("set_optional")}</span></label>
        <input type="password" id="s_key" value="" placeholder="${st.has_api_key?"••••••••":"(none)"}"></div>
      <div class="field" style="margin:0"><label>${esc(t("set_model"))}</label>
        <div style="display:flex;gap:8px;">
          <input type="text" id="s_chat" value="${esc(st.chat_model||"")}" style="flex:1">
          <button class="btn" id="s_fetch" type="button">${esc(t("set_fetch"))}</button></div>
        <div id="s_model_list" style="display:none;margin-top:6px;flex-wrap:wrap;gap:6px;"></div>
      </div>
    </div>
    <div class="ep-group">
      <div class="ep-group-head">${esc(t("set_embed_ep"))} <span class="hint" style="text-transform:none;letter-spacing:0;font-size:11px;">${esc(t("set_blank_reuse"))}</span></div>
      <div class="field"><label>${esc(t("set_base_url"))} <span class="hint">${esc(t("set_ollama_hint"))}</span></label>
        <input type="text" id="s_embedbase" value="${esc(st.embed_base_url||"")}" placeholder="${esc(t("set_blank_same"))}"></div>
      <div class="field"><label>API key <span class="hint">${st.has_embed_api_key?t("set_keep"):t("set_optional")}</span></label>
        <input type="password" id="s_ekey" value="" placeholder="${st.has_embed_api_key?"••••••••":"(none)"}"></div>
      <div class="field"><label>${esc(t("set_embed_dim"))} <span class="hint">${esc(t("set_embed_dim_hint"))}</span></label>
        <input type="text" id="s_dim" value="${st.embed_dim??768}"></div>
      <div class="field" style="margin:0"><label>${esc(t("set_model"))}</label>
        <div style="display:flex;gap:8px;">
          <input type="text" id="s_embed_model" value="${esc(st.embed_model||"")}" placeholder="nomic-embed-text" style="flex:1">
          <button class="btn" id="s_testembed" type="button">${esc(t("set_test"))}</button></div>
      </div>
    </div>
    <div class="ep-group">
      <div class="ep-group-head">${esc(t("set_comfy_ep"))}</div>
      <div class="field"><label>${esc(t("set_base_url"))}</label>
        <input type="text" id="s_comfy_url" value="${esc(st.comfyui_url||"")}" placeholder="http://comfyui:8188"></div>
      <div class="field" style="margin:0"><label>${esc(t("set_comfy_checkpoint"))} <span class="hint">${esc(t("set_comfy_checkpoint_hint"))}</span></label>
        <input type="text" id="s_comfy_ckpt" value="${esc(st.comfyui_checkpoint||"")}"></div>
    </div>
    <div class="settings-row">
      <div class="field" style="margin:0"><label>${esc(t("settings_past_messages"))} <span class="hint">${esc(t("settings_past_messages_hint"))}</span></label>
        <input type="text" id="s_hist" value="${st.history_turns??16}"></div>
      <div class="field" style="margin:0"><label>${esc(t("settings_max_tokens"))} <span class="hint">${esc(t("settings_max_tokens_hint"))}</span></label>
        <input type="text" id="s_max" value="${st.max_tokens??4096}"></div>
    </div>
    <label class="switch" style="margin-bottom:16px;margin-top:12px;"><input type="checkbox" id="s_think" ${st.enable_thinking?"checked":""}> ${esc(t("settings_thinking_default"))}</label>
    <h3 class="sec">${esc(t("settings_advanced_sampling"))}</h3>
    <div style="font-size:12px;margin:0 0 14px;color:var(--muted);">${esc(t("set_sent_note"))}</div>
    ${sliderGrid(
      sf("s_temp",t("samp_temp"),st.temperature??0.85,{min:0,max:2,step:0.01,fallback:0.85}),
      sf("s_topp","Top-p",st.top_p??0.9,{min:0,max:1,step:0.01,fallback:0.9}),
      sf("s_topk","Top-k",st.top_k??0,{min:0,max:100,step:1,fallback:0}),
      sf("s_minp","Min-p",st.min_p??0,{min:0,max:1,step:0.01,fallback:0}),
      sf("s_topa","Top-a",st.top_a??0,{min:0,max:1,step:0.01,fallback:0}),
      sf("s_typ","Typical-p",st.typical_p??1,{min:0,max:1,step:0.01,fallback:1}),
      sf("s_rep",t("samp_rep"),st.repetition_penalty??1,{min:0.5,max:2,step:0.01,fallback:1}),
      sf("s_freq",t("samp_freq"),st.frequency_penalty??0,{min:0,max:2,step:0.01,fallback:0}),
      sf("s_pres",t("samp_pres"),st.presence_penalty??0,{min:0,max:2,step:0.01,fallback:0}),
      sf("s_tfs","TFS",st.tfs??1,{min:0,max:1,step:0.01,fallback:1}),
      sf("s_smooth","Smoothing",st.smoothing_factor??0,{min:0,max:5,step:0.01,fallback:0}),
      sf("s_reprange","Rep. range",st.repetition_penalty_range??0,{min:0,max:2048,step:16,fallback:0}),
      sf("s_dlow","DynaTemp low",st.dynatemp_low??0,{min:0,max:2,step:0.01,fallback:0}),
      sf("s_dhigh","DynaTemp high",st.dynatemp_high??0,{min:0,max:2,step:0.01,fallback:0}),
      sf("s_mtau","Mirostat τ",st.mirostat_tau??5,{min:0,max:10,step:0.1,fallback:5}),
      sf("s_meta","Mirostat η",st.mirostat_eta??0.1,{min:0,max:1,step:0.01,fallback:0.1}),
      sf("s_drym","DRY mult.",st.dry_multiplier??0,{min:0,max:5,step:0.01,fallback:0}),
      sf("s_dryb","DRY base",st.dry_base??1.75,{min:0,max:3,step:0.01,fallback:1.75}),
      sf("s_dryl","DRY len",st.dry_allowed_length??2,{min:0,max:50,step:1,fallback:2}),
      sf("s_xtct","XTC threshold",st.xtc_threshold??0.1,{min:0,max:1,step:0.01,fallback:0.1}),
      sf("s_xtcp","XTC prob.",st.xtc_probability??0,{min:0,max:1,step:0.01,fallback:0}),
    )}
    ${row(f("s_miro","Mirostat mode",st.mirostat_mode??0,"0/1/2"), f("s_seed",t("samp_seed"),st.seed??-1,t("samp_seed_hint")))}
    <div class="field" style="margin:16px 0 12px"><label>${esc(t("samp_stop"))} <span class="hint">${esc(t("samp_stop_hint"))}</span></label>
      <textarea id="s_stop" style="min-height:52px;font-family:var(--mono);font-size:12.5px">${esc((st.stop||[]).join("\n"))}</textarea></div>
    <div class="field" style="margin:0 0 16px"><label>${esc(t("set_extra_fields"))} <span class="hint">JSON</span></label>
      <textarea id="s_extra" style="min-height:52px;font-family:var(--mono);font-size:12.5px">${esc(Object.keys(st.extra_params||{}).length?JSON.stringify(st.extra_params,null,2):"")}</textarea></div>
    <h3 class="sec">${esc(t("settings_prompt_injection"))}</h3>
    <div class="field"><label>${esc(t("set_suffix"))} <span class="hint">${esc(t("set_suffix_hint"))}</span></label>
      <textarea id="s_suffix" style="min-height:72px">${esc(st.system_suffix||"")}</textarea></div>
    <div class="field" style="margin:0 0 16px"><label>${esc(t("set_posthist"))} <span class="hint">${esc(t("set_posthist_hint"))}</span></label>
      <textarea id="s_posthist" style="min-height:72px">${esc(st.post_history||"")}</textarea></div>
    <h3 class="sec">${esc(t("set_backend"))}</h3>
    <div class="field" style="margin:0"><label>${esc(t("set_backend_url"))} <span class="hint">${esc(t("set_backend_hint"))}</span></label>
      <input type="text" id="s_api" value="${esc(API)}" placeholder="(same origin)"></div>`:"";

  openModal(`<h3 data-i18n="settings_title">${esc(t("settings_title"))}</h3>
    <div class="set-tabs" id="setTabs">
      <button type="button" class="set-tab on" data-tab="general">${esc(t("settings_tab_general"))}</button>
      <button type="button" class="set-tab" data-tab="model">${esc(t("settings_tab_model"))}</button>
      <button type="button" class="set-tab" data-tab="advanced">${esc(t("settings_tab_advanced"))}</button>
      ${isAdmin?`<button type="button" class="set-tab" data-tab="admin">${esc(t("settings_tab_admin"))}</button>`:""}
    </div>
    <div class="set-panel" data-panel="general">${generalTab}</div>
    <div class="set-panel" data-panel="model" style="display:none">${modelTab}</div>
    <div class="set-panel" data-panel="advanced" style="display:none">${advancedTab}</div>
    ${isAdmin?`<div class="set-panel" data-panel="admin" style="display:none">${adminTab}</div>`:""}
    <div class="modal-foot" id="footUser" style="margin-top:16px;">
      <button class="btn primary" id="u_save" data-i18n="btn_save_settings">${esc(t("btn_save_settings"))}</button>
      <button class="btn danger" id="u_reset" data-i18n="btn_reset_defaults">${esc(t("btn_reset_defaults"))}</button>
      <button class="btn" id="s_cancel" style="margin-left:auto;" data-i18n="btn_close">${esc(t("btn_close"))}</button>
    </div>
    ${isAdmin?`<div class="modal-foot" id="footAdmin" style="margin-top:10px;display:none;">
      <button class="btn" id="s_cancel_global">Cancel</button>
      <button class="btn primary" id="s_save_global">${esc(t("set_save_global"))}</button>
    </div>`:""}`, "modal-wide");

  $("#setTabs").querySelectorAll(".set-tab").forEach(b=>b.onclick=()=>{
    $("#setTabs").querySelectorAll(".set-tab").forEach(x=>x.classList.toggle("on",x===b));
    document.querySelectorAll(".set-panel").forEach(p=>p.style.display=p.dataset.panel===b.dataset.tab?"block":"none");
    const footAdmin=$("#footAdmin"); if(footAdmin) footAdmin.style.display=b.dataset.tab==="admin"?"flex":"none";
  });

  document.querySelectorAll(".sf-range").forEach(r=>{
    const numEl=document.getElementById(r.dataset.target);
    if(!numEl) return;
    r.addEventListener("input",()=>{ numEl.value=r.value; numEl.dispatchEvent(new Event("input")); });
    numEl.addEventListener("input",()=>{ const v=parseFloat(numEl.value); if(!isNaN(v)) r.value=v; });
  });

  attachLangAC($("#u_iface_lang")); attachLangAC($("#s_deflang"));
  ["ap_font","ap_msgfont","ap_narration_font","ap_dialogue_font","ap_thoughts_font","ap_voice_font","ap_bold_font"]
    .forEach(id=>attachFontAC($("#"+id)));
  $("#themeSeg").querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{ applyTheme(b.dataset.theme);
    $("#themeSeg").querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("on",x===b)); });

  const AP_FIELDS=["ap_font","ap_text","ap_accent","ap_scale","ap_appbg","ap_chatbg","ap_msgfont",
    "ap_narration_font","ap_dialogue_font","ap_thoughts_font","ap_voice_font","ap_bold_font"];
  const readFlags=cat=>{
    const grp=document.querySelector(`.style-toggle-group[data-category="${cat}"]`);
    if(!grp) return undefined;
    return [...grp.querySelectorAll(".style-toggle-btn.on")].map(b=>b.dataset.flag).join("");
  };
  const swatchVal=id=>$("#"+id)?.dataset.value;
  const liveAppearance=()=>saveAppearance({ font:$("#ap_font")?.value.trim(), text:$("#ap_text")?.value.trim(),
    accent:$("#ap_accent")?.value.trim(), scale:$("#ap_scale")?.value.trim(),
    appBg:$("#ap_appbg")?.value.trim(), chatBg:$("#ap_chatbg")?.value.trim(),
    msgFont:$("#ap_msgfont")?.value.trim(),
    narrationColor:swatchVal("ap_narration"), narrationFont:$("#ap_narration_font")?.value.trim(), narrationFlags:readFlags("narration"),
    dialogueColor:swatchVal("ap_dialogue"), dialogueFont:$("#ap_dialogue_font")?.value.trim(), dialogueFlags:readFlags("dialogue"),
    thoughtColor:swatchVal("ap_thoughts"), thoughtFont:$("#ap_thoughts_font")?.value.trim(), thoughtFlags:readFlags("thought"),
    voiceColor:swatchVal("ap_voice"), voiceFont:$("#ap_voice_font")?.value.trim(), voiceFlags:readFlags("voice"),
    boldColor:swatchVal("ap_bold"), boldFont:$("#ap_bold_font")?.value.trim(), boldFlags:readFlags("bold") });
  AP_FIELDS.forEach(id=>{ const el=$("#"+id); if(el) el.addEventListener("input",liveAppearance); });
  document.querySelectorAll(".style-toggle-btn").forEach(b=>b.onclick=()=>{ b.classList.toggle("on"); liveAppearance(); });
  document.querySelectorAll(".ap-swatch").forEach(sw=>{
    sw.addEventListener("click",()=>{
      const target=sw.dataset.for?document.getElementById(sw.dataset.for):null;
      const current=sw.dataset.value || target?.value || sw.dataset.default || "#E3BD6C";
      openColorPicker(sw, current, hex=>{
        sw.style.background=hex;
        if(target){ target.value=hex; target.dispatchEvent(new Event("input")); }
        else { sw.dataset.value=hex; liveAppearance(); }
      });
    });
  });
  const resetAppearance=()=>{
    APPEARANCE={}; store.set("appearance","{}"); applyAppearance();
    AP_FIELDS.forEach(id=>{ const e=$("#"+id); if(e) e.value=""; });
    document.querySelectorAll(".style-toggle-group").forEach(g=>{
      const def=g.dataset.default||"";
      g.querySelectorAll(".style-toggle-btn").forEach(b=>b.classList.toggle("on", def.includes(b.dataset.flag)));
    });
    document.querySelectorAll(".ap-swatch[data-default]").forEach(sw=>{ sw.dataset.value=sw.dataset.default; sw.style.background=sw.dataset.default; });
    document.querySelectorAll(".ap-color-picker").forEach(sw=>{ sw.style.background="#E3BD6C"; });
  };
  $("#ap_reset").onclick=resetAppearance;

  // Toggle own endpoint visibility
  const useOwn=$("#u_use_own"), ownFields=$("#u_own_fields");
  if(useOwn&&ownFields) useOwn.onchange=()=>{ ownFields.style.display=useOwn.checked?"block":"none"; };

  const fillModelList=(listId, inputId, models, hint)=>{
    const el=$("#"+listId);
    if(!el) return;
    const hintHtml=hint?`<span style="font-size:11px;color:var(--muted);align-self:center;">${esc(hint)}</span>`:"";
    el.innerHTML=`<button class="model-pill-close" type="button" title="Dismiss">×</button>${hintHtml}`
      +models.map(m=>`<button class="model-pill" type="button">${esc(m)}</button>`).join("");
    el.style.display="flex";
    el.querySelector(".model-pill-close").onclick=()=>{ el.style.display="none"; };
    el.querySelectorAll(".model-pill").forEach(p=>p.onclick=()=>{
      const inp=$("#"+inputId); if(inp){ inp.value=p.textContent; inp.dispatchEvent(new Event("input")); }
      el.style.display="none";
    });
  };

  // Fetch models for user's own endpoint
  const uFetch=$("#u_fetch");
  if(uFetch) uFetch.onclick=async()=>{
    uFetch.textContent="…";
    try{
      const base=$("#u_base")?.value.trim()||ud.base_url||"";
      const key=$("#u_key")?.value.trim()||"";
      const params=new URLSearchParams(); if(base) params.set("base_url",base); if(key) params.set("api_key",key);
      const {models}=await api("/api/models"+(params.toString()?"?"+params:""));
      if(models?.length) fillModelList("u_model_list","u_chat",models);
      else toast("No models returned");
    }catch(e){ toast("Fetch failed: "+e.message); }
    uFetch.textContent="Fetch";
  };

  // Per-user save
  $("#u_save").onclick=async()=>{
    const numOrNull=id=>{ const v=parseFloat($("#"+id)?.value??""); return isNaN(v)?null:v; };
    const intOrNull=id=>{ const v=parseInt($("#"+id)?.value??""  ,10); return isNaN(v)?null:v; };
    const body={
      history_turns:intOrNull("u_hist"), max_tokens:intOrNull("u_max"),
      enable_thinking:!!($("#u_think")?.checked),
      scene_style:!!($("#u_scene")?.checked),
      temperature:numOrNull("u_temp"), top_p:numOrNull("u_topp"), top_k:intOrNull("u_topk"),
      min_p:numOrNull("u_minp"), top_a:numOrNull("u_topa"), typical_p:numOrNull("u_typ"),
      repetition_penalty:numOrNull("u_rep"), frequency_penalty:numOrNull("u_freq"),
      presence_penalty:numOrNull("u_pres"), seed:intOrNull("u_seed"),
      stop:(()=>{ const v=($("#u_stop")?.value||"").split("\n").map(s=>s.trim()).filter(Boolean); return v.length?v:null; })(),
      system_suffix:$("#u_suffix")?.value.trim()||null,
      post_history:$("#u_posthist")?.value.trim()||null,
      interface_language:$("#u_iface_lang")?.value.trim()||null,
    };
    if($("#u_use_own")?.checked){
      body.base_url=$("#u_base")?.value.trim()||null;
      body.chat_model=$("#u_chat")?.value.trim()||null;
      const k=$("#u_key")?.value; if(k) body.api_key=k;
    } else {
      body.base_url=null; body.chat_model=null;
      body.api_key=null;
    }
    try{
      await api("/api/me/settings",j("PUT",body));
      document.querySelectorAll("#s_model_list,#u_model_list").forEach(el=>el.style.display="none");
      closeModal();
      const _newLang=await effectiveUiLang(body.interface_language||"");
      if(_newLang.toLowerCase()!==(store.get("iface_lang","")||"english").toLowerCase()
         && !(_newLang.toLowerCase()==="english" && !store.get("iface_lang",""))){
        // language changed: hard-reload so every view, cached content string, and
        // chrome re-renders in the new language — no half-translated UI
        store.set("iface_lang", _newLang.toLowerCase()==="english"?"":_newLang);
        location.reload(); return;
      }
      toast("Settings saved.");
      loadUiTranslations(_newLang);
    }catch(e){ toast("Save failed: "+e.message); }
  };

  // Per-user reset
  $("#u_reset").onclick=()=>{
    confirmPopover($("#u_reset"), "Reset all your personal settings (including appearance and message formatting) to defaults?", t("btn_reset_defaults"), async()=>{
      try{
        await api("/api/me/settings",{method:"DELETE"}); resetAppearance(); closeModal();
        const _newLang=await effectiveUiLang("");
        if(_newLang.toLowerCase()!==(store.get("iface_lang","")||"english").toLowerCase()){
          store.set("iface_lang", _newLang.toLowerCase()==="english"?"":_newLang);
          location.reload(); return;
        }
        toast("Settings reset to defaults."); loadUiTranslations(_newLang);
      }
      catch(e){ toast("Reset failed: "+e.message); }
    });
  };

  // Admin-only handlers
  if(isAdmin){
    $("#s_fetch").onclick=async()=>{
      const btn=$("#s_fetch"); btn.textContent="…";
      try{
        const base=$("#s_base")?.value.trim()||"";
        const key=$("#s_key")?.value.trim()||"";
        const params=new URLSearchParams(); if(base) params.set("base_url",base); if(key) params.set("api_key",key);
        const {models}=await api("/api/models"+(params.toString()?"?"+params:""));
        if(models?.length) fillModelList("s_model_list","s_chat",models);
        else toast("No models returned");
      }catch(e){ toast("Fetch failed: "+e.message); }
      btn.textContent="Fetch";
    };
    const stEmbed=$("#s_testembed");
    if(stEmbed) stEmbed.onclick=async()=>{
      stEmbed.textContent="…";
      try{
        const testBody={embed_base_url:$("#s_embedbase")?.value.trim(),embed_model:$("#s_embed_model")?.value.trim()};
        const ek=$("#s_ekey")?.value; if(ek) testBody.embed_api_key=ek;
        await api("/api/settings",j("PUT",testBody));
        const r=await api("/api/settings/test-embed",{method:"POST"});
        if(r.ok) toast(`✓ Embeddings OK (${r.dim} dims) at ${r.url}`);
        else toast(`✗ ${r.error}`);
      }catch(e){ toast("Test failed: "+e.message); }
      stEmbed.textContent="Test";
    };
    const sSave=$("#s_save_global");
    if(sSave) sSave.onclick=async()=>{
      const num=(id,fb)=>{ const v=parseFloat($("#"+id)?.value??""); return isNaN(v)?fb:v; };
      const intv=(id,fb)=>{ const v=parseInt($("#"+id)?.value??""  ,10); return isNaN(v)?fb:v; };
      let extra={}; const et=$("#s_extra")?.value.trim();
      if(et){ try{ extra=JSON.parse(et); }catch(e){ toast("Extra JSON invalid — ignored"); } }
      const str=id=>{ const v=$("#"+id)?.value.trim(); return v||null; };
      const body={
        base_url:str("s_base"), embed_base_url:str("s_embedbase"),
        chat_model:str("s_chat"), embed_model:str("s_embed_model"),
        embed_dim:intv("s_dim",768), max_tokens:intv("s_max",4096), history_turns:intv("s_hist",16),
        enable_thinking:!!($("#s_think")?.checked),
        temperature:num("s_temp",0.85), top_p:num("s_topp",0.9), top_k:intv("s_topk",0),
        min_p:num("s_minp",0), top_a:num("s_topa",0), typical_p:num("s_typ",1), tfs:num("s_tfs",1),
        smoothing_factor:num("s_smooth",0), seed:intv("s_seed",-1),
        repetition_penalty:num("s_rep",1), repetition_penalty_range:intv("s_reprange",0),
        frequency_penalty:num("s_freq",0), presence_penalty:num("s_pres",0),
        dynatemp_low:num("s_dlow",0), dynatemp_high:num("s_dhigh",0),
        mirostat_mode:intv("s_miro",0), mirostat_tau:num("s_mtau",5), mirostat_eta:num("s_meta",0.1),
        dry_multiplier:num("s_drym",0), dry_base:num("s_dryb",1.75), dry_allowed_length:intv("s_dryl",2),
        xtc_threshold:num("s_xtct",0.1), xtc_probability:num("s_xtcp",0),
        default_language:str("s_deflang")||"English",
        comfyui_url:str("s_comfy_url"), comfyui_checkpoint:str("s_comfy_ckpt"),
        stop:($("#s_stop")?.value||"").split("\n").map(s=>s.trim()).filter(Boolean),
        extra_params:extra, system_suffix:$("#s_suffix")?.value??null, post_history:$("#s_posthist")?.value??null };
      const key=$("#s_key")?.value.trim(); if(key) body.api_key=key;
      const ekey=$("#s_ekey")?.value.trim(); if(ekey) body.embed_api_key=ekey;
      liveAppearance();
      try{
        const r=await api("/api/settings",j("PUT",body));
        const sa=$("#s_api"); if(sa){ API=sa.value.trim().replace(/\/+$/,""); store.set("api",API); }
        document.querySelectorAll("#s_model_list,#u_model_list").forEach(el=>el.style.display="none");
        closeModal(); toast(r.reindexed?"Saved — vector index rebuilt.":"Saved."); checkConn();
      }catch(e){ toast("Save failed: "+e.message); }
    };
    const sCancelGlobal=$("#s_cancel_global");
    if(sCancelGlobal) sCancelGlobal.onclick=()=>{ applyTheme(prevTheme); closeModal(); };
  }

  $("#s_cancel").onclick=()=>{ applyTheme(prevTheme); closeModal(); };
};
$("#themeBtn").onclick=toggleTheme;
document.addEventListener("keydown",e=>{ if(e.key==="Escape") closeModal(); });

/* ============================ LIVE UPDATE CHECK ============================
   A SPA tab never re-fetches app.js/style.css on its own — hash-based routing
   only swaps #main's innerHTML, it doesn't reload <script>/<link> tags. So even
   with no-cache headers on those files (see server.py), a tab left open across
   a deploy keeps running the JS it loaded at page-open time. This polls a tiny
   fingerprint of the served static files and offers a one-click reload the
   moment they change, instead of relying on the user to remember to hard-refresh. */
let _siteVersion=null;
async function _fetchVersion(){
  try{ const r=await fetch("/version",{cache:"no-store"}); if(r.ok) return (await r.json()).v; }
  catch(e){ /* offline or mid-deploy — just try again next tick */ }
  return null;
}
function _showUpdateBanner(){
  if($("#updateBanner")) return;
  const b=el(`<div id="updateBanner" class="update-banner">A new version is available.<button type="button" id="updateReload">Reload</button></div>`);
  document.body.appendChild(b);
  $("#updateReload").onclick=()=>location.reload();
}
async function startVersionWatch(){
  _siteVersion=await _fetchVersion();
  const check=async()=>{
    const v=await _fetchVersion();
    if(v && _siteVersion && v!==_siteVersion) _showUpdateBanner();
  };
  setInterval(check, 60000);
  document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") check(); });
}

/* ============================ BOOT ============================ */
if(typeof marked!=="undefined") marked.setOptions({gfm:true,breaks:true});
init();
startVersionWatch();
