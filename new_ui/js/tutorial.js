"use strict";

function _tutorialInjectDemo(containerSelector, html) {
  const container = document.querySelector(containerSelector);
  if (!container || container.querySelector(".tutorial-injected")) return;
  container.insertAdjacentHTML("afterbegin", html);
}

const TUTORIAL_GROUPS = [
  {
    key: "explore", label: t("tutorial_group_explore", "Explore"),
    pages: [
      { key: "explore-hub", title: t("tutorial_lesson_explore_hub_title", "The Explore hub"),
        blurb: t("tutorial_lesson_explore_hub_blurb", "Four tabs. You will find all four. This is not a riddle."),
        steps: [
          { route: "/explore", target: '[onclick*="explore/characters"]', copy: t("tutorial_lesson_explore_hub_step1_copy", "Click the \"See all\" link next to Characters, near the top of the page."), advanceOn: "click" },
        ] },
      { key: "explore-characters", title: t("tutorial_lesson_explore_characters_title", "Characters — browsing, searching, filter pills"),
        blurb: t("tutorial_lesson_explore_characters_blurb", "A grid of cards and a search box that understands #tags and @creators."),
        steps: [
          { route: "/explore/characters", target: "#pantheonSearch", copy: t("tutorial_lesson_explore_characters_step1_copy", "Click into this box and type exactly: <b>#tutorial</b> (yes, with the # symbol). Watch it turn into a pill."), advanceOn: "input-exact", expect: "#tutorial" },
          { setup: () => _tutorialInjectDemo("#pantheonGrid", '<div class="char-card tutorial-injected" style="cursor:pointer" onclick="event.preventDefault()"><div class="char-card-frame"><div class="char-card-art" style="background-image:url(/img/tutorial-demo.svg);background-size:cover;background-position:center"></div><div class="char-card-fade"></div><div class="char-card-body"><h3 class="char-card-title">Tutorial Demo Character</h3></div></div></div>'),
            target: ".char-card.tutorial-injected", copy: t("tutorial_lesson_explore_characters_step2_copy", "This is a card. Click it. It opens the character. Groundbreaking stuff, truly."), advanceOn: "click" },
        ] },
      { key: "explore-creators", title: t("tutorial_lesson_explore_creators_title", "Creators"),
        blurb: t("tutorial_lesson_explore_creators_blurb", "People who made things. Look at their things."),
        steps: [
          { route: "/explore/creators", target: "#artisansSearch", copy: t("tutorial_lesson_explore_creators_step1_copy", "Click into this box and type exactly: <b>tutorial</b>. No # symbol this time, just the word."), advanceOn: "input-exact", expect: "tutorial" },
        ] },
      { key: "explore-media", title: t("tutorial_lesson_explore_media_title", "Media — browsing and the detail view"),
        blurb: t("tutorial_lesson_explore_media_blurb", "A wall of images. Click one. It gets bigger."),
        steps: [
          { route: "/explore/media", target: "#pinSearch", copy: t("tutorial_lesson_explore_media_step1_copy", "Click into this box and type exactly: <b>tutorial</b>. That's it. Five letters."), advanceOn: "input-exact", expect: "tutorial" },
          { setup: () => {
              const search = document.getElementById("pinSearch");
              if (search && search.value !== "") { search.value = ""; search.dispatchEvent(new Event("input", { bubbles: true })); }
              _tutorialInjectDemo("#pinSearchBox", '<div class="pin-frame tutorial-injected" style="position:static;width:64px;height:64px;display:inline-block;background:var(--color-surface-2) url(/img/tutorial-demo.svg) center/cover;border-radius:8px;vertical-align:middle" onclick="event.preventDefault()"></div>');
            },
            target: ".pin-frame.tutorial-injected", copy: t("tutorial_lesson_explore_media_step2_copy", "Click this image tile. A real one opens larger, with comments. This is the whole feature."), advanceOn: "click" },
        ] },
      { key: "explore-forum", title: t("tutorial_lesson_explore_forum_title", "Forum"),
        blurb: t("tutorial_lesson_explore_forum_blurb", "Threads, replies, upvotes."), group: true,
        pages: [
          { key: "forum-list", title: t("tutorial_lesson_forum_list_title", "Categories & thread list"),
            blurb: t("tutorial_lesson_forum_list_blurb", "Threads sorted into categories. Sort yourself into one too."),
            steps: [
              { route: "/explore/forum", target: "#symNewBtn", copy: t("tutorial_lesson_forum_list_step1_copy", "This starts a new thread. We are not clicking it for real, but note where it is."), advanceOn: "click" },
              { target: "#symTitle", copy: t("tutorial_lesson_forum_new_step1_copy", "Click into this field and type exactly: <b>Tutorial Thread</b>. Capital T, capital T."), advanceOn: "input-exact", expect: "Tutorial Thread" },
              { target: "#symBody", copy: t("tutorial_lesson_forum_new_step2_copy", "Now click into this box and type exactly: <b>This is a tutorial post.</b> Include the period."), advanceOn: "input-exact", expect: "This is a tutorial post." },
              { target: "#symPost", copy: t("tutorial_lesson_forum_new_step3_copy", "Post it. Don't worry, this one's fake."), advanceOn: "intercept", reveal: t("tutorial_lesson_forum_new_reveal", "Posted! Except it wasn't. Nobody will ever read your riveting tutorial thread, because it never existed.") },
            ] },
          { key: "forum-thread", title: t("tutorial_lesson_forum_thread_title", "Reading, replying, upvoting a thread"),
            blurb: t("tutorial_lesson_forum_thread_blurb", "Type a reply. Press the arrow. Regret nothing."),
            steps: [
              { route: "/explore/forum", target: ".sym-card", copy: t("tutorial_lesson_forum_thread_step1_copy", "Click a thread to open it."), advanceOn: "click" },
              { target: ".sym-votes", copy: t("tutorial_lesson_forum_thread_step2_copy", "This is the upvote arrow. It goes up. That's the whole mechanic."), advanceOn: "click" },
            ] },
        ] },
      { key: "character-detail", title: t("tutorial_lesson_character_detail_title", "A character's page — view, follow, chat, comment"),
        blurb: t("tutorial_lesson_character_detail_blurb", "Everything you can do before you've even said hello."),
        steps: [
          { route: "/explore/characters", target: ".char-card", copy: t("tutorial_lesson_character_detail_step1_copy", "Open a character."), advanceOn: "click" },
          { target: "#charStartChat", copy: t("tutorial_lesson_character_detail_step2_copy", "This starts a chat. We'll cover chatting itself in its own lesson, so just note it exists."), advanceOn: "click" },
          { target: "#startChatConfirm", copy: t("tutorial_lesson_character_detail_step3_copy", "Confirm and you're in. Not now though."), advanceOn: "intercept", reveal: t("tutorial_lesson_character_detail_reveal", "Would have opened a real chat. This is a tutorial, so it didn't. Go do the Chat lesson for the real thing.") },
        ] },
    ],
  },
  {
    key: "chats", label: t("tutorial_group_chats", "Chats"),
    pages: [
      { key: "chats-list", title: t("tutorial_lesson_chats_list_title", "Your conversations, grouped by character"),
        blurb: t("tutorial_lesson_chats_list_blurb", "Expand a group. That's the whole feature."),
        steps: [
          { setup: () => _tutorialInjectDemo(".parlance-list", '<div class="parlance-group-header tutorial-injected" style="cursor:pointer"><span class="parlance-name">Tutorial Demo</span><span class="parlance-time">1 conversation</span></div>'),
            route: "/chats", target: ".parlance-group-header.tutorial-injected", copy: t("tutorial_lesson_chats_list_step1_copy", "Conversations are grouped by character. Click a group to expand it."), advanceOn: "click" },
        ] },
      { key: "chat-conversation", title: t("tutorial_lesson_chat_conversation_title", "Chat conversation"),
        blurb: t("tutorial_lesson_chat_conversation_blurb", "Send, regenerate, roll, continue, mood."), group: true,
        pages: [
          { key: "chat-send", title: t("tutorial_lesson_chat_send_title", "Sending a message, getting a reply"),
            blurb: t("tutorial_lesson_chat_send_blurb", "Type. Press send. A reply happens."),
            steps: [
              { route: "/chats/__tutorial__", target: "#chatInput", copy: t("tutorial_lesson_chat_send_step1_copy", "Click into this box and type exactly: <b>Hello there.</b> Capital H, period at the end. I'll wait."), advanceOn: "input-exact", expect: "Hello there." },
              { target: "#chatSend", copy: t("tutorial_lesson_chat_send_step2_copy", "Press send. Watch words appear as if someone cares."), advanceOn: "simulate-chat", simReply: t("tutorial_lesson_chat_send_simreply", "Ah, a challenger appears. You typed exactly what you were told, like a very good little participant."), reveal: t("tutorial_lesson_chat_send_reveal", "Riveting exchange. Also entirely fake. No model was troubled, no GPU woke up.") },
            ] },
          { key: "chat-regenerate", title: t("tutorial_lesson_chat_regenerate_title", "Regenerate"),
            blurb: t("tutorial_lesson_chat_regenerate_blurb", "Didn't like the reply? Ask for a different one."),
            steps: [
              { route: "/chats/__tutorial__", target: '[data-act="regenerate"]', copy: t("tutorial_lesson_chat_regenerate_step1_copy", "This asks for a new reply to the same message. Radical concept, truly."), advanceOn: "intercept", reveal: t("tutorial_lesson_chat_regenerate_reveal", "A new reply would have appeared. This is a tutorial, so instead you got this sentence.") },
            ] },
          { key: "chat-dice", title: t("tutorial_lesson_chat_dice_title", "Rolling dice inline"),
            blurb: t("tutorial_lesson_chat_dice_blurb", "Type a roll, get a number."),
            steps: [
              { route: "/chats/__tutorial__", target: "#chatDiceBtn", copy: t("tutorial_lesson_chat_dice_step1_copy", "This rolls dice inline, for RPG-mode characters. Press it."), advanceOn: "intercept", reveal: t("tutorial_lesson_chat_dice_reveal", "A number would have appeared. It didn't. This is a tutorial, not a casino.") },
            ] },
          { key: "chat-continue", title: t("tutorial_lesson_chat_continue_title", "Continue"),
            blurb: t("tutorial_lesson_chat_continue_blurb", "The reply stopped short. Ask it to keep going."),
            steps: [
              { route: "/chats/__tutorial__", target: "#chatContinueInput, #chatMoreBtn", copy: t("tutorial_lesson_chat_continue_step1_copy", "Continue picks up where a reply left off. There it is."), advanceOn: "click" },
            ] },
          { key: "chat-mood", title: t("tutorial_lesson_chat_mood_title", "Mood tags on visual-novel characters"),
            blurb: t("tutorial_lesson_chat_mood_blurb", "The sprite changes expression. It's a tag, not magic."),
            steps: [
              { route: "/chats/__tutorial__", target: "#chatStageToggle", copy: t("tutorial_lesson_chat_mood_step1_copy", "This button shows or hides the background art behind the chat. Click it and watch the backdrop disappear, then reappear if you click again. Separately, when a character has stage art, each of its replies can carry an invisible [mood: x] tag that swaps its portrait's expression - you won't see that here since this is a scripted demo message, not a live reply, but that's the mechanism."), advanceOn: "click" },
            ] },
        ] },
    ],
  },
  {
    key: "workshop", label: t("tutorial_group_workshop", "Workshop"),
    pages: [
      { key: "workshop-hub", title: t("tutorial_lesson_workshop_hub_title", "The Workshop hub"),
        blurb: t("tutorial_lesson_workshop_hub_blurb", "Four doors. You will walk through all four, eventually."),
        steps: [
          { route: "/workshop", target: '[onclick*="workshop/characters"]', copy: t("tutorial_lesson_workshop_hub_step1_copy", "This is where you make things. Characters, masks, lore, images. Click one."), advanceOn: "click" },
        ] },
      { key: "workshop-characters", title: t("tutorial_lesson_workshop_characters_title", "Characters"),
        blurb: t("tutorial_lesson_workshop_characters_blurb", "Your creations, and how to build one from nothing."), group: true,
        pages: [
          { key: "characters-list", title: t("tutorial_lesson_characters_list_title", "Your characters list, and searching it"),
            blurb: t("tutorial_lesson_characters_list_blurb", "A list of your creations. Find one."),
            steps: [
              { route: "/workshop/characters", target: "#pantheonSearch", copy: t("tutorial_lesson_characters_list_step1_copy", "Click into the search box and type exactly: <b>tutorial</b>. Lowercase. That's the whole feature."), advanceOn: "input-exact", expect: "tutorial" },
            ] },
          { key: "characters-identity", title: t("tutorial_lesson_characters_identity_title", "Identity — name, description, mode"),
            blurb: t("tutorial_lesson_characters_identity_blurb", "Who they are, and whether they talk in first person or narrate you."),
            steps: [
              { route: "/workshop/characters/new", target: "#cf_name", copy: t("tutorial_lesson_characters_identity_step1_copy", "Click into this field and type exactly: <b>Tutorial Test</b>. Capital T, capital T."), advanceOn: "input-exact", expect: "Tutorial Test" },
              { target: "#cf_description", copy: t("tutorial_lesson_characters_identity_step2_copy", "Now click into this box and type exactly: <b>A character made purely for this tutorial.</b> Include the period."), advanceOn: "input-exact", expect: "A character made purely for this tutorial." },
            ] },
          { key: "characters-avatar", title: t("tutorial_lesson_characters_avatar_title", "Avatar & media upload"),
            blurb: t("tutorial_lesson_characters_avatar_blurb", "A picture. Crop it. Everyone's first crop is bad."),
            steps: [
              { route: "/workshop/characters/new", uploadTarget: "#cAvaBox", target: "#cAvaBox", copy: t("tutorial_lesson_characters_avatar_step1_copy", "Click this box to pick an image. We will not actually read it, but pretend it's a masterpiece."), advanceOn: "upload-simulate", uploadPreviewHtml: '<img class="tutorial-injected" src="/img/tutorial-demo.svg" style="width:100%;height:100%;object-fit:cover;border-radius:14px" alt="tutorial-avatar.png (not really uploaded)">', reveal: t("tutorial_lesson_characters_avatar_reveal", "A file, allegedly chosen. Nothing left this browser tab. Crop it next time, for real.") },
            ] },
          { key: "characters-greetings", title: t("tutorial_lesson_characters_greetings_title", "Greetings & scenario"),
            blurb: t("tutorial_lesson_characters_greetings_blurb", "The first thing they say. Write more than one."),
            steps: [
              { route: "/workshop/characters/new", target: "#cf_greeting", copy: t("tutorial_lesson_characters_greetings_step1_copy", "Click into this box and type exactly: <b>Hello, tutorial.</b> Comma after Hello, period at the end."), advanceOn: "input-exact", expect: "Hello, tutorial." },
              { target: "#cAddAltGreet", copy: t("tutorial_lesson_characters_greetings_step2_copy", "You can add more than one greeting. People replay openings, apparently."), advanceOn: "click" },
              { target: "#cSaveBtn", copy: t("tutorial_lesson_characters_greetings_step3_copy", "Save the character. This one's fake, so nothing is actually created."), advanceOn: "intercept", reveal: t("tutorial_lesson_characters_greetings_reveal", "Saved! Except not. Half-finished characters haunt no one but you, and this one never existed at all.") },
            ] },
        ] },
      { key: "workshop-masks", title: t("tutorial_lesson_workshop_masks_title", "Masks (Personas)"),
        blurb: t("tutorial_lesson_workshop_masks_blurb", "The faces you wear."), group: true,
        pages: [
          { key: "masks-list", title: t("tutorial_lesson_masks_list_title", "Your masks list"),
            blurb: t("tutorial_lesson_masks_list_blurb", "The faces you wear. There is more than one."),
            steps: [
              { route: "/workshop/personas", target: "#masksAddBtn", copy: t("tutorial_lesson_masks_list_step1_copy", "This adds a new mask. Click it."), advanceOn: "click" },
            ] },
          { key: "masks-edit", title: t("tutorial_lesson_masks_edit_title", "Creating & editing a mask"),
            blurb: t("tutorial_lesson_masks_edit_blurb", "Name it. Save it. Wear it into battle."),
            steps: [
              { route: "/workshop/personas", setup: () => document.getElementById("masksAddBtn")?.click(), target: "#mkName", copy: t("tutorial_lesson_masks_edit_step1_copy", "Click into this field and type exactly: <b>Me But Cooler</b>. Capital M, capital B, capital C."), advanceOn: "input-exact", expect: "Me But Cooler" },
              { target: "#mkDefault", copy: t("tutorial_lesson_masks_edit_step2_copy", "Click this checkbox once to check it. One click. That's all."), advanceOn: "toggle", expect: true },
              { target: "#mkSave", copy: t("tutorial_lesson_masks_edit_step3_copy", "Save it."), advanceOn: "intercept", reveal: t("tutorial_lesson_masks_edit_reveal", "Saved. Except not, obviously. Wear it into battle some other, realer time.") },
            ] },
        ] },
      { key: "workshop-lore", title: t("tutorial_lesson_workshop_lore_title", "Lore"),
        blurb: t("tutorial_lesson_workshop_lore_blurb", "Facts your characters are supposed to remember."), group: true,
        pages: [
          { key: "lore-list", title: t("tutorial_lesson_lore_list_title", "Your lore list"),
            blurb: t("tutorial_lesson_lore_list_blurb", "Find an entry."),
            steps: [
              { setup: () => _tutorialInjectDemo(".grimoire-content", '<div class="sanctum-feed-row tutorial-injected" style="cursor:pointer"><span class="sanctum-specimen" style="background-image:url(/img/tutorial-demo.svg);background-size:cover;background-position:center"></span><span class="sanctum-feed-body">Tutorial Demo Entry</span></div>'),
                route: "/workshop/lore", target: ".sanctum-feed-row.tutorial-injected", copy: t("tutorial_lesson_lore_list_step1_copy", "A lore entry. Click it to open it."), advanceOn: "click" },
            ] },
          { key: "lore-entry", title: t("tutorial_lesson_lore_entry_title", "Creating an entry — keyword triggers, always-on"),
            blurb: t("tutorial_lesson_lore_entry_blurb", "A fact, and when it should surface."),
            steps: [
              { route: "/workshop/lore",
                setup: () => { if (!document.getElementById("gName")) _grimoireEditModal(null, null, [], () => {}); },
                target: "#gName", copy: t("tutorial_lesson_lore_entry_step1_copy", "Click into this field and type exactly: <b>The Tutorial Kingdom</b>. Capital T, capital T, capital K."), advanceOn: "input-exact", expect: "The Tutorial Kingdom" },
              { target: "#gKeys", copy: t("tutorial_lesson_lore_entry_step2_copy", "Now click into this box and type exactly: <b>tutorial, demo</b>. Lowercase, comma, space. These are the keywords that trigger this fact in a chat."), advanceOn: "input-exact", expect: "tutorial, demo" },
              { target: "#gContent", copy: t("tutorial_lesson_lore_entry_step3_copy", "Click into this box and type exactly: <b>This kingdom exists only for this tutorial.</b> Include the period."), advanceOn: "input-exact", expect: "This kingdom exists only for this tutorial." },
              { target: "#gSave", copy: t("tutorial_lesson_lore_entry_step4_copy", "Save it."), advanceOn: "intercept", reveal: t("tutorial_lesson_lore_entry_reveal", "Saved. Except not. No character will ever remember the Tutorial Kingdom, because it never existed.") },
            ] },
          { key: "lore-web", title: t("tutorial_lesson_lore_web_title", "The lore web view"),
            blurb: t("tutorial_lesson_lore_web_blurb", "A graph of how your facts connect. Look, don't panic."),
            steps: [
              { route: "/workshop/lore", target: "#gwFreeze", copy: t("tutorial_lesson_lore_web_step1_copy", "This freezes the graph layout so it stops drifting while you read it. Press it."), advanceOn: "click" },
            ] },
        ] },
      { key: "workshop-forge", title: t("tutorial_lesson_workshop_forge_title", "Forge"),
        blurb: t("tutorial_lesson_workshop_forge_blurb", "Every mode, every dropdown."), group: true,
        pages: [
          { key: "forge-txt2img", title: t("tutorial_lesson_forge_txt2img_title", "Txt2img — the prompt, and Generate"),
            blurb: t("tutorial_lesson_forge_txt2img_blurb", "Describe a thing. Press Generate."),
            steps: [
              { route: "/workshop/media", target: "#forgePositive", copy: t("tutorial_lesson_forge_txt2img_step1_copy", "Click into this box and type exactly: <b>a cat in a tiny hat</b>. All lowercase, no period."), advanceOn: "input-exact", expect: "a cat in a tiny hat" },
              { target: ".forge-generate-btn", copy: t("tutorial_lesson_forge_txt2img_step2_copy", "Generate. This one gets a real-looking fake render."), advanceOn: "simulate-imagegen", simResult: "/img/tutorial-demo.svg", reveal: t("tutorial_lesson_forge_txt2img_reveal", "Magnificent. It's also a recording I made earlier. Your prompt did precisely nothing.") },
            ] },
          { key: "forge-img2img", title: t("tutorial_lesson_forge_img2img_title", "Reference image (img2img)"),
            blurb: t("tutorial_lesson_forge_img2img_blurb", "Upload a picture. Ask for a different one that looks like it."),
            steps: [
              { route: "/workshop/media", setup: () => window._activeForgeView?.setMode?.("image"), uploadTarget: "#forgeRefThumb, #forgePreviewBox", target: '[onclick*="chooseReferenceSource"]', copy: t("tutorial_lesson_forge_img2img_step1_copy", "Pick a reference image."), advanceOn: "upload-simulate", uploadPreviewHtml: '<img class="tutorial-injected" src="/img/tutorial-demo.svg" style="width:96px;height:96px;border-radius:10px;object-fit:cover" alt="tutorial-reference.png (not really uploaded)">', reveal: t("tutorial_lesson_forge_img2img_reveal", "Nothing was actually uploaded. The denoise slider next to it controls how much it keeps versus reinvents.") },
            ] },
          { key: "forge-upscale", title: t("tutorial_lesson_forge_upscale_title", "Upscaling"),
            blurb: t("tutorial_lesson_forge_upscale_blurb", "Same image, more pixels."),
            steps: [
              { route: "/workshop/media", setup: () => window._activeForgeView?.setMode?.("upscale"),
                uploadTarget: "#forgePreviewBox", target: '[onclick*="chooseReferenceSource"]', copy: t("tutorial_lesson_forge_upscale_step1_copy", "Pick an image to upscale. Same image, more pixels. That's the whole feature."), advanceOn: "upload-simulate", uploadPreviewHtml: '<img class="tutorial-injected" src="/img/tutorial-demo.svg" style="width:64px;height:64px;border-radius:8px;object-fit:cover" alt="tutorial-upscale-source.png (not really uploaded)">', reveal: t("tutorial_lesson_forge_upscale_reveal", "A before/after pair would appear here once you actually pick a real image. Nothing was uploaded, since this is a tutorial.") },
            ] },
          { key: "forge-model-selection", title: t("tutorial_lesson_forge_model_selection_title", "Model, LoRA, sampler & scheduler selection"),
            blurb: t("tutorial_lesson_forge_model_selection_blurb", "Four dropdowns that quietly change everything."),
            steps: [
              { route: "/workshop/media", setup: () => window._activeForgeView?.setMode?.("image"), target: '[onclick*="openModelPicker"]', copy: t("tutorial_lesson_forge_model_selection_step1_copy", "This is where you pick a checkpoint, LoRA, sampler, and scheduler. Learn what they do before blaming the model."), advanceOn: "click" },
            ] },
          { key: "forge-inpaint", title: t("tutorial_lesson_forge_inpaint_title", "Inpainting"),
            blurb: t("tutorial_lesson_forge_inpaint_blurb", "Paint over the part you hate. Regenerate just that part."),
            steps: [
              { route: "/workshop/media", setup: () => window._activeForgeView?.setMode?.("inpaint"), uploadTarget: "#forgePreviewBox", target: '[onclick*="chooseReferenceSource"]', copy: t("tutorial_lesson_forge_inpaint_step1_copy", "Pick an image to inpaint on."), advanceOn: "upload-simulate", uploadPreviewHtml: '<img class="tutorial-injected" src="/img/tutorial-demo.svg" style="width:100%;height:100%;object-fit:cover;border-radius:16px" alt="tutorial-inpaint-source.png (not really uploaded)">', reveal: t("tutorial_lesson_forge_inpaint_reveal", "Once loaded, you'd paint the part to redo on the canvas. We are, again, not actually doing that.") },
            ] },
          { key: "forge-video", title: t("tutorial_lesson_forge_video_title", "Video — text-to-video"),
            blurb: t("tutorial_lesson_forge_video_blurb", "Describe a scene. Get a short clip. No source image needed."),
            steps: [
              { route: "/workshop/media", setup: () => window._activeForgeView?.setMode?.("video"), target: "#forgePositive", copy: t("tutorial_lesson_forge_video_step1_copy", "Click into this box and type exactly: <b>a cat walking through tall grass</b>. All lowercase, no period."), advanceOn: "input-exact", expect: "a cat walking through tall grass" },
              { target: ".forge-generate-btn", copy: t("tutorial_lesson_forge_video_step2_copy", "Generate. There's no image to upload here, this mode only ever works from a text description."), advanceOn: "simulate-imagegen", simResult: "/img/tutorial-demo.svg", reveal: t("tutorial_lesson_forge_video_reveal", "A short clip would appear here. Physics optional. Also, still fake.") },
            ] },
          { key: "forge-compile", title: t("tutorial_lesson_forge_compile_title", "Compile tab"),
            blurb: t("tutorial_lesson_forge_compile_blurb", "Assemble past generations into one output."),
            steps: [
              { route: "/workshop/media", setup: () => window._activeForgeView?.setMode?.("compile"), target: "#compileUploadBtn", copy: t("tutorial_lesson_forge_compile_step1_copy", "Add images from your past creations, then compile them into a GIF or a strip. Yes, there's a tab for that."), advanceOn: "click" },
            ] },
        ] },
    ],
  },
  {
    key: "dossier", label: t("tutorial_group_dossier", "Dossier"),
    pages: [
      { key: "profile-overview", title: t("tutorial_lesson_profile_overview_title", "Your own profile"),
        blurb: t("tutorial_lesson_profile_overview_blurb", "This is what other people see."),
        steps: [
          { route: () => "/u/" + encodeURIComponent(ME?.username || ""), target: ".artisan-name, .profile-header", copy: t("tutorial_lesson_profile_overview_step1_copy", "This is your public profile. Look at it at least once."), advanceOn: "click" },
        ] },
      { key: "comments-post", title: t("tutorial_lesson_comments_post_title", "Posting & editing comments"),
        blurb: t("tutorial_lesson_comments_post_blurb", "Words, under a thing. Edit them if you regret them."),
        steps: [
          { route: () => "/u/" + encodeURIComponent(ME?.username || ""), setup: () => openCommentsModal("user", ME?.username), target: ".comment-composer-emoji, textarea", copy: t("tutorial_lesson_comments_post_step1_copy", "Write a comment. Words. Under a thing."), advanceOn: "click" },
        ] },
      { key: "comments-emoji", title: t("tutorial_lesson_comments_emoji_title", "Emoji & sticker reactions"),
        blurb: t("tutorial_lesson_comments_emoji_blurb", "Custom ones too. Someone made those."),
        steps: [
          { route: () => "/u/" + encodeURIComponent(ME?.username || ""), setup: () => openCommentsModal("user", ME?.username), target: ".comment-media-tab[data-tab='emoji'], .comment-composer-emoji", copy: t("tutorial_lesson_comments_emoji_step1_copy", "Open the emoji picker."), advanceOn: "click" },
          { target: ".comment-media-panel [data-emoji]", copy: t("tutorial_lesson_comments_emoji_step2_copy", "Pick one. There are custom ones too, made by actual humans."), advanceOn: "click" },
        ] },
      { key: "follow-system", title: t("tutorial_lesson_follow_system_title", "Following people"),
        blurb: t("tutorial_lesson_follow_system_blurb", "Follow, unfollow, see who follows you."),
        steps: [
          { route: "/explore/creators", target: '[onclick*="toggleFollow"]', copy: t("tutorial_lesson_follow_system_step1_copy", "Follow someone. Social studies, basically."), advanceOn: "intercept", reveal: t("tutorial_lesson_follow_system_reveal", "You are now, allegedly, following them. Not really. This is a tutorial.") },
        ] },
      { key: "notifications", title: t("tutorial_lesson_notifications_title", "Notifications inbox"),
        blurb: t("tutorial_lesson_notifications_blurb", "One bell. Everything lands there."),
        steps: [
          { target: "#notifBellBtn", copy: t("tutorial_lesson_notifications_step1_copy", "One bell. Comments, replies, milestones, all of it. You've been ignoring it."), advanceOn: "click" },
        ] },
    ],
  },
  {
    key: "settings", label: t("tutorial_group_settings", "Settings"),
    pages: [
      { key: "settings-hub", title: t("tutorial_lesson_settings_hub_title", "The Settings hub"),
        blurb: t("tutorial_lesson_settings_hub_blurb", "A menu. You've used menus before."),
        steps: [
          { route: "/settings", target: '[onclick*="settings-appearance"]', copy: t("tutorial_lesson_settings_hub_step1_copy", "This opens Appearance settings. There are others. Explore them yourself, hero."), advanceOn: "click" },
        ] },
      { key: "settings-appearance", title: t("tutorial_lesson_settings_appearance_title", "Appearance — theme & accent"),
        blurb: t("tutorial_lesson_settings_appearance_blurb", "Twelve combinations. Try the panic-blur button."),
        steps: [
          { route: "/settings-appearance", target: '[data-accent]', copy: t("tutorial_lesson_settings_appearance_step1_copy", "Pick an accent color. There are six, times two chrome modes. Try one."), advanceOn: "click" },
        ] },
      { key: "settings-model", title: t("tutorial_lesson_settings_model_title", "Model — your own endpoint"),
        blurb: t("tutorial_lesson_settings_model_blurb", "Point it somewhere else, if you insist on knowing better."),
        steps: [
          { route: "/settings-model", target: "#model_use_own", copy: t("tutorial_lesson_settings_model_step1_copy", "Click this checkbox once to check it. That flips the app over to your own chat endpoint instead of the shared one."), advanceOn: "toggle", expect: true },
        ] },
      { key: "settings-account", title: t("tutorial_lesson_settings_account_title", "Account"),
        blurb: t("tutorial_lesson_settings_account_blurb", "Password, sessions, passkeys."), group: true,
        pages: [
          { key: "account-password", title: t("tutorial_lesson_account_password_title", "Password & sessions"),
            blurb: t("tutorial_lesson_account_password_blurb", "Change it. Sign the others out."),
            steps: [
              { route: "/settings-account", target: "#acct_new_pw", copy: t("tutorial_lesson_account_password_step1_copy", "Click into this field and type exactly: <b>TutorialPassword123!</b> Capital T and P, the number 123, exclamation point at the end. We won't actually change it, don't worry."), advanceOn: "input-exact", expect: "TutorialPassword123!" },
            ] },
          { key: "account-passkeys", title: t("tutorial_lesson_account_passkeys_title", "Passkeys & two-factor"),
            blurb: t("tutorial_lesson_account_passkeys_blurb", "No more password, if you can find your phone."),
            steps: [
              { route: "/settings-account", target: "#acct_passkey_required_toggle", copy: t("tutorial_lesson_account_passkeys_step1_copy", "This is where passkeys and two-factor codes live. Set one up for real, later, on your own time."), advanceOn: "click" },
            ] },
        ] },
      { key: "settings-blocks", title: t("tutorial_lesson_settings_blocks_title", "Blocked users"),
        blurb: t("tutorial_lesson_settings_blocks_blurb", "A list of people you never have to see again."),
        steps: [
          { route: "/settings-blocks", target: "#block_tag_input", copy: t("tutorial_lesson_settings_blocks_step1_copy", "Click into this field and type exactly: <b>tutorial-tag</b>. Lowercase, one hyphen in the middle. It'll disappear entirely once blocked."), advanceOn: "input-exact", expect: "tutorial-tag" },
        ] },
    ],
  },
  {
    key: "admin", label: t("tutorial_group_admin", "Admin"), adminOnly: true,
    pages: [
      { key: "admin-overview", title: t("tutorial_lesson_admin_overview_title", "Overview dashboard"),
        blurb: t("tutorial_lesson_admin_overview_blurb", "Health, stats, an attention banner."),
        steps: [
          { route: "/admin", target: '[onclick*="admin-moderation"]', copy: t("tutorial_lesson_admin_overview_step1_copy", "That banner means something needs you. Click through to it."), advanceOn: "click" },
        ] },
      { key: "admin-users", title: t("tutorial_lesson_admin_users_title", "Users — roles, suspension, Dev grants"),
        blurb: t("tutorial_lesson_admin_users_blurb", "Power you can revoke as easily as you gave it."),
        steps: [
          { route: "/admin-users", target: '[onclick*="suspend"]', copy: t("tutorial_lesson_admin_users_step1_copy", "This suspends a user. We are not actually suspending anyone today."), advanceOn: "intercept", reveal: t("tutorial_lesson_admin_users_reveal", "Nobody was suspended. This is a tutorial, not a purge.") },
        ] },
      { key: "admin-moderation", title: t("tutorial_lesson_admin_moderation_title", "Moderation"),
        blurb: t("tutorial_lesson_admin_moderation_blurb", "Seven queues. Someone has to open them."), group: true,
        pages: [
          { key: "moderation-signups", title: t("tutorial_lesson_moderation_signups_title", "Signups queue"),
            blurb: t("tutorial_lesson_moderation_signups_blurb", "Approve or reject a stranger."),
            steps: [
              { route: "/admin-moderation", target: "#invTier", copy: t("tutorial_lesson_moderation_signups_step1_copy", "Open this dropdown and pick the option labeled <b>Guest</b>. Invite tiers gate who can even sign up."), advanceOn: "select", expect: "guest" },
            ] },
          { key: "moderation-endpoints", title: t("tutorial_lesson_moderation_endpoints_title", "Flagged endpoints & model requests"),
            blurb: t("tutorial_lesson_moderation_endpoints_blurb", "Two queues that both end in a curl command."),
            steps: [
              { route: "/admin-moderation",
                setup: () => { if (!document.querySelector('[onclick*="approveModelRequest"], [onclick*="copyModelRequestCurl"]')) _tutorialInjectDemo(".content-col", '<button type="button" class="tutorial-injected px-2.5 py-1 rounded-md border border-line text-xs text-ink" onclick="event.preventDefault()">Copy curl command (demo)</button>'); },
                target: '[onclick*="approveModelRequest"], [onclick*="copyModelRequestCurl"], .tutorial-injected', copy: t("tutorial_lesson_moderation_endpoints_step1_copy", "Approving a model request gives you a curl command to run by hand. The app never fetches it for you, on purpose."), advanceOn: "click" },
            ] },
          { key: "moderation-reports", title: t("tutorial_lesson_moderation_reports_title", "Content & image reports"),
            blurb: t("tutorial_lesson_moderation_reports_blurb", "The queue nobody enjoys."),
            steps: [
              { route: "/admin-moderation",
                setup: () => { if (!document.getElementById("ir_explicit")) openModal('<h3>Review reported image (demo)</h3><p class="text-xs text-muted mb-3">This modal normally shows the reported image itself.</p><label class="flex items-center gap-2.5 mb-3 text-sm text-ink"><input type="checkbox" id="ir_explicit" class="tutorial-injected"> Mark as explicit</label><button type="button" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark" onclick="event.preventDefault()">Save</button>'); },
                target: "#ir_explicit", copy: t("tutorial_lesson_moderation_reports_step1_copy", "Click this checkbox once to check it, marking the reported content explicit. Someone has to open this queue. Today it's you."), advanceOn: "toggle", expect: true },
            ] },
        ] },
      { key: "admin-previews", title: t("tutorial_lesson_admin_previews_title", "Model preview curation"),
        blurb: t("tutorial_lesson_admin_previews_blurb", "Checkpoints, LoRAs, samplers. Curate them."),
        steps: [
          { route: "/admin-previews", target: "#pv_display_name", copy: t("tutorial_lesson_admin_previews_step1_copy", "Click into this field and type exactly: <b>Tutorial Checkpoint</b>. Capital T, capital C. A human-readable name, instead of a wall of underscores."), advanceOn: "input-exact", expect: "Tutorial Checkpoint" },
        ] },
      { key: "admin-lora-training", title: t("tutorial_lesson_admin_lora_training_title", "LoRA Training"),
        blurb: t("tutorial_lesson_admin_lora_training_blurb", "Dataset, progress, test, queue."), group: true,
        pages: [
          { key: "lora-train-tab", title: t("tutorial_lesson_lora_train_tab_title", "Train tab — dataset & captions"),
            blurb: t("tutorial_lesson_lora_train_tab_blurb", "Images in, tags on each."),
            steps: [
              { route: "/admin-train", uploadTarget: "label:has(#lt_images_input)", target: "label:has(#lt_images_input)", copy: t("tutorial_lesson_lora_train_tab_step1_copy", "Upload training images here, or bulk-import matching .txt caption files if you're not a masochist."), advanceOn: "upload-simulate", uploadPreviewHtml: '<div class="tutorial-injected" style="display:flex;gap:6px;margin-top:8px"><img src="/img/tutorial-demo.svg" style="width:48px;height:48px;border-radius:6px;object-fit:cover"><img src="/img/tutorial-demo.svg" style="width:48px;height:48px;border-radius:6px;object-fit:cover"><img src="/img/tutorial-demo.svg" style="width:48px;height:48px;border-radius:6px;object-fit:cover"><img src="/img/tutorial-demo.svg" style="width:48px;height:48px;border-radius:6px;object-fit:cover"></div>', reveal: t("tutorial_lesson_lora_train_tab_reveal", "Nothing was actually uploaded. A real dataset needs real GPU spend, which this tutorial will never cost you.") },
            ] },
          { key: "lora-progress-tab", title: t("tutorial_lesson_lora_progress_tab_title", "Progress tab — live loss curve"),
            blurb: t("tutorial_lesson_lora_progress_tab_blurb", "A chart that goes down. That's the good direction."),
            steps: [
              { route: "/admin-train", setup: () => { window.adminTrainView && (window.adminTrainView.tab = "progress"); window.adminTrainView?.render?.(); }, target: ".content-col", copy: t("tutorial_lesson_lora_progress_tab_step1_copy", "This is where the loss curve lives during a real run. Nothing is training right now, so it's empty."), advanceOn: "click" },
            ] },
          { key: "lora-test-tab", title: t("tutorial_lesson_lora_test_tab_title", "Test tab"),
            blurb: t("tutorial_lesson_lora_test_tab_blurb", "Try the LoRA before you tell anyone it's done."),
            steps: [
              { route: "/admin-train", setup: () => { window.adminTrainView && (window.adminTrainView.tab = "test"); window.adminTrainView?.render?.(); }, target: ".content-col", copy: t("tutorial_lesson_lora_test_tab_step1_copy", "Try a trained LoRA immediately, without leaving the page. Trust, but verify."), advanceOn: "click" },
            ] },
          { key: "lora-jobs-queue", title: t("tutorial_lesson_lora_jobs_queue_title", "Job queue — abort & resume"),
            blurb: t("tutorial_lesson_lora_jobs_queue_blurb", "Stop a run for real. Pick it back up later, also for real."),
            steps: [
              { route: "/admin-train", setup: () => { window.adminTrainView && (window.adminTrainView.tab = "jobs"); window.adminTrainView?.render?.(); }, target: ".content-col", copy: t("tutorial_lesson_lora_jobs_queue_step1_copy", "Only one job trains at a time, since a GPU is billed per job. Abort here actually stops billing, not just the UI."), advanceOn: "click" },
            ] },
        ] },
      { key: "admin-emojis", title: t("tutorial_lesson_admin_emojis_title", "Emoji moderation"),
        blurb: t("tutorial_lesson_admin_emojis_blurb", "Custom stickers, reviewed by an actual human."),
        steps: [
          { route: "/admin-emojis", target: "#ae_kind", copy: t("tutorial_lesson_admin_emojis_step1_copy", "Open this dropdown and pick the option labeled <b>Sticker</b>. Not Emoji. Sticker."), advanceOn: "select", expect: "sticker" },
        ] },
      { key: "admin-config", title: t("tutorial_lesson_admin_config_title", "Server configuration"),
        blurb: t("tutorial_lesson_admin_config_blurb", "Endpoints, sampling defaults, host allowlists."),
        steps: [
          { route: "/admin-config", target: "#cfg_deflang", copy: t("tutorial_lesson_admin_config_step1_copy", "Clear this field and type exactly: <b>English</b>. Capital E. This is the default language for anyone who hasn't picked their own. Careful in here, this affects everyone."), advanceOn: "input-exact", expect: "English" },
        ] },
      { key: "admin-health", title: t("tutorial_lesson_admin_health_title", "Health dashboard"),
        blurb: t("tutorial_lesson_admin_health_blurb", "Up, down, latency, logs."),
        steps: [
          { route: "/admin-health", target: '[id^="health_card_"]', copy: t("tutorial_lesson_admin_health_step1_copy", "Up, down, latency. This is the log viewer you'll screenshot and send to no one."), advanceOn: "click" },
        ] },
    ],
  },
];

function _tutorialFlatLessons() {
  const out = [];
  TUTORIAL_GROUPS.forEach((grp) => {
    grp.pages.forEach((page) => {
      if (page.group) page.pages.forEach((sub) => out.push(sub));
      else out.push(page);
    });
  });
  return out;
}

class TutorialView {
  async mount(main) {
    this.main = main;
    this.progress = store.get("tutorialProgress", {});
    this.render();
  }

  launch(key) {
    const lesson = _tutorialFlatLessons().find((l) => l.key === key);
    if (!lesson) return;
    tutorialEngine.start(lesson);
  }

  async resetProgress() {
    if (!(await confirmDialog(t("tutorial_reset_progress_confirm_message"), { confirmLabel: t("tutorial_reset_progress_confirm_label"), danger: false }))) return;
    this.progress = {};
    store.set("tutorialProgress", {});
    this.render();
  }

  lessonRowHtml(lesson) {
    const done = !!this.progress[lesson.key];
    return `
      <button type="button" class="lesson-row${done ? " done" : ""}" onclick="_activeTutorialView.launch('${lesson.key}')">
        <span class="lesson-text">
          <span class="lesson-title">${_esc(lesson.title)}</span>
          <span class="lesson-blurb">${_esc(lesson.blurb)}</span>
        </span>
        ${done ? `<span class="lesson-check">&check;</span>` : `<span class="lesson-chevron">&rsaquo;</span>`}
      </button>
    `;
  }

  pageGroupHtml(page) {
    const subLessons = page.pages;
    const doneCount = subLessons.filter((l) => this.progress[l.key]).length;
    const allDone = doneCount === subLessons.length;
    return `
      <details class="page-group${allDone ? " done" : ""}">
        <summary>
          <span class="page-group-caret">&rsaquo;</span>
          <span class="page-group-title">${_esc(page.title)}</span>
          ${allDone ? `<span class="page-group-check">&check;</span>` : `<span class="page-group-meta">${doneCount}/${subLessons.length}</span>`}
        </summary>
        <div class="page-group-rows">
          ${subLessons.map((l) => `
            <button type="button" class="feature-row" onclick="_activeTutorialView.launch('${l.key}')">
              <span class="feature-row-title">${_esc(l.title)}<span class="feature-row-blurb">${_esc(l.blurb)}</span></span>
              ${this.progress[l.key] ? `<span class="feature-check">&check;</span>` : `<span class="feature-chevron">&rsaquo;</span>`}
            </button>
          `).join("")}
        </div>
      </details>
    `;
  }

  groupHtml(grp) {
    if (grp.adminOnly && (!ME || (ME.role !== "admin" && ME.role !== "dev"))) return "";
    const count = grp.pages.reduce((n, p) => n + (p.group ? p.pages.length : 1), 0);
    return `
      <div class="group${grp.adminOnly ? " admin-group" : ""}">
        <div class="group-label">${_esc(grp.label)} <span class="group-count">${count} ${t("tutorial_lessons_word", "lessons")}</span></div>
        <div class="group-rows">
          ${grp.pages.map((page) => page.group ? this.pageGroupHtml(page) : this.lessonRowHtml(page)).join("")}
        </div>
      </div>
    `;
  }

  render() {
    const all = _tutorialFlatLessons();
    const visibleGroups = TUTORIAL_GROUPS.filter((g) => !g.adminOnly || (ME && (ME.role === "admin" || ME.role === "dev")));
    const visibleLessons = visibleGroups.flatMap((g) => g.pages.flatMap((p) => p.group ? p.pages : [p]));
    const done = visibleLessons.filter((l) => this.progress[l.key]).length;
    this.main.innerHTML = `
      ${backLinkHtml(t("tutorial_back_link_my_dossier"))}
      ${pageHeaderHtml(t("tutorial_back_link_my_dossier"), t("tutorial_page_title"), t("tutorial_page_title"), t("tutorial_page_subheading"))}
      <div class="progress-line">
        <span>${done} ${t("tutorial_progress_summary_of")} ${visibleLessons.length} ${t("tutorial_progress_summary_suffix")}</span>
        <span class="progress-track"><span class="progress-fill" style="width:${visibleLessons.length ? (done / visibleLessons.length * 100) : 0}%"></span></span>
      </div>
      ${TUTORIAL_GROUPS.map((g) => this.groupHtml(g)).join("")}
      <button type="button" onclick="_activeTutorialView.resetProgress()" class="reset-btn">${t("tutorial_reset_progress_button")}</button>
    `;
    void all;
  }
}

if (typeof window !== "undefined") {
  window.TutorialView = TutorialView;
  window.TUTORIAL_GROUPS = TUTORIAL_GROUPS;
}
