"""
db.py — PostgreSQL persistence (async, via SQLAlchemy Core + asyncpg).

All structured data lives here: characters, personas, lore, sessions, messages,
settings, users, auth tokens, and per-user LLM overrides.
Vector embeddings live in pgvector tables (vectors.py), sharing this engine.

The query layer is written with SQLAlchemy Core (Table objects + expression API).
The Fernet encryption layer (_encrypt_secret/_decrypt_secret) operates on plain
Python strings before/after they touch SQL and is unaffected by the query builder.
"""
import os
import json
import re
import time
import hashlib
import secrets
from cryptography.fernet import Fernet, InvalidToken
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy import and_, or_, select, insert, update, delete, func, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine

_THINK_RE = re.compile(r"<think>.*?</think>\s*", re.S)


def _preview(content: str, n: int = 80) -> str:
    return _THINK_RE.sub("", content or "").strip()[:n].replace("\n", " ")


_engine: AsyncEngine | None = None
_fernet: Fernet | None = None


# ── schema ──────────────────────────────────────────────────────────────────

_meta = sa.MetaData()

users = sa.Table(
    "users", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("username", sa.Text, nullable=False, unique=True),
    sa.Column("password_hash", sa.Text, nullable=False),
    sa.Column("is_admin", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("status", sa.Text, nullable=False, server_default=text("'active'")),
    sa.Column("created", sa.Float, nullable=False),
    sa.Column("display_name", sa.Text),
    sa.Column("bio", sa.Text),
    sa.Column("avatar", sa.Text),
    sa.Column("banner_color", sa.Text),
    sa.Column("accent_color", sa.Text),
    sa.Column("banner_img", sa.Text),
    sa.Column("social_links", sa.Text, nullable=False, server_default=text("'{}'")),
    sa.Column("profile_html", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("nsfw_allowed", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("is_explicit", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("title", sa.Text),
    sa.Column("title_status", sa.Text, nullable=False, server_default=text("'none'")),
    sa.Column("suspension_reason", sa.Text),
    sa.Column("identity_label", sa.Text),
    # 'user' | 'admin' | 'dev' — a tier above admin for the platform's own
    # operator: sees raw model-request download material (curl commands,
    # API keys — see routers/admin.py's list_model_requests) that even other
    # admins don't, and is protected from demotion/suspension/deletion by
    # anyone. Additive to is_admin, not a replacement — every dev is still
    # is_admin=1, this only gates the extra tier on top.
    sa.Column("role", sa.Text, nullable=False, server_default=text("'user'")),
)

auth_sessions = sa.Table(
    "auth_sessions", _meta,
    sa.Column("token", sa.Text, primary_key=True),
    sa.Column("user_id", sa.Text, nullable=False),
    sa.Column("expires", sa.Float, nullable=False),
)

user_settings = sa.Table(
    "user_settings", _meta,
    sa.Column("user_id", sa.Text, primary_key=True, nullable=False),
    sa.Column("key", sa.Text, primary_key=True, nullable=False),
    sa.Column("value", sa.Text),
)

characters = sa.Table(
    "characters", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("name", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("persona", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("scenario", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("greeting", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("dialogue", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("system_prompt", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("tags", sa.Text, nullable=False, server_default=text("'[]'")),
    sa.Column("creator", sa.Text, nullable=False, server_default=text("'you'")),
    sa.Column("avatar", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("alt_greetings", sa.Text, nullable=False, server_default=text("'[]'")),
    sa.Column("mode", sa.Text, nullable=False, server_default=text("'character'")),
    sa.Column("assets", sa.Text, nullable=False, server_default=text("'{}'")),
    sa.Column("owner_id", sa.Text),
    sa.Column("is_public", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("presentation_html", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("can_be_persona", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("allow_download", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("description", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("is_explicit", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("is_draft", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("created", sa.Float, nullable=False),
)

personas = sa.Table(
    "personas", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("name", sa.Text, nullable=False, server_default=text("'You'")),
    sa.Column("description", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("is_default", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("owner_id", sa.Text),
    sa.Column("source_char_id", sa.Text),
    sa.Column("is_draft", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("created", sa.Float, nullable=False),
)

lore = sa.Table(
    "lore", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("char_id", sa.Text),
    sa.Column("keys", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("content", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("always", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("image", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("category", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("hidden", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("name", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("appearance_tags", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("appearance_tags_negative", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("is_explicit", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("created", sa.Float, nullable=False),
)

sessions = sa.Table(
    "sessions", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("char_id", sa.Text, nullable=False),
    sa.Column("persona_id", sa.Text),
    sa.Column("title", sa.Text, nullable=False, server_default=text("'Chat'")),
    sa.Column("user_name", sa.Text, nullable=False, server_default=text("'You'")),
    sa.Column("user_id", sa.Text),
    sa.Column("created", sa.Float, nullable=False),
    sa.Column("updated", sa.Float, nullable=False),
    sa.Column("style_key", sa.Text, nullable=False, server_default=text("'unspecified'")),
    sa.Column("style_prompt", sa.Text),
    sa.Column("language", sa.Text),
    sa.Column("char_doing", sa.Text),
    sa.Column("char_location", sa.Text),
    sa.Column("known_names", sa.Text, nullable=False, server_default=text("'[]'")),
    sa.Column("author_note", sa.Text),
    sa.Column("glossary", sa.Text, nullable=False, server_default=text("'{}'")),
)

messages = sa.Table(
    "messages", _meta,
    sa.Column("seq", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("id", sa.Text, nullable=False),
    sa.Column("session_id", sa.Text, nullable=False),
    sa.Column("role", sa.Text, nullable=False),
    sa.Column("content", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("ts", sa.Integer, nullable=False),
    sa.Column("lang", sa.Text),
    sa.Column("image", sa.Text),
    sa.Column("image_positive", sa.Text),
    sa.Column("image_negative", sa.Text),
    sa.Column("image_ts", sa.Integer),
    sa.Column("image_is_explicit", sa.Integer, nullable=False, server_default=text("0")),
)

settings = sa.Table(
    "settings", _meta,
    sa.Column("key", sa.Text, primary_key=True),
    sa.Column("value", sa.Text, nullable=False),
)

localization = sa.Table(
    "localization", _meta,
    sa.Column("src_hash", sa.Text, primary_key=True, nullable=False),
    sa.Column("lang", sa.Text, primary_key=True, nullable=False),
    sa.Column("kind", sa.Text, nullable=False, server_default=text("'content'")),
    sa.Column("source", sa.Text, nullable=False),
    sa.Column("translated", sa.Text, nullable=False),
    sa.Column("created", sa.Float, nullable=False),
)

standalone_images = sa.Table(
    "standalone_images", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("user_id", sa.Text, nullable=False),
    sa.Column("image", sa.Text, nullable=False),
    sa.Column("positive", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("negative", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("created", sa.Float, nullable=False),
    sa.Column("is_public", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("is_explicit", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("checkpoint", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("loras", sa.Text, nullable=False, server_default=text("'[]'")),
    sa.Column("sampler", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("scheduler", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("steps", sa.Integer, nullable=False, server_default=text("20")),
    sa.Column("human_reviewed", sa.Integer, nullable=False, server_default=text("0")),
    # NSFW classification runs as a fire-and-forget background task and only
    # writes back when it flags something explicit (see
    # chat_service.classify_image_background) — is_explicit alone can't tell
    # "classified as SFW" apart from "not classified yet", which is exactly
    # what gating sharing on an actual rating needs to know.
    sa.Column("classified", sa.Integer, nullable=False, server_default=text("0")),
    # Whether this generation used a reference image (img2img) vs a plain
    # text prompt (txt2img) — shown on the image detail view so viewers can
    # tell the two apart instead of guessing from the prompt alone.
    sa.Column("is_img2img", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("cfg", sa.Float, nullable=False, server_default=text("7.0")),
    # Blank when the saved image was never upscaled — the upscaler model name
    # otherwise, shown on the detail view as "Upscaled: {model}" so a viewer
    # can tell a saved image was run through a second upscale pass on top of
    # the original generation.
    sa.Column("upscaler", sa.Text, nullable=False, server_default=text("''")),
)

checkpoint_previews = sa.Table(
    "checkpoint_previews", _meta,
    sa.Column("checkpoint_name", sa.Text, primary_key=True),
    sa.Column("model_type", sa.Text, nullable=True),
    sa.Column("image", sa.Text, nullable=True),
    sa.Column("display_name", sa.Text, nullable=True),
    sa.Column("description", sa.Text, nullable=True),
    # Some checkpoints (e.g. a distilled/turbo variant) produce a good result
    # in far fewer steps than others — null means "no override, use whatever
    # the caller's own default is".
    sa.Column("default_steps", sa.Integer, nullable=True),
    # Coarse architecture family for the picker's filter selector — one of
    # "flux_v2", "anima", "sdxl", "il" (Illustrious), or null/unset. Anima
    # models are auto-tagged from the separate UNETLoader list rather than set
    # here (see imagegen.list_anima_unets) — this column only matters for
    # entries that come through CheckpointLoaderSimple.
    sa.Column("model_category", sa.Text, nullable=True),
    # Per-checkpoint overrides for Anima's separate CLIP text-encoder/VAE —
    # different Anima checkpoints from different creators can require
    # different encoders (unlike SDXL/Illustrious, which bundle their own).
    # Null means "no override, use imagegen.ANIMA_CLIP_NAME/ANIMA_VAE_NAME".
    sa.Column("anima_clip_name", sa.Text, nullable=True),
    sa.Column("anima_vae_name", sa.Text, nullable=True),
)

lora_previews = sa.Table(
    "lora_previews", _meta,
    sa.Column("lora_name", sa.Text, primary_key=True),
    sa.Column("image", sa.Text, nullable=True),
    sa.Column("display_name", sa.Text, nullable=True),
    sa.Column("description", sa.Text, nullable=True),
    # Which base architecture this LoRA is trained against (a SDXL LoRA
    # generally won't apply to an Anima/Flux checkpoint, etc.) — same
    # admin-defined-only categories as checkpoint_previews.model_category,
    # used to let users filter the LoRA picker down to just what actually
    # applies to the model they've already picked.
    sa.Column("model_category", sa.Text, nullable=True),
    # Prompt words that actually trigger this LoRA's trained concept (e.g. a
    # trigger word for a trained character/style LoRA, or known activation
    # tags for a downloaded one) — JSON array, same tolerant storage/parsing
    # as model_category. Purely informational for whoever picks this LoRA.
    sa.Column("keywords", sa.Text, nullable=True),
)

# Gates visibility of LoRAs this app itself trained (see lora_training_jobs)
# from regular users until an admin explicitly publishes them via the
# "Publish" button in Model previews. A LoRA with no row here (i.e. every
# pre-existing LoRA that was already on disk before this feature existed) is
# always visible — this table only ever gates LoRAs this app wrote itself.
lora_visibility = sa.Table(
    "lora_visibility", _meta,
    sa.Column("lora_name", sa.Text, primary_key=True),
    sa.Column("is_published", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("created_by", sa.Text),
    sa.Column("created", sa.Float, nullable=False),
    sa.Column("published_at", sa.Float),
)

sampler_previews = sa.Table(
    "sampler_previews", _meta,
    sa.Column("sampler_name", sa.Text, primary_key=True),
    sa.Column("image", sa.Text, nullable=True),
    sa.Column("display_name", sa.Text, nullable=True),
    sa.Column("description", sa.Text, nullable=True),
)

scheduler_previews = sa.Table(
    "scheduler_previews", _meta,
    sa.Column("scheduler_name", sa.Text, primary_key=True),
    sa.Column("image", sa.Text, nullable=True),
    sa.Column("display_name", sa.Text, nullable=True),
    sa.Column("description", sa.Text, nullable=True),
)

upscaler_previews = sa.Table(
    "upscaler_previews", _meta,
    sa.Column("upscaler_name", sa.Text, primary_key=True),
    sa.Column("image", sa.Text, nullable=True),
    sa.Column("display_name", sa.Text, nullable=True),
    sa.Column("description", sa.Text, nullable=True),
)

flagged_endpoints = sa.Table(
    "flagged_endpoints", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("user_id", sa.Text, nullable=False),
    sa.Column("url", sa.Text, nullable=False),
    sa.Column("api_key", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("reason", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("detail", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("status", sa.Text, nullable=False, server_default=text("'pending'")),
    sa.Column("created", sa.Float, nullable=False),
)

password_reset_requests = sa.Table(
    "password_reset_requests", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("user_id", sa.Text, nullable=False),
    sa.Column("username", sa.Text, nullable=False),
    sa.Column("status", sa.Text, nullable=False, server_default=text("'pending'")),
    sa.Column("created", sa.Float, nullable=False),
)

comments = sa.Table(
    "comments", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("target_type", sa.Text, nullable=False),
    sa.Column("target_id", sa.Text, nullable=False),
    sa.Column("author_id", sa.Text, nullable=False),
    sa.Column("parent_id", sa.Text, nullable=True),
    sa.Column("content", sa.Text, nullable=False),
    sa.Column("created", sa.Float, nullable=False),
    sa.Column("edited_at", sa.Float, nullable=True),
    # A real uploaded attachment — goes through strict extension-allowlist +
    # content validation (see routers/comments.py upload_comment_image).
    # Distinct from a plain link the commenter typed in `content`, which is
    # never fetched server-side at all (see the client-side embed allowlist).
    # `image` holds the /media/... URL (images/video) or the on-disk filename
    # (text/code, served only through the dedicated always-text/plain route —
    # see attachment_text_route — never through the generic /media/ mount).
    sa.Column("image", sa.Text, nullable=True),
    sa.Column("image_is_explicit", sa.Integer, nullable=False, server_default=text("0")),
    # "image" | "video" | "text" — how the frontend should render `image`.
    # NULL for old rows predating this column means "image" (its original,
    # only-ever-images meaning).
    sa.Column("attachment_kind", sa.Text, nullable=True),
)

# Discord-style emoji reactions — a user can put more than one different
# emoji on the same comment (each is its own row), but only once each
# (enforced by the composite primary key acting as a toggle: react/unreact
# is just insert/delete of this exact row).
comment_reactions = sa.Table(
    "comment_reactions", _meta,
    sa.Column("comment_id", sa.Text, primary_key=True),
    sa.Column("user_id", sa.Text, primary_key=True),
    sa.Column("emoji", sa.Text, primary_key=True),
    # A "super" reaction is the same emoji, just flagged for a distinct
    # highlighted/animated pill — same row, not a separate reaction type.
    sa.Column("is_super", sa.Integer, nullable=False, server_default=text("0")),
)

# Admin-curated custom emoji/stickers (same idea as checkpoint/lora previews
# being admin-curated rather than user-uploaded free-for-all) — "emoji" is
# typed inline as :shortcode: and rendered small within comment text;
# "sticker" is sent as its own standalone attachment, never inline.
custom_emojis = sa.Table(
    "custom_emojis", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("shortcode", sa.Text, nullable=False, unique=True),
    sa.Column("image", sa.Text, nullable=False),
    sa.Column("kind", sa.Text, nullable=False, server_default=text("'emoji'")),
    sa.Column("uploader_id", sa.Text, nullable=False),
    sa.Column("created", sa.Float, nullable=False),
    # Any user can upload these (unlike checkpoint/lora previews), so — same
    # as any other user-uploaded image in the app — it goes through
    # background NSFW classification and is blurred/hidden until rated.
    sa.Column("is_explicit", sa.Integer, nullable=False, server_default=text("0")),
    # Set only for animated GIFs pending admin review — a blurred single-frame
    # stand-in served in place of `image` (the real animated file) until an
    # admin clears is_explicit. See media.gif_blurred_preview / emojis.py.
    sa.Column("preview_image", sa.Text, nullable=True),
)

admin_notes = sa.Table(
    "admin_notes", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("user_id", sa.Text, nullable=False),
    sa.Column("author_id", sa.Text, nullable=False),
    sa.Column("note", sa.Text, nullable=False),
    sa.Column("created", sa.Float, nullable=False),
)

comment_likes = sa.Table(
    "comment_likes", _meta,
    sa.Column("comment_id", sa.Text, primary_key=True),
    sa.Column("user_id", sa.Text, primary_key=True),
)

# Reddit-lite: threads live here; replies reuse the existing comments system
# (target_type="thread") rather than a parallel reply table, so nesting,
# likes, edit/delete, and owner notifications all come for free.
forum_threads = sa.Table(
    "forum_threads", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("author_id", sa.Text, nullable=False),
    sa.Column("title", sa.Text, nullable=False),
    sa.Column("content", sa.Text, nullable=False),
    sa.Column("category", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("created", sa.Float, nullable=False),
    sa.Column("pinned", sa.Integer, nullable=False, server_default=text("0")),
)

thread_likes = sa.Table(
    "thread_likes", _meta,
    sa.Column("thread_id", sa.Text, primary_key=True),
    sa.Column("user_id", sa.Text, primary_key=True),
)

user_blocks = sa.Table(
    "user_blocks", _meta,
    sa.Column("blocker_id", sa.Text, primary_key=True),
    sa.Column("blocked_id", sa.Text, primary_key=True),
    sa.Column("reason", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("created", sa.Float, nullable=False),
)

model_requests = sa.Table(
    "model_requests", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("user_id", sa.Text, nullable=False),
    sa.Column("model_name", sa.Text, nullable=False),
    sa.Column("source_url", sa.Text, nullable=False),
    sa.Column("note", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("request_type", sa.Text, nullable=False, server_default=text("'checkpoint'")),
    sa.Column("status", sa.Text, nullable=False, server_default=text("'pending'")),
    sa.Column("created", sa.Float, nullable=False),
    sa.Column("resolved", sa.Float),
    sa.Column("host_allowed", sa.Integer, nullable=False, server_default=text("1")),
    sa.Column("local_path", sa.Text),
    sa.Column("error", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("vae_url", sa.Text, nullable=True),
    sa.Column("text_encoder_url", sa.Text, nullable=True),
)

lora_training_jobs = sa.Table(
    "lora_training_jobs", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("user_id", sa.Text, nullable=False),
    sa.Column("name", sa.Text, nullable=False),
    sa.Column("trigger_word", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("base_checkpoint", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("resolution", sa.Integer, nullable=False, server_default=text("512")),
    sa.Column("rank", sa.Integer, nullable=False, server_default=text("16")),
    sa.Column("alpha", sa.Integer, nullable=False, server_default=text("16")),
    sa.Column("learning_rate", sa.Float, nullable=False, server_default=text("0.0001")),
    sa.Column("steps", sa.Integer, nullable=False, server_default=text("1000")),
    sa.Column("batch_size", sa.Integer, nullable=False, server_default=text("1")),
    sa.Column("image_count", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("modal_job_id", sa.Text),
    sa.Column("status", sa.Text, nullable=False, server_default=text("'queued'")),
    sa.Column("progress", sa.Float, nullable=False, server_default=text("0")),
    sa.Column("log", sa.Text, nullable=False, server_default=text("''")),
    # JSON-encoded list of {epoch,total_epochs,step,total_steps,loss,
    # speed_img_s,eta_text,gpu_mem_gb,t} snapshots — persisted server-side
    # (not just held in the browser's own JS state) specifically so the
    # Training Progress graph/table can be rebuilt from scratch after a
    # reload instead of starting blank, and so training itself keeps running
    # and recording history with zero browser tabs open at all.
    sa.Column("metrics", sa.Text, nullable=False, server_default=text("'[]'")),
    sa.Column("transfer_progress", sa.Text, nullable=False, server_default=text("'{}'")),
    sa.Column("resume_from_lora", sa.Text),
    sa.Column("output_file", sa.Text),
    sa.Column("error", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("created", sa.Float, nullable=False),
    sa.Column("resolved", sa.Float),
)

# On-demand mid-run checkpoint snapshots (see POST
# /admin/lora-training/jobs/{jid}/checkpoint) — unlike lora_training_jobs.
# output_file, which is one path continuously overwritten by whichever
# checkpoint is most recent, each row here is a distinct, never-overwritten
# .safetensors an admin explicitly asked to keep for A/B testing (Test LoRA
# tab), named "{job_name}_{iso8601}.safetensors".
lora_checkpoints = sa.Table(
    "lora_checkpoints", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("job_id", sa.Text, nullable=False),
    sa.Column("filename", sa.Text, nullable=False),
    sa.Column("created", sa.Float, nullable=False),
)

service_health_pings = sa.Table(
    "service_health_pings", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("service", sa.Text, nullable=False),
    sa.Column("ok", sa.Integer, nullable=False),
    sa.Column("latency_ms", sa.Float),
    sa.Column("error", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("created", sa.Float, nullable=False),
)

image_rating_reports = sa.Table(
    "image_rating_reports", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("image_id", sa.Text, nullable=False),
    sa.Column("reporter_id", sa.Text, nullable=False),
    sa.Column("claimed_explicit", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("note", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("admin_note", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("status", sa.Text, nullable=False, server_default=text("'pending'")),
    sa.Column("created", sa.Float, nullable=False),
    sa.Column("resolved_at", sa.Float),
    # System-generated (the classifier's own reported confidence was <80%),
    # not a real dispute from a user — reporter_id is still the image's owner
    # so the existing NOT NULL/join stays simple, this flag is what tells the
    # admin queue "the AI itself wasn't sure" apart from a real complaint.
    sa.Column("auto_flagged", sa.Integer, nullable=False, server_default=text("0")),
)

content_reports = sa.Table(
    "content_reports", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("kind", sa.Text, nullable=False),
    sa.Column("target_id", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("image", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("label", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("note", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("reporter_id", sa.Text, nullable=False),
    sa.Column("status", sa.Text, nullable=False, server_default=text("'pending'")),
    sa.Column("created", sa.Float, nullable=False),
    sa.Column("resolved_at", sa.Float),
)

notifications = sa.Table(
    "notifications", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("user_id", sa.Text, nullable=False),
    sa.Column("type", sa.Text, nullable=False),
    sa.Column("title", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("body", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("link", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("related_id", sa.Text),
    sa.Column("read", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("created", sa.Float, nullable=False),
)

sa.Index("idx_notif_user", notifications.c.user_id, notifications.c.created)
sa.Index("idx_comments_target", comments.c.target_type, comments.c.target_id)
sa.Index("idx_msg_session", messages.c.session_id, messages.c.seq)
sa.Index("idx_lore_char", lore.c.char_id)
sa.Index("idx_sess_char", sessions.c.char_id, sessions.c.updated)
sa.Index("idx_sess_user", sessions.c.user_id, sessions.c.updated)
sa.Index("idx_char_owner", characters.c.owner_id)
sa.Index("idx_auth_user", auth_sessions.c.user_id)
sa.Index("idx_standalone_user", standalone_images.c.user_id, standalone_images.c.created)
sa.Index("idx_health_service_created", service_health_pings.c.service, service_health_pings.c.created)


# ── lifecycle ────────────────────────────────────────────────────────────────

def nid(prefix: str = "") -> str:
    return prefix + uuid4().hex[:12]


def engine() -> AsyncEngine:
    return _engine


async def init():
    global _engine, _fernet
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError(
            "DATABASE_URL is required (e.g. "
            "postgresql+asyncpg://user:pass@host:5432/dbname) — this app runs on "
            "PostgreSQL + pgvector only.")
    _engine = create_async_engine(database_url)

    async with _engine.begin() as conn:
        await conn.run_sync(_meta.create_all)
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS nsfw_allowed "
            "INTEGER NOT NULL DEFAULT 0"))
        await conn.execute(text(
            "ALTER TABLE characters ADD COLUMN IF NOT EXISTS is_draft "
            "INTEGER NOT NULL DEFAULT 0"))
        await conn.execute(text(
            "ALTER TABLE user_blocks ADD COLUMN IF NOT EXISTS reason "
            "TEXT NOT NULL DEFAULT ''"))
        await conn.execute(text(
            "ALTER TABLE personas ADD COLUMN IF NOT EXISTS is_draft "
            "INTEGER NOT NULL DEFAULT 0"))
        await conn.execute(text(
            "ALTER TABLE standalone_images ADD COLUMN IF NOT EXISTS is_public "
            "INTEGER NOT NULL DEFAULT 0"))
        await conn.execute(text(
            "ALTER TABLE standalone_images ADD COLUMN IF NOT EXISTS is_explicit "
            "INTEGER NOT NULL DEFAULT 0"))
        await conn.execute(text(
            "ALTER TABLE standalone_images ADD COLUMN IF NOT EXISTS checkpoint "
            "TEXT NOT NULL DEFAULT ''"))
        await conn.execute(text(
            "ALTER TABLE standalone_images ADD COLUMN IF NOT EXISTS loras "
            "TEXT NOT NULL DEFAULT '[]'"))
        await conn.execute(text(
            "ALTER TABLE standalone_images ADD COLUMN IF NOT EXISTS sampler "
            "TEXT NOT NULL DEFAULT ''"))
        await conn.execute(text(
            "ALTER TABLE standalone_images ADD COLUMN IF NOT EXISTS scheduler "
            "TEXT NOT NULL DEFAULT ''"))
        await conn.execute(text(
            "ALTER TABLE standalone_images ADD COLUMN IF NOT EXISTS steps "
            "INTEGER NOT NULL DEFAULT 20"))
        await conn.execute(text(
            "ALTER TABLE standalone_images ADD COLUMN IF NOT EXISTS human_reviewed "
            "INTEGER NOT NULL DEFAULT 0"))
        col_exists = await conn.execute(text(
            "SELECT 1 FROM information_schema.columns WHERE table_name='standalone_images' "
            "AND column_name='classified'"))
        classified_col_is_new = col_exists.first() is None
        await conn.execute(text(
            "ALTER TABLE standalone_images ADD COLUMN IF NOT EXISTS classified "
            "INTEGER NOT NULL DEFAULT 0"))
        if classified_col_is_new:
            # Every pre-existing row already went through the one-time
            # backfill_nsfw.py classification pass — only genuinely new rows
            # from here on start unclassified until their own background
            # classification task completes.
            await conn.execute(text("UPDATE standalone_images SET classified = 1"))
        await conn.execute(text(
            "ALTER TABLE standalone_images ADD COLUMN IF NOT EXISTS is_img2img "
            "INTEGER NOT NULL DEFAULT 0"))
        await conn.execute(text(
            "ALTER TABLE image_rating_reports ADD COLUMN IF NOT EXISTS admin_note "
            "TEXT NOT NULL DEFAULT ''"))
        await conn.execute(text(
            "ALTER TABLE image_rating_reports ADD COLUMN IF NOT EXISTS auto_flagged "
            "INTEGER NOT NULL DEFAULT 0"))
        await conn.execute(text(
            "ALTER TABLE checkpoint_previews ADD COLUMN IF NOT EXISTS model_type TEXT"))
        await conn.execute(text(
            "ALTER TABLE checkpoint_previews ADD COLUMN IF NOT EXISTS default_steps INTEGER"))
        await conn.execute(text(
            "ALTER TABLE checkpoint_previews ADD COLUMN IF NOT EXISTS model_category TEXT"))
        await conn.execute(text(
            "ALTER TABLE lora_previews ADD COLUMN IF NOT EXISTS model_category TEXT"))
        await conn.execute(text(
            "ALTER TABLE lora_previews ADD COLUMN IF NOT EXISTS keywords TEXT"))
        await conn.execute(text(
            "ALTER TABLE model_requests ADD COLUMN IF NOT EXISTS request_type "
            "TEXT NOT NULL DEFAULT 'checkpoint'"))
        await conn.execute(text(
            "ALTER TABLE model_requests ADD COLUMN IF NOT EXISTS host_allowed "
            "INTEGER NOT NULL DEFAULT 1"))
        await conn.execute(text(
            "ALTER TABLE model_requests ADD COLUMN IF NOT EXISTS local_path TEXT"))
        await conn.execute(text(
            "ALTER TABLE model_requests ADD COLUMN IF NOT EXISTS error "
            "TEXT NOT NULL DEFAULT ''"))
        await conn.execute(text(
            "ALTER TABLE model_requests ADD COLUMN IF NOT EXISTS vae_url TEXT"))
        await conn.execute(text(
            "ALTER TABLE model_requests ADD COLUMN IF NOT EXISTS text_encoder_url TEXT"))
        await conn.execute(text(
            "ALTER TABLE flagged_endpoints ADD COLUMN IF NOT EXISTS detail "
            "TEXT NOT NULL DEFAULT ''"))
        # auto-NSFW classification flags for every image-bearing table
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_explicit "
            "INTEGER NOT NULL DEFAULT 0"))
        await conn.execute(text(
            "ALTER TABLE lore ADD COLUMN IF NOT EXISTS is_explicit "
            "INTEGER NOT NULL DEFAULT 0"))
        await conn.execute(text(
            "ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_is_explicit "
            "INTEGER NOT NULL DEFAULT 0"))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_label TEXT"))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS title TEXT"))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS title_status "
            "TEXT NOT NULL DEFAULT 'none'"))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_reason TEXT"))
        # checkpoint_previews/lora_previews started life as image-only tables
        # (checkpoint_name/lora_name + image, both NOT NULL); they're now a
        # general per-model metadata store, so a row can exist with just a
        # display_name/description and no image, or vice versa.
        await conn.execute(text(
            "ALTER TABLE checkpoint_previews ALTER COLUMN image DROP NOT NULL"))
        await conn.execute(text(
            "ALTER TABLE checkpoint_previews ADD COLUMN IF NOT EXISTS display_name TEXT"))
        await conn.execute(text(
            "ALTER TABLE checkpoint_previews ADD COLUMN IF NOT EXISTS description TEXT"))
        await conn.execute(text(
            "ALTER TABLE checkpoint_previews ADD COLUMN IF NOT EXISTS anima_clip_name TEXT"))
        await conn.execute(text(
            "ALTER TABLE checkpoint_previews ADD COLUMN IF NOT EXISTS anima_vae_name TEXT"))
        await conn.execute(text(
            "ALTER TABLE lora_previews ALTER COLUMN image DROP NOT NULL"))
        await conn.execute(text(
            "ALTER TABLE lora_previews ADD COLUMN IF NOT EXISTS display_name TEXT"))
        await conn.execute(text(
            "ALTER TABLE lora_previews ADD COLUMN IF NOT EXISTS description TEXT"))
        await conn.execute(text(
            "ALTER TABLE lora_training_jobs ADD COLUMN IF NOT EXISTS metrics "
            "TEXT NOT NULL DEFAULT '[]'"))
        await conn.execute(text(
            "ALTER TABLE lora_training_jobs ADD COLUMN IF NOT EXISTS transfer_progress "
            "TEXT NOT NULL DEFAULT '{}'"))
        await conn.execute(text(
            "ALTER TABLE lora_training_jobs ADD COLUMN IF NOT EXISTS resume_from_lora TEXT"))
        await conn.execute(text(
            "ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited_at DOUBLE PRECISION"))
        await conn.execute(text(
            "ALTER TABLE comments ADD COLUMN IF NOT EXISTS image TEXT"))
        await conn.execute(text(
            "ALTER TABLE comments ADD COLUMN IF NOT EXISTS image_is_explicit "
            "INTEGER NOT NULL DEFAULT 0"))
        await conn.execute(text(
            "ALTER TABLE comments ADD COLUMN IF NOT EXISTS attachment_kind TEXT"))
        # comment_reactions itself was added this same release; is_super was
        # added right after — a real deployment could already have created
        # the table without it by the time this line landed.
        await conn.execute(text(
            "ALTER TABLE comment_reactions ADD COLUMN IF NOT EXISTS is_super "
            "INTEGER NOT NULL DEFAULT 0"))
        # Same story: custom_emojis existed briefly without is_explicit.
        await conn.execute(text(
            "ALTER TABLE custom_emojis ADD COLUMN IF NOT EXISTS is_explicit "
            "INTEGER NOT NULL DEFAULT 0"))
        await conn.execute(text(
            "ALTER TABLE custom_emojis ADD COLUMN IF NOT EXISTS preview_image TEXT"))
        # content_reports briefly shipped with a "link" column instead of
        # target_id/image before the admin review modal needed to actually
        # show the reported image and resolve it in place (see
        # adminReviewContentModal) — early deployments already have the table
        # without these.
        await conn.execute(text(
            "ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS target_id "
            "TEXT NOT NULL DEFAULT ''"))
        await conn.execute(text(
            "ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS image "
            "TEXT NOT NULL DEFAULT ''"))
        await conn.execute(text(
            "ALTER TABLE standalone_images ADD COLUMN IF NOT EXISTS cfg "
            "REAL NOT NULL DEFAULT 7.0"))
        await conn.execute(text(
            "ALTER TABLE standalone_images ADD COLUMN IF NOT EXISTS upscaler "
            "TEXT NOT NULL DEFAULT ''"))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS role "
            "TEXT NOT NULL DEFAULT 'user'"))
        # Backfill: every existing admin becomes role='admin' (never downgrades
        # an already-set 'dev'). Idempotent — only ever touches rows still
        # sitting at the column's default.
        await conn.execute(text(
            "UPDATE users SET role='admin' WHERE is_admin=1 AND role='user'"))
        # One-time bootstrap of the platform's first Dev-tier account, replacing
        # what used to be a hardcoded username check scattered across the
        # codebase — only runs while no row has role='dev' yet, so once an
        # admin manages Dev grants through the UI this never fires again and
        # never overrides a deliberate later change.
        no_dev_yet = await conn.execute(text("SELECT 1 FROM users WHERE role='dev' LIMIT 1"))
        if no_dev_yet.first() is None:
            await conn.execute(text("UPDATE users SET role='dev' WHERE username='zukaarimoto'"))

    # Bring-your-own-endpoint API keys (per-user and flagged-pending-review) are
    # encrypted at rest so nobody browsing the settings UI or admin panel (not
    # even an admin) can read another user's raw key back out; only the server
    # process can decrypt it to use it in an outbound Authorization header.
    #
    # Key source, in order of preference:
    #   1. SECRET_ENCRYPTION_KEY env var — the key lives outside the database, so
    #      stealing the database alone does not hand over the plaintext keys. This
    #      is the recommended posture for real encryption-at-rest.
    #   2. Fallback: generate once and store in the settings table. Convenient and
    #      non-breaking (no required migration), but the key sits next to the
    #      ciphertext it protects — only guards against casual inspection, not
    #      database theft. Set SECRET_ENCRYPTION_KEY to close that gap.
    env_key = os.environ.get("SECRET_ENCRYPTION_KEY", "").strip()
    if env_key:
        try:
            _fernet = Fernet(env_key.encode())
        except (ValueError, TypeError) as e:
            raise RuntimeError(
                "SECRET_ENCRYPTION_KEY is not a valid Fernet key "
                "(must be 32 url-safe base64-encoded bytes)") from e
        return
    async with _engine.begin() as conn:
        # Multiple workers can race here on first-ever startup (no key row yet).
        # insert...on_conflict_do_nothing + re-select inside the same transaction
        # makes every worker converge on whichever row actually won, instead of
        # each one generating and using its own key (which would silently make
        # ciphertext written by one worker undecryptable by another).
        generated = Fernet.generate_key()
        await conn.execute(
            pg_insert(settings).values(key="_secret_enc_key", value=generated.decode())
            .on_conflict_do_nothing(index_elements=[settings.c.key]))
        res = await conn.execute(
            select(settings.c.value).where(settings.c.key == "_secret_enc_key"))
        key = res.fetchone()[0].encode()
    _fernet = Fernet(key)


def _encrypt_secret(s: str) -> str:
    if not s:
        return s
    return "enc:" + _fernet.encrypt(s.encode()).decode()


def _decrypt_secret(s: str) -> str:
    if not s or not s.startswith("enc:"):
        return s   # legacy plaintext (stored before encryption was added) — used as-is
    try:
        return _fernet.decrypt(s[len("enc:"):].encode()).decode()
    except InvalidToken:
        return ""


def _encrypt_json_list(items) -> str:
    return _encrypt_secret(json.dumps(items or []))


def _decrypt_json_list(s) -> list:
    return _loads(_decrypt_secret(s or ""), [])


async def close():
    if _engine:
        await _engine.dispose()


# ── query helpers ────────────────────────────────────────────────────────────

async def _q(stmt) -> list[dict]:
    async with _engine.connect() as conn:
        res = await conn.execute(stmt)
        return [dict(r._mapping) for r in res.fetchall()]


async def _q1(stmt) -> dict | None:
    async with _engine.connect() as conn:
        res = await conn.execute(stmt)
        row = res.fetchone()
        return dict(row._mapping) if row else None


async def _scalar(stmt):
    async with _engine.connect() as conn:
        res = await conn.execute(stmt)
        return res.scalar()


async def _w(stmt):
    async with _engine.begin() as conn:
        await conn.execute(stmt)


# ── helpers ──────────────────────────────────────────────────────────────────

def _loads(v, default):
    try:
        return json.loads(v) if v else default
    except Exception:
        return default


# ── passwords ────────────────────────────────────────────────────────────────

SESSION_TTL = 60 * 60 * 24 * 30   # 30 days


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000)
    return f"{salt}:{dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, dk_hex = stored.split(":", 1)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000)
        return secrets.compare_digest(dk.hex(), dk_hex)
    except Exception:
        return False


# ── users ────────────────────────────────────────────────────────────────────

def _user_row(row) -> dict:
    d = dict(row)
    d.pop("password_hash", None)
    d.pop("identity_label", None)   # admin-only; exposed solely via list_users
    d["is_admin"] = bool(d.get("is_admin"))
    d["nsfw_allowed"] = bool(d.get("nsfw_allowed"))
    try:
        d["social_links"] = json.loads(d.get("social_links") or "{}")
    except (json.JSONDecodeError, TypeError):
        d["social_links"] = {}
    d["profile_html"] = _decrypt_secret(d.get("profile_html") or "")
    if "bio" in d:
        d["bio"] = _decrypt_secret(d.get("bio") or "")
    if "display_name" in d:
        d["display_name"] = _decrypt_secret(d.get("display_name") or "")
    if "suspension_reason" in d:
        d["suspension_reason"] = _decrypt_secret(d.get("suspension_reason") or "") or None
    return d


async def get_user_by_username(username: str) -> dict | None:
    """Returns the full row including password_hash for login verification."""
    return await _q1(select(users).where(users.c.username == username.strip().lower()))


# ── auth sessions ────────────────────────────────────────────────────────────


# ── per-user settings ────────────────────────────────────────────────────────

async def get_user_settings(user_id: str) -> dict:
    rows = await _q(select(user_settings.c.key, user_settings.c.value)
                    .where(user_settings.c.user_id == user_id))
    out = {}
    for r in rows:
        try:
            out[r["key"]] = json.loads(r["value"])
        except Exception:
            out[r["key"]] = r["value"]
    if out.get("api_key"):
        out["api_key"] = _decrypt_secret(out["api_key"])
    return out


# ── characters ───────────────────────────────────────────────────────────────

def _char_row(row) -> dict:
    d = dict(row)
    d["name"] = _decrypt_secret(d.get("name") or "")
    d["creator"] = _decrypt_secret(d.get("creator") or "")
    d["tags"] = _decrypt_json_list(d.get("tags"))
    d["persona"] = _decrypt_secret(d.get("persona") or "")
    d["scenario"] = _decrypt_secret(d.get("scenario") or "")
    d["greeting"] = _decrypt_secret(d.get("greeting") or "")
    d["dialogue"] = _decrypt_secret(d.get("dialogue") or "")
    d["system_prompt"] = _decrypt_secret(d.get("system_prompt") or "")
    d["description"] = _decrypt_secret(d.get("description") or "")
    d["alt_greetings"] = _decrypt_json_list(d.get("alt_greetings"))
    d["assets"] = _loads(d.get("assets"), {})
    d["is_public"] = bool(d.get("is_public"))
    d["can_be_persona"] = bool(d.get("can_be_persona"))
    d["allow_download"] = bool(d.get("allow_download"))
    d["is_explicit"] = bool(d.get("is_explicit"))
    d["is_draft"] = bool(d.get("is_draft"))
    return d


async def get_character(cid: str) -> dict | None:
    row = await _q1(select(characters).where(characters.c.id == cid))
    if not row:
        return None
    c = _char_row(row)
    c["chats"] = await _scalar(
        select(func.count()).select_from(sessions).where(sessions.c.char_id == cid))
    c["owner_username"] = await _owner_username(c.get("owner_id"))
    return c


async def _owner_username(owner_id: str | None) -> str | None:
    if not owner_id:
        return None
    return await _scalar(select(users.c.username).where(users.c.id == owner_id))


async def list_public_users(q: str | None = None) -> list[dict]:
    """Public creator directory. Lists every active user as a potential
    creator to browse — publishing a character or filling in a profile isn't
    required, `public_characters` is just 0 for those who haven't. Excludes
    only deactivated/non-active accounts (see `users.status`); admins are
    left in since an admin can be a genuine, prolific creator in their own
    right (e.g. one with several public characters) — excluding the role
    would just hide real content from the directory. Supports q against
    username/display_name."""
    counts = await _q(select(characters.c.owner_id, func.count().label("n"))
                      .where(characters.c.is_public == 1)
                      .group_by(characters.c.owner_id))
    pub_counts = {r["owner_id"]: r["n"] for r in counts if r["owner_id"]}
    ql = (q or "").strip().lower()
    out = []
    for r in await _q(select(users).where(users.c.status == "active")):
        u = _user_row(r)
        n = pub_counts.get(u["id"], 0)
        bio = (u.get("bio") or "").strip()
        if ql and ql not in u["username"].lower() and ql not in (u.get("display_name") or "").lower():
            continue
        out.append({
            "id": u["id"],
            "username": u["username"],
            "display_name": u.get("display_name") or "",
            "avatar": u.get("avatar") or "",
            "bio": bio[:180],
            "public_characters": n,
            "banner_img": u.get("banner_img") or "",
            "banner_color": u.get("banner_color") or "",
            "accent_color": u.get("accent_color") or "",
            "is_explicit": bool(u.get("is_explicit")),
        })
    out.sort(key=lambda x: (-x["public_characters"], x["username"]))
    return out


async def list_characters(q: str | None = None, user_id: str | None = None,
                           is_admin: bool = False,
                           scope: str | None = None,
                           tags: list[str] | None = None,
                           creator: str | None = None) -> list[dict]:
    """Return characters filtered by scope.

    scope='mine'      → owner's private characters only
    scope='community' → public characters (is_public=1)
    scope='drafts'    → owner's own autosaved-but-not-yet-finished characters only
    scope=None        → public + user's own (legacy / admin uses all)

    Drafts never appear under any other scope — they're a distinct, separate
    bucket (see the "Pending" library tab) until their author actually finishes
    and saves them for real, not half-written characters mixed into everyone's
    normal browsing.
    """
    conditions = []
    if creator:
        cl = creator.strip().lower()
        owner_rows = await _q(select(users.c.id, users.c.username, users.c.display_name))
        owner_ids_match = [
            r["id"] for r in owner_rows
            if (r.get("username") or "").lower() == cl
            or _decrypt_secret(r.get("display_name") or "").lower() == cl]
        if not owner_ids_match:
            return []
        conditions.append(characters.c.owner_id.in_(owner_ids_match))
    if scope == "drafts":
        conditions.append(and_(characters.c.owner_id == (user_id or ""),
                               characters.c.is_draft == 1))
    elif scope == "mine":
        conditions.append(and_(characters.c.owner_id == (user_id or ""),
                               characters.c.is_draft == 0))
    elif scope == "community":
        conditions.append(and_(characters.c.is_public == 1, characters.c.is_draft == 0))
    else:
        conditions.append(characters.c.is_draft == 0)
        if user_id:
            conditions.append(or_(characters.c.is_public == 1,
                                  characters.c.owner_id == user_id))
        else:
            conditions.append(characters.c.is_public == 1)

    # `persona` is encrypted at rest, so it can't be matched with SQL LIKE.
    # Rather than split the match across a SQL pass (name/tags) and a Python
    # pass (persona) — which would miss rows where only persona matches but
    # name/tags don't — the scope filter runs in SQL and the full text match
    # (name + tags + persona) runs in Python on the decrypted rows below.
    chats = (select(func.count()).select_from(sessions)
             .where(sessions.c.char_id == characters.c.id)
             .scalar_subquery().label("chats"))
    stmt = select(characters, chats)
    if conditions:
        stmt = stmt.where(and_(*conditions))
    stmt = stmt.order_by(characters.c.created.desc())
    rows = [_char_row(r) for r in await _q(stmt)]
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in r["name"].lower()
                or ql in r["persona"].lower() or ql in json.dumps(r["tags"]).lower()]
    if tags:
        want = {tg.strip().lower() for tg in tags if tg.strip()}
        if want:
            rows = [r for r in rows
                    if want & {str(tg).lower() for tg in (r.get("tags") or [])}]
    owner_ids = {c["owner_id"] for c in rows if c.get("owner_id")}
    usernames: dict[str, str] = {}
    if owner_ids:
        urows = await _q(select(users.c.id, users.c.username)
                         .where(users.c.id.in_(list(owner_ids))))
        usernames = {r["id"]: r["username"] for r in urows}
    for c in rows:
        c["owner_username"] = usernames.get(c.get("owner_id"))
    return rows


# ── personas ─────────────────────────────────────────────────────────────────

def _persona_row(row) -> dict:
    d = dict(row)
    d["name"] = _decrypt_secret(d.get("name") or "")
    d["description"] = _decrypt_secret(d.get("description") or "")
    d["is_draft"] = bool(d.get("is_draft"))
    return d


async def get_persona(pid: str) -> dict | None:
    row = await _q1(select(personas).where(personas.c.id == pid))
    return _persona_row(row) if row else None


# ── lore ─────────────────────────────────────────────────────────────────────

def _lore_row(row) -> dict:
    d = dict(row)
    d["content"] = _decrypt_secret(d.get("content") or "")
    d["name"] = _decrypt_secret(d.get("name") or "")
    d["appearance_tags"] = _decrypt_secret(d.get("appearance_tags") or "")
    d["appearance_tags_negative"] = _decrypt_secret(d.get("appearance_tags_negative") or "")
    d["keys"] = [k for k in _decrypt_secret(d.get("keys") or "").split(",") if k]
    d["always"] = bool(d.get("always"))
    d["hidden"] = bool(d.get("hidden"))
    d["is_explicit"] = bool(d.get("is_explicit"))
    d["global"] = d.get("char_id") is None
    return d


async def list_lore(char_id: str) -> list[dict]:
    stmt = (select(lore)
            .where(or_(lore.c.char_id == char_id, lore.c.char_id.is_(None)))
            .order_by(lore.c.always.desc(), lore.c.created.desc()))
    return [_lore_row(r) for r in await _q(stmt)]


async def lore_by_ids(ids: list[str]) -> list[dict]:
    if not ids:
        return []
    return [_lore_row(r) for r in await _q(select(lore).where(lore.c.id.in_(ids)))]


# ── sessions ─────────────────────────────────────────────────────────────────


async def get_session(sid: str) -> dict | None:
    s = await _q1(select(sessions).where(sessions.c.id == sid))
    if not s:
        return None
    s["title"] = _decrypt_secret(s.get("title") or "")
    s["author_note"] = _decrypt_secret(s.get("author_note") or "")
    s["glossary"] = _decrypt_secret(s.get("glossary") or "")
    s["style_prompt"] = _decrypt_secret(s.get("style_prompt") or "")
    s["user_name"] = _decrypt_secret(s.get("user_name") or "")
    s["char_doing"] = _decrypt_secret(s.get("char_doing") or "") or None
    s["char_location"] = _decrypt_secret(s.get("char_location") or "") or None
    s["known_names"] = _decrypt_secret(s.get("known_names") or "") or "[]"
    s["messages"] = await get_messages(sid)
    return s


# ── messages ─────────────────────────────────────────────────────────────────


async def get_messages(sid: str) -> list[dict]:
    stmt = (select(messages.c.id, messages.c.role, messages.c.content,
                   messages.c.ts, messages.c.image, messages.c.lang)
            .where(messages.c.session_id == sid).order_by(messages.c.seq.asc()))
    rows = await _q(stmt)
    for r in rows:
        r["content"] = _decrypt_secret(r.get("content") or "")
    return rows


def _standalone_row(r) -> dict:
    d = dict(r)
    d["is_public"] = bool(d.get("is_public"))
    d["is_explicit"] = bool(d.get("is_explicit"))
    d["human_reviewed"] = bool(d.get("human_reviewed"))
    d["classified"] = bool(d.get("classified"))
    d["is_img2img"] = bool(d.get("is_img2img"))
    try:
        d["loras"] = json.loads(d.get("loras") or "[]")
    except (json.JSONDecodeError, TypeError):
        d["loras"] = []
    d["checkpoint"] = d.get("checkpoint") or ""
    d["sampler"] = d.get("sampler") or ""
    d["scheduler"] = d.get("scheduler") or ""
    d["steps"] = d.get("steps") or 20
    return d


async def get_standalone_image(iid: str) -> dict | None:
    row = await _q1(select(standalone_images).where(standalone_images.c.id == iid))
    return _standalone_row(row) if row else None


def _decode_lora_job_metrics(row: dict) -> dict:
    try:
        row["metrics"] = json.loads(row.get("metrics") or "[]")
    except Exception:
        row["metrics"] = []
    try:
        row["transfer_progress"] = json.loads(row.get("transfer_progress") or "{}")
    except Exception:
        row["transfer_progress"] = {}
    return row


async def create_password_reset_request(user_id: str, username: str) -> str:
    rid = nid("pr")
    await _w(insert(password_reset_requests).values(
        id=rid, user_id=user_id, username=username,
        status="pending", created=time.time()))
    return rid


# ── global settings ──────────────────────────────────────────────────────────


async def set_settings(items: dict):
    async with _engine.begin() as conn:
        for k, v in items.items():
            stmt = pg_insert(settings).values(key=k, value=json.dumps(v))
            stmt = stmt.on_conflict_do_update(
                index_elements=["key"], set_={"value": stmt.excluded.value})
            await conn.execute(stmt)


# ── checkpoint/LoRA preview images + metadata ───────────────────────────────
# checkpoint_previews and lora_previews are a general per-model metadata store
# keyed by the raw filename ComfyUI reports: an optional /media/... reference
# image, plus an optional admin-set display_name/description. Any of the three
# may be present without the others (a row can carry just a friendly name with
# no image, or just an image with no name).

def _parse_model_categories(raw) -> list[str]:
    """model_category is stored as a JSON array (a model can be compatible
    with more than one architecture — e.g. a merge trained to work under both
    SDXL and IL conventions) — but pre-existing rows from before that stored
    a bare string ("sdxl"), so both shapes are handled here."""
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(x) for x in parsed if x]
        if isinstance(parsed, str):
            return [parsed]
    except (json.JSONDecodeError, TypeError):
        pass
    return [raw] if isinstance(raw, str) else []


def _model_meta_row(r: dict) -> dict:
    row = {"image": r.get("image"), "display_name": r.get("display_name"),
           "description": r.get("description")}
    if "model_type" in r:
        row["model_type"] = r.get("model_type")
    if "default_steps" in r:
        row["default_steps"] = r.get("default_steps")
    if "model_category" in r:
        row["model_category"] = _parse_model_categories(r.get("model_category"))
    if "anima_clip_name" in r:
        row["anima_clip_name"] = r.get("anima_clip_name")
    if "anima_vae_name" in r:
        row["anima_vae_name"] = r.get("anima_vae_name")
    if "keywords" in r:
        row["keywords"] = _parse_model_categories(r.get("keywords"))
    return row


async def _list_model_previews(table, name_col) -> dict:
    cols = [name_col, table.c.image, table.c.display_name, table.c.description]
    if "model_type" in table.c:
        cols.append(table.c.model_type)
    if "default_steps" in table.c:
        cols.append(table.c.default_steps)
    if "model_category" in table.c:
        cols.append(table.c.model_category)
    if "anima_clip_name" in table.c:
        cols.append(table.c.anima_clip_name)
    if "anima_vae_name" in table.c:
        cols.append(table.c.anima_vae_name)
    if "keywords" in table.c:
        cols.append(table.c.keywords)
    rows = await _q(select(*cols))
    return {r[name_col.name]: _model_meta_row(r) for r in rows}


async def _set_model_preview_image(table, name_col, name: str, image: str):
    stmt = pg_insert(table).values(**{name_col.name: name}, image=image)
    stmt = stmt.on_conflict_do_update(
        index_elements=[name_col.name], set_={"image": stmt.excluded.image})
    await _w(stmt)


async def _clear_model_preview_image(table, name_col, name: str):
    stmt = pg_insert(table).values(**{name_col.name: name}, image=None)
    stmt = stmt.on_conflict_do_update(
        index_elements=[name_col.name], set_={"image": None})
    await _w(stmt)


_UNSET = object()


async def _set_model_meta(table, name_col, name: str, display_name: str | None,
                          description: str | None, model_type: str | None = None,
                          default_steps: int | None = None,
                          model_category=_UNSET, keywords=_UNSET):
    values = {name_col.name: name, "display_name": display_name, "description": description}
    if "model_type" in table.c:
        values["model_type"] = model_type
    if "default_steps" in table.c:
        values["default_steps"] = default_steps
    # _UNSET (checkpoints, which no longer expose a way to set this) leaves
    # whatever's already stored untouched instead of overwriting it to null
    # on every save of an unrelated field (name/description/etc).
    if "model_category" in table.c and model_category is not _UNSET:
        values["model_category"] = json.dumps(model_category) if model_category else None
    if "keywords" in table.c and keywords is not _UNSET:
        values["keywords"] = json.dumps(keywords) if keywords else None
    stmt = pg_insert(table).values(**values)
    set_ = {k: stmt.excluded[k] for k in values if k != name_col.name}
    stmt = stmt.on_conflict_do_update(index_elements=[name_col.name], set_=set_)
    await _w(stmt)


# ── localization cache ──────────────────────────────────────────────────────
# Every translated string (UI chrome, scenarios, character text) is stored once
# per (source-hash, language) so the same text is never sent to the LLM twice.

async def get_localizations(hashes: list[str], lang: str) -> dict:
    """Return {src_hash: translated} for the hashes already cached in `lang`."""
    if not hashes:
        return {}
    out = {}
    for i in range(0, len(hashes), 500):
        chunk = hashes[i:i + 500]
        rows = await _q(select(localization.c.src_hash, localization.c.translated)
                        .where(and_(localization.c.lang == lang,
                                    localization.c.src_hash.in_(chunk))))
        for r in rows:
            out[r["src_hash"]] = r["translated"]
    return out


# ── admin ────────────────────────────────────────────────────────────────────

# ── comments ─────────────────────────────────────────────────────────────────


# Emoji reaction limits are enforced by whoever calls these (see
# routers/comments.py) — this layer just does the actual toggle.
_MAX_REACTION_EMOJI_LEN = 8   # a couple of codepoints is plenty for any real emoji


# ── custom emoji / stickers ──────────────────────────────────────────────
_SHORTCODE_RE = re.compile(r"^[a-z0-9_]{2,32}$")


# ── forum ────────────────────────────────────────────────────────────────


# ── notifications ────────────────────────────────────────────────────────────


async def count_char_sessions(cid: str) -> int:
    return await _scalar(select(func.count()).select_from(sessions)
                         .where(sessions.c.char_id == cid)) or 0


# ── service health ───────────────────────────────────────────────────────────


# ── user blocks ──────────────────────────────────────────────────────────────


async def is_block_between(a: str, b: str) -> bool:
    r = await _q1(select(user_blocks.c.blocker_id).where(or_(
        and_(user_blocks.c.blocker_id == a, user_blocks.c.blocked_id == b),
        and_(user_blocks.c.blocker_id == b, user_blocks.c.blocked_id == a))))
    return bool(r)


async def hidden_user_ids(viewer_id: str) -> set:
    rows = await _q(select(user_blocks).where(or_(
        user_blocks.c.blocker_id == viewer_id,
        user_blocks.c.blocked_id == viewer_id)))
    out = set()
    for r in rows:
        out.add(r["blocked_id"] if r["blocker_id"] == viewer_id else r["blocker_id"])
    return out


