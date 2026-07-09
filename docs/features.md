# StoryHaven AI — Release Notes

Everything the platform does, in plain language, one line at a time.

---

## What's new in V1.1
- **A real community forum** — Reddit-style threads with titles, categories, replies, and likes, separate from character comments, for discussion that isn't tied to any one character or image.
- **Emoji reactions** — react to comments with the standard set or with admin-added custom emojis, not just reply.
- **A unified notification inbox** — comments, forum replies, milestones, and (for admins) signups/reports/requests all land in the same bell, instead of scattered per-feature alerts.
- **Admin health dashboard** — live up/down + response-time trend charts for the database, chat model, image classifier, and image generator, plus a live server log viewer, so a problem shows up before someone has to report it.
- **Hardening pass** — a full audit of the auth flow, bring-your-own-endpoint SSRF guard, upload validation, and encryption-at-rest coverage ahead of this release; see `VersionReports/FINAL_REPORT_V1.1.md` for the detailed findings and fixes (a mood-tag parsing bug that could silently eat mid-reply text was found and fixed).
- **A visible app version** — the sidebar now shows the running version number, so you can tell at a glance what you're on without opening a settings panel.
- **Sidebar scroll fix** — the account/notification/settings row at the bottom of the sidebar no longer gets squeezed by a whole-sidebar scrollbar; only the nav/recent-chats list scrolls now, so the bottom row always stays put.

## Coming next (planned, not yet shipped)
- **Train your own LoRA** — fine-tune a style or character add-on from your own reference images, instead of only picking from ones an admin has already added.
- **Story memory beyond embeddings** — a second memory layer that tracks ongoing plot/state directly (not just semantic recall over past turns), so long-running stories keep continuity that a vector search alone can miss.
- **A unified theme system** — one place to skin the whole app's look, instead of separate color/font/background controls scattered across settings.
- **Total user-side customization** — broaden the same bring-your-own-HTML/CSS approach already used for profiles and character pages to more of the app, so more of the UI itself is yours to reshape.

## Accounts & profile
- **Sign up & stay logged in** — no re-entering your password every visit.
- **New accounts are reviewed** by an admin before they can be used.
- **Usernames stay clean** — spaces are folded to hyphens automatically, only letters/numbers/`_`/`-` allowed.
- **Your own profile page** — avatar, banner, bio, join date, social links (Twitter/X, Twitch, Instagram, Discord, Pixiv, YouTube, Patreon, Ko-fi).
- **A gradient that's actually yours** — your chosen banner/accent colors carry through to your avatar's border ring and your Edit button, not just the banner strip.
- **Custom titles** — request a badge next to your name (like "Creator"); it only goes live once an admin approves it, so nobody can self-assign something misleading.
- **Fully custom profile design** — bring your own HTML/CSS if you want it to look like nothing else, with placeholders for your avatar, bio, stats, links, title badge, and the required Share/Edit/Comments/Block controls — with clear warnings (and an actual save-time check) against a common mistake that silently breaks the page.
- **Change your password any time**, right from Settings.
- **Browse creators, not just characters** — a directory of every user, each card backed by their own banner (blurred into an ambient gradient), searchable by name.
- **Block anyone** — their comments on your stuff vanish, yours on theirs go too.

## Building characters
- **Full character sheet** — name, personality, backstory, greeting, example dialogue, tags.
- **Two ways to play** — first-person Character mode, or third-person Game Master mode that narrates, runs NPCs, and calls for dice.
- **Multiple opening greetings** — every new chat can start somewhere different.
- **Avatar & banner upload** with built-in cropping — animated GIFs supported.
- **Mature-content labeling** so ratings stay honest.
- **Custom character pages** — your own hand-built HTML/CSS.

## World-building
- **Lorebooks** — facts and history the AI only brings up when actually relevant.
- **Always-on or keyword-triggered** entries, your choice per fact.
- **Images per lore entry**, with their own "how to draw this" tags.
- **Private entries** — some lore can stay hidden from everyone but you.

## Chatting
- **Live streaming replies** — watch the story arrive word by word.
- **Regenerate or continue** any reply that didn't land right.
- **Edit or delete** any message, yours or the AI's.
- **Dice built in** — `/roll 2d6+3` resolves to a real number before the AI sees it.
- **Optional "thinking" panel** — watch the AI reason before it answers.
- **Export a whole conversation** to a text file.
- **Scene headers, automatically enforced** — turn on date/time/location headers per reply; if the AI ever forgets to include one, the app fills it in so the story never loses track.

## Memory that doesn't forget
- **Unlimited-length chats** — no slowdown, no lost plot threads.
- **Private per-chat memory** — two conversations never bleed into each other.
- **Clean regenerates** — an abandoned reply's memory is forgotten too.

## Visual-novel presentation
- **Background, music, and sprite** per character.
- **Mood-driven scene changes** — the AI picks the mood, the visuals follow.
- **Autoplay-safe audio** — starts muted, one click to enable.

## AI-generated images
- **A full image studio** — pick a model, pick as many style add-ons (LoRAs) as you like, set the aspect ratio and resolution, and write what you want to see.
- **Pictures for every pick** — models and style add-ons show a real preview image and a plain-language description instead of a bare filename, so you can tell what something looks like before using it.
- **Search the full list** — a "Show more" button opens every installed model/style add-on with search, not just the first few.
- **Don't have the model you want? Ask for it** — request a new model or style add-on from a trusted source; an admin reviews and adds it, so nothing gets auto-downloaded from a random link.
- **Guide it with a reference image** — upload or crop a picture to steer the composition, colors, or pose, with a slider explaining exactly what stronger vs. weaker guidance does.
- **Everything explained, not hidden behind jargon** — every technical control (guidance strength, step count, the drawing method) has a plain-language line underneath saying what it actually does.
- **Watch it get drawn, live** — a real streaming preview updates as the picture is generated, with a Stop button if you change your mind partway through.
- **Collapsible controls** — model/style pickers tuck away by default so the panel isn't overwhelming, expand only what you need.
- **Illustrate any chat moment** — tags are drafted for you, editable before generating.
- **Your personal gallery**, plus everything generated inside your chats, organized by conversation.
- **Comment on images** — the same commenting people already use on characters and profiles, right on your saved pictures.
- **Share a picture with a real link** — copy a link to any saved image; pasting it in Discord (or anywhere else that shows link previews) shows the actual picture, not a blank box.
- **A rating tag on every picture** — a small SFW/NSFW tag in the corner, clearly marked as an automatic AI guess until an admin actually reviews it, at which point it switches to "Human reviewed."
- **Think a rating is wrong? Say so** — lodge a report right from the image with an optional note; an admin reviews it and the final call is always a human's, not the AI's.
- **Pick your own model type**, not the one auto-guessed from a filename, if an admin's set a nicer name for it.

## Sharing & privacy
- **Private by default**, always.
- **Per-character sharing controls** — publish to Community, allow others to play it, allow downloads — all opt-in.
- **Browse the community** — filter by rating, mode, or tag.
- **Share a link, get a real preview** — pasting a link to your character, profile, or a shared image into Discord (or similar apps) shows its actual name, description, and picture, not a bare generic link.
- **Comments, everywhere it makes sense** — characters, profiles, and shared images can all be commented on, with replies and the same block-list respected throughout. Edit your own comments any time — a clear "(edited)" mark keeps things honest.
- **React, not just reply** — standard and custom admin-added emoji reactions on comments.
- **A community forum** — general discussion threads with categories, replies, and likes, separate from any one character.
- **A notification bell** — get pinged when someone comments on or replies to something of yours, or when one of your public characters hits a popularity milestone.
- **Automatic content warnings** — every uploaded picture (avatars, banners, lore art, generated images) is automatically checked and blurred for anyone who hasn't turned on mature content, so nobody gets caught off guard by something they didn't choose to see.

## For admins
- **A real dashboard** — key numbers at a glance (users, pending items, flagged content) instead of digging through menus, with every section living at its own address so refreshing never dumps you back at the start.
- **User management** — approve, deny, create, reset passwords, promote, suspend (with an optional reason shown to the user, and a Discord contact link for appeals/questions), demote — with built-in guardrails so nobody can lock themselves out or demote the platform's own developer account by mistake.
- **Private notes on any user** — jot down who someone actually is, with a full timestamped history of who wrote what, plus a quick at-a-glance identity tag on their row. Visible only to admins, never to the user themselves.
- **A notification bell for admins too** — new signups, password resets, flagged connections, content requests, and rating reports ping you the moment they show up, instead of you having to keep checking.
- **One inbox for everything waiting on you** — pending signups, password resets, flagged connections, model/style requests, custom-title requests, and reported image ratings, all in one place.
- **Flagged-connection review** — suspicious AI-server requests wait for admin approval before use, with the actual error details shown so you can see exactly what went wrong.
- **Rate images yourself** — review a reported picture with a clean, no-distraction view and decide SFW or NSFW in one click; your call always wins over the AI's guess.
- **Set the picture and type for any model or style add-on** — upload or generate a sample image and a friendly name so users can see what something looks like before picking it.
- **A live health dashboard** — every core service (database, chat AI, image classifier, image generator) shown with a real trend chart over time, an average response time, and how much of the last day/week it's actually been up.
- **Live server log viewer**, folded right into that same health view, for troubleshooting.
- **No admin backdoor** — admins can't browse other people's private content either.

## Works well on your phone
- **A real mobile layout, not a squeezed-down desktop one** — the sidebar becomes a slide-out drawer, the image studio and profile layouts drop to a single column, and image grids reflow from a multi-column masonry down to one or two columns as the screen narrows.
- **Touch-friendly controls** — actions that only used to show up on hover (message tools, etc.) stay visible by default on touch devices instead of being stuck behind a hover state you can't trigger.
- **The sidebar footer never gets pushed off-screen** — the account/notification/settings/logout row at the bottom of the sidebar is now pinned in place; only the navigation and recent-chats list above it scroll, so that row is always reachable.

## Language & personalization
- **The AI writes and thinks in your chosen language**, not just translates after the fact.
- **Interface auto-translation** — menus and buttons follow your language too.
- **Translate once, reuse forever** — nothing gets machine-translated twice.
- **Light/dark themes**, plus per-device font, color, and background customization.

## Works with what you already have
- **Import** characters from SillyTavern, chub.ai, RisuAI, or SpicyChat.
- **Export** back out to the same formats — never locked in.
- **Bring your own AI server** — every connection is automatically safety-checked before it's allowed to run.

## Built to protect your data
- **Encrypted at rest** — characters, lore, messages, comments, bios, custom profile pages, and more are all unreadable from the raw database file, even to an administrator with direct access. A second, independent safety check watches every response leaving the server and blanks anything that shouldn't be there, just in case.
- **Private keys never shown back** — any API key you save is write-only; the app never echoes it, even to you.
- **Suspicious connections get flagged, not silently allowed** — anything that looks like it's probing your network gets caught and held for admin review, with the real error shown so an admin can see exactly why.
- **Custom pages can't quietly phone home** — a character or profile page you built yourself can't load images or fonts from outside sites without your say-so, so nobody's IP gets leaked just by viewing a page.
- **Independently audited** — this platform has gone through a real security review covering account access, file uploads, custom-page safety, and network requests, with real issues found and fixed, not just assumed away (see `VersionReports/` for the audit report of each release).

---

*StoryHaven AI is self-hosted: you run it, you own the data, and nothing leaves your server unless you choose to share it.*
