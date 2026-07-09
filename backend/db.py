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


async def any_users() -> bool:
    return (await _scalar(select(func.count()).select_from(users))) > 0


async def create_user(username: str, password: str, is_admin: bool = False,
                      status: str = "active") -> dict:
    uid = nid("u")
    await _w(insert(users).values(
        id=uid, username=username.strip().lower(),
        password_hash=hash_password(password), is_admin=int(is_admin),
        status=status, created=time.time()))
    return await get_user_by_id(uid)


async def get_user_by_id(uid: str) -> dict | None:
    row = await _q1(select(users).where(users.c.id == uid))
    return _user_row(row) if row else None


async def set_user_nsfw_allowed(uid: str, allowed: bool) -> dict | None:
    await _w(update(users).where(users.c.id == uid).values(
        nsfw_allowed=int(bool(allowed))))
    return await get_user_by_id(uid)


async def update_user_profile(uid: str, data: dict):
    """Profile fields only — never auth/role fields."""
    allowed = {k: data[k] for k in ("display_name", "bio", "avatar", "banner_color",
                                    "accent_color", "banner_img", "social_links",
                                    "profile_html", "is_explicit",
                                    "title", "title_status") if k in data}
    if not allowed:
        return
    if "social_links" in allowed:
        allowed["social_links"] = json.dumps(allowed["social_links"] or {})
    if "bio" in allowed:
        allowed["bio"] = _encrypt_secret(allowed["bio"] or "")
    if "display_name" in allowed:
        allowed["display_name"] = _encrypt_secret(allowed["display_name"] or "")
    if "profile_html" in allowed:
        allowed["profile_html"] = _encrypt_secret(allowed["profile_html"] or "")
    await _w(update(users).where(users.c.id == uid).values(**allowed))


async def public_characters_by_owner(uid: str) -> list[dict]:
    chats = (select(func.count()).select_from(sessions)
             .where(sessions.c.char_id == characters.c.id)
             .scalar_subquery().label("chats"))
    stmt = (select(characters, chats)
            .where(and_(characters.c.owner_id == uid, characters.c.is_public == 1))
            .order_by(characters.c.created.desc()))
    return [_char_row(row) for row in await _q(stmt)]


async def get_user_by_username(username: str) -> dict | None:
    """Returns the full row including password_hash for login verification."""
    return await _q1(select(users).where(users.c.username == username.strip().lower()))


async def list_users() -> list[dict]:
    rows = await _q(select(users).order_by(users.c.created.asc()))
    out = []
    for r in rows:
        d = _user_row(r)
        d["identity_label"] = _decrypt_secret(r.get("identity_label") or "") or None
        out.append(d)
    return out


async def set_identity_label(uid: str, label: str | None):
    value = _encrypt_secret(label) if label else None
    await _w(update(users).where(users.c.id == uid).values(identity_label=value))


async def update_user_password(uid: str, new_password: str):
    await _w(update(users).where(users.c.id == uid).values(
        password_hash=hash_password(new_password)))


async def update_user_role(uid: str, is_admin: bool):
    await _w(update(users).where(users.c.id == uid).values(is_admin=int(is_admin)))


async def list_admin_user_ids() -> list[str]:
    stmt = select(users.c.id).where(and_(
        users.c.is_admin == 1, users.c.status == "active"))
    return [r["id"] for r in await _q(stmt)]


async def delete_user(uid: str):
    async with _engine.begin() as conn:
        await conn.execute(delete(auth_sessions).where(auth_sessions.c.user_id == uid))
        await conn.execute(delete(user_settings).where(user_settings.c.user_id == uid))
        await conn.execute(delete(admin_notes).where(or_(
            admin_notes.c.user_id == uid, admin_notes.c.author_id == uid)))
        await conn.execute(delete(users).where(users.c.id == uid))


# ── auth sessions ────────────────────────────────────────────────────────────

async def create_auth_session(user_id: str) -> str:
    token = secrets.token_hex(32)
    await _w(insert(auth_sessions).values(
        token=token, user_id=user_id, expires=time.time() + SESSION_TTL))
    return token


async def delete_other_user_sessions(uid: str, keep_token: str | None = None):
    stmt = delete(auth_sessions).where(auth_sessions.c.user_id == uid)
    if keep_token:
        stmt = stmt.where(auth_sessions.c.token != keep_token)
    await _w(stmt)


async def get_session_user(token: str) -> dict | None:
    stmt = (select(users)
            .select_from(users.join(auth_sessions, users.c.id == auth_sessions.c.user_id))
            .where(and_(auth_sessions.c.token == token,
                        auth_sessions.c.expires > time.time(),
                        users.c.status == "active")))
    row = await _q1(stmt)
    return _user_row(row) if row else None


async def update_user_status(uid: str, status: str):
    await _w(update(users).where(users.c.id == uid).values(status=status))


async def suspend_user(uid: str, reason: str | None):
    await _w(update(users).where(users.c.id == uid).values(
        status="suspended",
        suspension_reason=_encrypt_secret(reason) if reason else None))


async def unsuspend_user(uid: str):
    await _w(update(users).where(users.c.id == uid).values(
        status="active", suspension_reason=None))


async def delete_auth_session(token: str):
    await _w(delete(auth_sessions).where(auth_sessions.c.token == token))


async def cleanup_expired_sessions():
    await _w(delete(auth_sessions).where(auth_sessions.c.expires < time.time()))


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


async def set_user_settings(user_id: str, items: dict):
    """Upsert non-None values; delete the key when value is None."""
    async with _engine.begin() as conn:
        for k, v in items.items():
            if v is None:
                await conn.execute(delete(user_settings).where(and_(
                    user_settings.c.user_id == user_id, user_settings.c.key == k)))
                continue
            if k == "api_key" and isinstance(v, str) and v:
                v = _encrypt_secret(v)
            stmt = pg_insert(user_settings).values(
                user_id=user_id, key=k, value=json.dumps(v))
            stmt = stmt.on_conflict_do_update(
                index_elements=["user_id", "key"],
                set_={"value": stmt.excluded.value})
            await conn.execute(stmt)


async def clear_user_settings(user_id: str):
    await _w(delete(user_settings).where(user_settings.c.user_id == user_id))


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


async def create_character(data: dict) -> dict:
    cid = nid("c")
    mode = data.get("mode", "character")
    if mode not in ("character", "rpg"):
        mode = "character"
    await _w(insert(characters).values(
        id=cid,
        name=_encrypt_secret(data.get("name") or "Unnamed"),
        persona=_encrypt_secret(data.get("persona") or ""),
        scenario=_encrypt_secret(data.get("scenario") or ""),
        greeting=_encrypt_secret(data.get("greeting") or ""),
        dialogue=_encrypt_secret(data.get("dialogue") or ""),
        system_prompt=_encrypt_secret(data.get("system_prompt") or ""),
        tags=_encrypt_json_list(data.get("tags") or []),
        creator=_encrypt_secret(data.get("creator") or "you"),
        avatar=data.get("avatar") or "",
        alt_greetings=_encrypt_json_list(data.get("alt_greetings") or []),
        mode=mode,
        assets=json.dumps(data.get("assets") or {}),
        owner_id=data.get("owner_id"),
        is_public=int(bool(data.get("is_public", False))),
        presentation_html=data.get("presentation_html") or "",
        can_be_persona=int(bool(data.get("can_be_persona", False))),
        allow_download=int(bool(data.get("allow_download", False))),
        description=_encrypt_secret(data.get("description") or ""),
        is_explicit=int(bool(data.get("is_explicit", False))),
        is_draft=int(bool(data.get("is_draft", False))),
        created=time.time()))
    return await get_character(cid)


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


async def update_character(cid: str, data: dict) -> dict | None:
    c = await get_character(cid)
    if not c:
        return None
    mode = data.get("mode", c["mode"])
    if mode not in ("character", "rpg"):
        mode = "character"
    # owner_id is preserved — only the original creator keeps ownership
    owner_id = c.get("owner_id")
    is_public = int(bool(data.get("is_public", c.get("is_public", False))))
    await _w(update(characters).where(characters.c.id == cid).values(
        name=_encrypt_secret(data.get("name") or c["name"]),
        persona=_encrypt_secret(data.get("persona", c["persona"]) or ""),
        scenario=_encrypt_secret(data.get("scenario", c["scenario"]) or ""),
        greeting=_encrypt_secret(data.get("greeting", c["greeting"]) or ""),
        dialogue=_encrypt_secret(data.get("dialogue", c["dialogue"]) or ""),
        system_prompt=_encrypt_secret(data.get("system_prompt", c.get("system_prompt", "")) or ""),
        tags=_encrypt_json_list(data.get("tags", c["tags"])),
        creator=_encrypt_secret(data.get("creator", c["creator"])),
        avatar=data.get("avatar", c["avatar"]),
        alt_greetings=_encrypt_json_list(data.get("alt_greetings", c["alt_greetings"])),
        mode=mode,
        assets=json.dumps(data.get("assets", c["assets"]) or {}),
        owner_id=owner_id,
        is_public=is_public,
        presentation_html=data.get("presentation_html", c.get("presentation_html", "")),
        can_be_persona=int(bool(data.get("can_be_persona", c.get("can_be_persona", False)))),
        allow_download=int(bool(data.get("allow_download", c.get("allow_download", False)))),
        description=_encrypt_secret(data.get("description", c.get("description", "")) or ""),
        is_explicit=int(bool(data.get("is_explicit", c.get("is_explicit", False)))),
        is_draft=int(bool(data.get("is_draft", c.get("is_draft", False))))))
    return await get_character(cid)


async def delete_character(cid: str) -> list[str]:
    """Delete character and all related data. Returns list of deleted session ids."""
    sids = [r["id"] for r in await _q(
        select(sessions.c.id).where(sessions.c.char_id == cid))]
    async with _engine.begin() as conn:
        if sids:
            await conn.execute(delete(messages).where(messages.c.session_id.in_(sids)))
        await conn.execute(delete(sessions).where(sessions.c.char_id == cid))
        await conn.execute(delete(lore).where(lore.c.char_id == cid))
        await conn.execute(delete(characters).where(characters.c.id == cid))
    return sids


# ── personas ─────────────────────────────────────────────────────────────────

def _persona_row(row) -> dict:
    d = dict(row)
    d["name"] = _decrypt_secret(d.get("name") or "")
    d["description"] = _decrypt_secret(d.get("description") or "")
    d["is_draft"] = bool(d.get("is_draft"))
    return d


async def create_persona(data: dict, user_id: str = None) -> dict:
    pid = nid("p")
    async with _engine.begin() as conn:
        if data.get("is_default"):
            await conn.execute(update(personas)
                               .where(personas.c.owner_id == user_id)
                               .values(is_default=0))
        await conn.execute(insert(personas).values(
            id=pid, name=_encrypt_secret(data.get("name") or "You"),
            description=_encrypt_secret(data.get("description") or ""),
            is_default=1 if data.get("is_default") else 0,
            is_draft=1 if data.get("is_draft") else 0,
            owner_id=user_id, created=time.time()))
    return await get_persona(pid)


async def get_persona(pid: str) -> dict | None:
    row = await _q1(select(personas).where(personas.c.id == pid))
    return _persona_row(row) if row else None


async def list_personas(user_id: str = None) -> list[dict]:
    stmt = (select(personas).where(personas.c.owner_id == user_id)
            .order_by(personas.c.is_default.desc(), personas.c.created.desc()))
    return [_persona_row(r) for r in await _q(stmt)]


async def list_own_personas(user_id: str = None) -> list[dict]:
    """Personas the user created directly — excludes ones auto-linked to a
    can_be_persona character, so those don't clutter the Personas library."""
    stmt = (select(personas)
            .where(and_(personas.c.owner_id == user_id,
                        personas.c.source_char_id.is_(None),
                        personas.c.is_draft == 0))
            .order_by(personas.c.is_default.desc(), personas.c.created.desc()))
    return [_persona_row(r) for r in await _q(stmt)]


async def list_draft_personas(user_id: str = None) -> list[dict]:
    """A user's own unfinished (autosaved) personas, for the Pending tab."""
    stmt = (select(personas)
            .where(and_(personas.c.owner_id == user_id,
                        personas.c.source_char_id.is_(None),
                        personas.c.is_draft == 1))
            .order_by(personas.c.created.desc()))
    return [_persona_row(r) for r in await _q(stmt)]


async def list_persona_pool_characters(user_id: str = None, is_admin: bool = False) -> list[dict]:
    """Characters flagged can_be_persona that the user is allowed to play as."""
    conditions = [characters.c.can_be_persona == 1]
    if user_id:
        conditions.append(or_(characters.c.is_public == 1,
                              characters.c.owner_id == user_id))
    else:
        conditions.append(characters.c.is_public == 1)
    stmt = select(characters).where(and_(*conditions))
    rows = [_char_row(r) for r in await _q(stmt)]
    rows.sort(key=lambda c: (c.get("name") or "").lower())
    return rows


async def get_or_create_persona_from_character(char: dict, user_id: str = None) -> dict:
    row = await _q1(select(personas).where(and_(
        personas.c.source_char_id == char["id"], personas.c.owner_id == user_id)))
    if row:
        return _persona_row(row)
    pid = nid("p")
    await _w(insert(personas).values(
        id=pid, name=_encrypt_secret(char["name"]),
        description=_encrypt_secret(char.get("persona") or ""),
        is_default=0, owner_id=user_id, source_char_id=char["id"],
        created=time.time()))
    return await get_persona(pid)


async def default_persona(user_id: str = None) -> dict | None:
    row = await _q1(select(personas).where(and_(
        personas.c.is_default == 1, personas.c.owner_id == user_id)).limit(1))
    return _persona_row(row) if row else None


async def update_persona(pid: str, data: dict, user_id: str = None) -> dict | None:
    p = await get_persona(pid)
    if not p:
        return None
    async with _engine.begin() as conn:
        if data.get("is_default"):
            await conn.execute(update(personas)
                               .where(personas.c.owner_id == user_id)
                               .values(is_default=0))
        vals = dict(
            name=_encrypt_secret(data.get("name", p["name"])),
            description=_encrypt_secret(data.get("description", p["description"]) or ""),
            is_default=1 if data.get("is_default") else p["is_default"])
        if "is_draft" in data:
            vals["is_draft"] = 1 if data.get("is_draft") else 0
        await conn.execute(update(personas).where(personas.c.id == pid).values(**vals))
    return await get_persona(pid)


async def delete_persona(pid: str):
    await _w(delete(personas).where(personas.c.id == pid))


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


def _lore_keys(keys) -> str:
    if isinstance(keys, list):
        return ",".join(k.strip() for k in keys if k.strip())
    return ",".join(k.strip() for k in str(keys or "").split(",") if k.strip())


async def create_lore(char_id, keys, content, always, image="", category="", hidden=False, name="",
                      appearance_tags="", appearance_tags_negative="", is_explicit=False) -> str:
    lid = nid("l")
    await _w(insert(lore).values(
        id=lid, char_id=char_id, keys=_encrypt_secret(_lore_keys(keys)),
        content=_encrypt_secret(content or ""), always=1 if always else 0,
        image=image, category=category, hidden=1 if hidden else 0,
        name=_encrypt_secret(name or ""),
        appearance_tags=_encrypt_secret(appearance_tags or ""),
        appearance_tags_negative=_encrypt_secret(appearance_tags_negative or ""),
        is_explicit=1 if is_explicit else 0, created=time.time()))
    return lid


async def get_lore(lid: str) -> dict | None:
    row = await _q1(select(lore).where(lore.c.id == lid))
    return _lore_row(row) if row else None


async def list_lore(char_id: str) -> list[dict]:
    stmt = (select(lore)
            .where(or_(lore.c.char_id == char_id, lore.c.char_id.is_(None)))
            .order_by(lore.c.always.desc(), lore.c.created.desc()))
    return [_lore_row(r) for r in await _q(stmt)]


async def lore_by_ids(ids: list[str]) -> list[dict]:
    if not ids:
        return []
    return [_lore_row(r) for r in await _q(select(lore).where(lore.c.id.in_(ids)))]


async def update_lore(lid: str, keys, content, always, image=None, category=None, hidden=None, name=None,
                      appearance_tags=None, appearance_tags_negative=None, is_explicit=None) -> bool:
    cur = await get_lore(lid)
    if not cur:
        return False
    await _w(update(lore).where(lore.c.id == lid).values(
        keys=_encrypt_secret(_lore_keys(keys)), content=_encrypt_secret(content or ""),
        always=1 if always else 0,
        image=cur["image"] if image is None else image,
        category=cur["category"] if category is None else category,
        hidden=(1 if cur["hidden"] else 0) if hidden is None else (1 if hidden else 0),
        name=_encrypt_secret(cur["name"] if name is None else name),
        appearance_tags=_encrypt_secret(cur["appearance_tags"] if appearance_tags is None else appearance_tags),
        appearance_tags_negative=_encrypt_secret(cur["appearance_tags_negative"] if appearance_tags_negative is None else appearance_tags_negative),
        is_explicit=(1 if cur.get("is_explicit") else 0) if is_explicit is None else (1 if is_explicit else 0)))
    return True


async def delete_lore(lid: str):
    await _w(delete(lore).where(lore.c.id == lid))


# ── sessions ─────────────────────────────────────────────────────────────────

async def _with_preview(rows) -> list[dict]:
    """Attach a plain-text preview of the last message to each session row."""
    out = [dict(row) for row in rows]
    if not out:
        return out
    sids = [s["id"] for s in out]
    crows = await _q(select(messages.c.session_id, func.count().label("n"))
                     .where(messages.c.session_id.in_(sids))
                     .group_by(messages.c.session_id))
    counts = {r["session_id"]: r["n"] for r in crows}
    maxseq = (select(messages.c.session_id, func.max(messages.c.seq).label("mseq"))
              .where(messages.c.session_id.in_(sids))
              .group_by(messages.c.session_id).subquery())
    lrows = await _q(select(messages.c.session_id, messages.c.content)
                     .join(maxseq, and_(messages.c.session_id == maxseq.c.session_id,
                                        messages.c.seq == maxseq.c.mseq)))
    last = {r["session_id"]: _decrypt_secret(r["content"] or "") for r in lrows}
    for s in out:
        s["title"] = _decrypt_secret(s.get("title") or "")
        if "user_name" in s:
            s["user_name"] = _decrypt_secret(s.get("user_name") or "")
        if "char_doing" in s:
            s["char_doing"] = _decrypt_secret(s.get("char_doing") or "") or None
        if "char_location" in s:
            s["char_location"] = _decrypt_secret(s.get("char_location") or "") or None
        if "known_names" in s:
            s["known_names"] = _decrypt_secret(s.get("known_names") or "") or "[]"
        if "style_prompt" in s:
            s["style_prompt"] = _decrypt_secret(s.get("style_prompt") or "") or None
        if "author_note" in s:
            s["author_note"] = _decrypt_secret(s.get("author_note") or "") or None
        if "glossary" in s:
            s["glossary"] = _decrypt_secret(s.get("glossary") or "") or None
        s["preview"] = _preview(last[s["id"]]) if s["id"] in last else ""
        s["message_count"] = counts.get(s["id"], 0)
    return out


async def create_session(char_id, persona_id, title, user_name, user_id=None) -> str:
    sid = nid("s")
    now = time.time()
    await _w(insert(sessions).values(
        id=sid, char_id=char_id, persona_id=persona_id,
        title=_encrypt_secret(title or ""),
        user_name=_encrypt_secret(user_name or "You"), user_id=user_id,
        created=now, updated=now))
    return sid


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


async def list_sessions(limit: int = 40, user_id: str | None = None,
                         char_id: str | None = None) -> list[dict]:
    conditions = []
    if user_id:
        conditions.append(sessions.c.user_id == user_id)
    else:
        conditions.append(sessions.c.user_id.is_(None))
    if char_id:
        conditions.append(sessions.c.char_id == char_id)
    stmt = (select(sessions).where(and_(*conditions))
            .order_by(sessions.c.updated.desc()).limit(limit))
    return await _with_preview(await _q(stmt))


async def list_sessions_for_char(cid: str) -> list[dict]:
    stmt = (select(sessions).where(sessions.c.char_id == cid)
            .order_by(sessions.c.updated.desc()))
    return await _with_preview(await _q(stmt))


async def touch_session(sid: str):
    await _w(update(sessions).where(sessions.c.id == sid).values(updated=time.time()))


async def rename_session(sid: str, title: str):
    await _w(update(sessions).where(sessions.c.id == sid).values(
        title=_encrypt_secret(title or "")))


async def set_session_style(sid: str, key: str, prompt: str | None):
    await _w(update(sessions).where(sessions.c.id == sid).values(
        style_key=key, style_prompt=_encrypt_secret(prompt or "") or None))


async def set_session_language(sid: str, language: str | None):
    await _w(update(sessions).where(sessions.c.id == sid).values(language=language))


async def set_session_glossary(sid: str, glossary: str):
    await _w(update(sessions).where(sessions.c.id == sid).values(
        glossary=_encrypt_secret(glossary or "")))


async def set_session_author_note(sid: str, note: str | None):
    await _w(update(sessions).where(sessions.c.id == sid).values(
        author_note=_encrypt_secret(note) if note else note))


async def set_char_state(sid: str, doing: str | None, location: str | None, known_names: list[str]):
    await _w(update(sessions).where(sessions.c.id == sid).values(
        char_doing=_encrypt_secret(doing or "") or None,
        char_location=_encrypt_secret(location or "") or None,
        known_names=_encrypt_secret(json.dumps(known_names))))


async def delete_session(sid: str):
    async with _engine.begin() as conn:
        await conn.execute(delete(messages).where(messages.c.session_id == sid))
        await conn.execute(delete(sessions).where(sessions.c.id == sid))


# ── messages ─────────────────────────────────────────────────────────────────

async def add_message(sid: str, role: str, content: str, lang: str | None = None) -> dict:
    mid = nid("m")
    ts = int(time.time())
    async with _engine.begin() as conn:
        await conn.execute(insert(messages).values(
            id=mid, session_id=sid, role=role,
            content=_encrypt_secret(content or ""), ts=ts, lang=lang))
        await conn.execute(update(sessions).where(sessions.c.id == sid)
                           .values(updated=time.time()))
    return {"id": mid, "role": role, "content": content, "ts": ts, "lang": lang}


async def get_messages(sid: str) -> list[dict]:
    stmt = (select(messages.c.id, messages.c.role, messages.c.content,
                   messages.c.ts, messages.c.image, messages.c.lang)
            .where(messages.c.session_id == sid).order_by(messages.c.seq.asc()))
    rows = await _q(stmt)
    for r in rows:
        r["content"] = _decrypt_secret(r.get("content") or "")
    return rows


async def set_message_image(sid: str, mid: str, url: str, positive: str = None, negative: str = None,
                            is_explicit: bool = False):
    await _w(update(messages).where(and_(
        messages.c.session_id == sid, messages.c.id == mid)).values(
        image=url, image_positive=positive, image_negative=negative,
        image_ts=int(time.time()) if url else None,
        image_is_explicit=1 if (url and is_explicit) else 0))


async def set_message_image_explicit(sid: str, mid: str):
    await _w(update(messages).where(and_(
        messages.c.session_id == sid, messages.c.id == mid)).values(image_is_explicit=1))


async def set_lore_explicit(lid: str):
    await _w(update(lore).where(lore.c.id == lid).values(is_explicit=1))


async def set_standalone_explicit(iid: str, is_explicit: bool = True,
                                  human_reviewed: bool = False):
    vals = {"is_explicit": 1 if is_explicit else 0}
    if human_reviewed:
        vals["human_reviewed"] = 1
    await _w(update(standalone_images).where(standalone_images.c.id == iid).values(**vals))


async def mark_standalone_classified(iid: str):
    await _w(update(standalone_images).where(standalone_images.c.id == iid).values(classified=1))


async def list_user_images(user_id: str) -> list[dict]:
    """Every generated image belonging to a user's own sessions, newest first —
    powers the Image Gallery page."""
    j = (messages.join(sessions, sessions.c.id == messages.c.session_id)
         .join(characters, characters.c.id == sessions.c.char_id, isouter=True))
    stmt = (select(
                messages.c.id.label("mid"),
                messages.c.session_id.label("sid"),
                messages.c.image.label("image"),
                messages.c.ts.label("ts"),
                messages.c.content.label("content"),
                messages.c.image_positive.label("image_positive"),
                messages.c.image_negative.label("image_negative"),
                messages.c.image_ts.label("image_ts"),
                messages.c.image_is_explicit.label("image_is_explicit"),
                sessions.c.char_id.label("char_id"),
                sessions.c.title.label("session_title"),
                characters.c.name.label("char_name"),
                characters.c.avatar.label("char_avatar"),
                characters.c.is_explicit.label("is_explicit"),
                characters.c.owner_id.label("char_owner_id"))
            .select_from(j)
            .where(and_(sessions.c.user_id == user_id,
                        messages.c.image.isnot(None),
                        messages.c.image != ""))
            .order_by(messages.c.ts.desc()))
    rows = await _q(stmt)
    for r in rows:
        content = _decrypt_secret(r.pop("content", "") or "")
        r["session_title"] = _decrypt_secret(r.get("session_title") or "")
        r["char_name"] = _decrypt_secret(r.get("char_name") or "")
        r["scene_full"] = _THINK_RE.sub("", content).strip()
        r["scene"] = _preview(content, 160)
        r["is_explicit"] = bool(r.get("is_explicit")) or bool(r.pop("image_is_explicit", 0))
    return rows


async def create_standalone_image(user_id: str, image: str, positive: str, negative: str,
                                  checkpoint: str = "", loras: list | None = None,
                                  is_explicit: bool = False, sampler: str = "",
                                  scheduler: str = "", steps: int = 20,
                                  is_img2img: bool = False) -> dict:
    iid = nid("si")
    created = time.time()
    loras_json = json.dumps(loras or [])
    await _w(insert(standalone_images).values(
        id=iid, user_id=user_id, image=image, positive=positive,
        negative=negative, created=created, checkpoint=checkpoint, loras=loras_json,
        sampler=sampler, scheduler=scheduler, steps=steps,
        is_explicit=1 if is_explicit else 0, is_img2img=1 if is_img2img else 0))
    return {"id": iid, "image": image, "positive": positive, "negative": negative,
            "created": created, "is_public": False, "is_explicit": bool(is_explicit),
            "human_reviewed": False, "classified": False,
            "checkpoint": checkpoint, "loras": loras or [], "sampler": sampler,
            "scheduler": scheduler, "steps": steps, "is_img2img": bool(is_img2img)}


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


async def list_standalone_images(user_id: str) -> list[dict]:
    stmt = (select(standalone_images).where(standalone_images.c.user_id == user_id)
            .order_by(standalone_images.c.created.desc()))
    return [_standalone_row(r) for r in await _q(stmt)]


async def set_standalone_public(iid: str, user_id: str, is_public: bool,
                                is_explicit: bool | None = None) -> dict | None:
    row = await _q1(select(standalone_images).where(and_(
        standalone_images.c.id == iid, standalone_images.c.user_id == user_id)))
    if row is None:
        return None
    # is_explicit is the classifier's (or self-flagged) rating of the actual
    # content — it doesn't stop being true just because the image goes
    # private again. Only touch it when the caller actually passed a fresh
    # value (sharing); unsharing passes None and must leave it exactly as it
    # was, not silently reset it to SFW.
    values = {"is_public": int(is_public)}
    if is_explicit is not None:
        values["is_explicit"] = int(is_explicit)
    await _w(update(standalone_images).where(standalone_images.c.id == iid).values(**values))
    out = _standalone_row(row)
    out["is_public"] = is_public
    out["is_explicit"] = bool(is_explicit) if is_explicit is not None else bool(row["is_explicit"])
    return out


async def list_community_images(hidden_ids: set) -> list[dict]:
    stmt = (select(standalone_images, users.c.username, users.c.display_name,
                   users.c.avatar)
            .select_from(standalone_images.join(
                users, users.c.id == standalone_images.c.user_id))
            .where(standalone_images.c.is_public == 1)
            .order_by(standalone_images.c.created.desc()))
    out = []
    for r in await _q(stmt):
        if r["user_id"] in hidden_ids:
            continue
        d = _standalone_row(r)
        d["owner_username"] = d.pop("username", "")
        d["owner_display_name"] = _decrypt_secret(d.pop("display_name", "") or "") or d.get("owner_username", "")
        d["owner_avatar"] = d.pop("avatar", "") or ""
        out.append(d)
    return out


async def get_public_standalone_image(iid: str) -> dict | None:
    stmt = (select(standalone_images, users.c.username, users.c.display_name,
                   users.c.avatar)
            .select_from(standalone_images.join(
                users, users.c.id == standalone_images.c.user_id))
            .where(and_(standalone_images.c.id == iid,
                        standalone_images.c.is_public == 1)))
    r = await _q1(stmt)
    if r is None:
        return None
    d = _standalone_row(r)
    d["owner_username"] = d.pop("username", "")
    d["owner_display_name"] = d.pop("display_name", "") or d.get("owner_username", "")
    d["owner_avatar"] = d.pop("avatar", "") or ""
    return d


async def delete_standalone_image(iid: str, user_id: str) -> str | None:
    image = await _scalar(select(standalone_images.c.image).where(and_(
        standalone_images.c.id == iid, standalone_images.c.user_id == user_id)))
    if image is None:
        return None
    await _w(delete(standalone_images).where(standalone_images.c.id == iid))
    return image


async def flag_endpoint(user_id: str, url: str, api_key: str, reason: str,
                        detail: str = "") -> str:
    fid = nid("fe")
    await _w(insert(flagged_endpoints).values(
        id=fid, user_id=user_id, url=url,
        api_key=_encrypt_secret(api_key) if api_key else "",
        reason=_encrypt_secret(reason or ""), detail=_encrypt_secret(detail or ""),
        created=time.time()))
    return fid


async def list_flagged_endpoints(pending_only: bool = True) -> list[dict]:
    """Admin-facing list — deliberately never returns the key itself (encrypted
    or not), only whether one exists, so an admin reviewing flagged endpoints
    can't read another user's API key off this screen either."""
    j = flagged_endpoints.join(users, users.c.id == flagged_endpoints.c.user_id, isouter=True)
    stmt = select(flagged_endpoints, users.c.username.label("username")).select_from(j)
    if pending_only:
        stmt = stmt.where(flagged_endpoints.c.status == "pending")
    stmt = stmt.order_by(flagged_endpoints.c.created.desc())
    out = []
    for d in await _q(stmt):
        d["has_api_key"] = bool(d.pop("api_key", None))
        d["reason"] = _decrypt_secret(d.get("reason") or "")
        d["detail"] = _decrypt_secret(d.get("detail") or "")
        out.append(d)
    return out


async def get_flagged_endpoint(fid: str) -> dict | None:
    """Internal use only (e.g. re-applying an admin-approved endpoint to the
    user's own settings) — decrypts the key, so never expose this dict directly
    over an API response."""
    d = await _q1(select(flagged_endpoints).where(flagged_endpoints.c.id == fid))
    if not d:
        return None
    if d.get("api_key"):
        d["api_key"] = _decrypt_secret(d["api_key"])
    d["reason"] = _decrypt_secret(d.get("reason") or "")
    d["detail"] = _decrypt_secret(d.get("detail") or "")
    return d


async def set_flagged_endpoint_status(fid: str, status: str):
    await _w(update(flagged_endpoints).where(flagged_endpoints.c.id == fid)
             .values(status=status))


async def create_model_request(user_id: str, model_name: str, source_url: str, note: str,
                               request_type: str = "checkpoint", host_allowed: int = 1,
                               vae_url: str | None = None,
                               text_encoder_url: str | None = None) -> dict:
    rid = nid("mr")
    created = time.time()
    await _w(insert(model_requests).values(
        id=rid, user_id=user_id, model_name=model_name, source_url=source_url,
        note=_encrypt_secret(note or ""), request_type=request_type, status="pending",
        created=created, host_allowed=host_allowed,
        vae_url=vae_url, text_encoder_url=text_encoder_url))
    return {"id": rid, "user_id": user_id, "model_name": model_name, "source_url": source_url,
            "note": note, "request_type": request_type, "status": "pending",
            "created": created, "resolved": None, "host_allowed": host_allowed,
            "local_path": None, "error": "", "vae_url": vae_url,
            "text_encoder_url": text_encoder_url}


async def list_model_requests(user_id: str | None = None, pending_only: bool = False) -> list[dict]:
    j = model_requests.join(users, users.c.id == model_requests.c.user_id, isouter=True)
    stmt = select(model_requests, users.c.username.label("username")).select_from(j)
    if user_id:
        stmt = stmt.where(model_requests.c.user_id == user_id)
    if pending_only:
        # "Needs admin attention" — not just "pending": a row moves to
        # "downloading" the moment it's approved (background auto-download in
        # progress) and to "failed" if that download errors out and needs a
        # retry, so both must stay visible here too or the admin dashboard's
        # status badges/poll/retry button never see them.
        stmt = stmt.where(model_requests.c.status.in_(("pending", "downloading", "failed")))
    stmt = stmt.order_by(model_requests.c.created.desc())
    rows = await _q(stmt)
    for r in rows:
        r["note"] = _decrypt_secret(r.get("note") or "")
    return rows


async def get_model_request(rid: str) -> dict | None:
    r = await _q1(select(model_requests).where(model_requests.c.id == rid))
    if r:
        r["note"] = _decrypt_secret(r.get("note") or "")
    return r


async def set_model_request_status(rid: str, status: str, local_path: str | None = None,
                                   error: str | None = None):
    values = {"status": status, "resolved": time.time()}
    if local_path is not None:
        values["local_path"] = local_path
    if error is not None:
        values["error"] = error
    await _w(update(model_requests).where(model_requests.c.id == rid).values(**values))


async def create_image_rating_report(image_id: str, reporter_id: str,
                                     claimed_explicit: bool, note: str = "",
                                     auto_flagged: bool = False) -> dict:
    rid = nid("irr")
    created = time.time()
    await _w(insert(image_rating_reports).values(
        id=rid, image_id=image_id, reporter_id=reporter_id,
        claimed_explicit=1 if claimed_explicit else 0,
        note=_encrypt_secret(note or ""), status="pending", created=created,
        auto_flagged=1 if auto_flagged else 0))
    return {"id": rid, "image_id": image_id, "reporter_id": reporter_id,
            "claimed_explicit": bool(claimed_explicit), "note": note or "",
            "status": "pending", "created": created, "auto_flagged": bool(auto_flagged)}


async def list_image_rating_reports(pending_only: bool = True) -> list[dict]:
    j = image_rating_reports.join(
        users, users.c.id == image_rating_reports.c.reporter_id, isouter=True)
    stmt = (select(image_rating_reports, users.c.username.label("reporter_username"),
                   standalone_images.c.image.label("image"),
                   standalone_images.c.is_explicit.label("current_explicit"))
            .select_from(j.join(standalone_images,
                                standalone_images.c.id == image_rating_reports.c.image_id,
                                isouter=True)))
    if pending_only:
        stmt = stmt.where(image_rating_reports.c.status == "pending")
    stmt = stmt.order_by(image_rating_reports.c.created.desc())
    rows = await _q(stmt)
    for r in rows:
        r["note"] = _decrypt_secret(r.get("note") or "")
        r["admin_note"] = _decrypt_secret(r.get("admin_note") or "")
        r["claimed_explicit"] = bool(r.get("claimed_explicit"))
        r["current_explicit"] = bool(r.get("current_explicit"))
        r["auto_flagged"] = bool(r.get("auto_flagged"))
    return rows


async def get_image_rating_report(rid: str) -> dict | None:
    r = await _q1(select(image_rating_reports).where(image_rating_reports.c.id == rid))
    if r:
        r["note"] = _decrypt_secret(r.get("note") or "")
        r["admin_note"] = _decrypt_secret(r.get("admin_note") or "")
        r["claimed_explicit"] = bool(r.get("claimed_explicit"))
        r["auto_flagged"] = bool(r.get("auto_flagged"))
    return r


async def resolve_image_rating_report(rid: str, admin_note: str = ""):
    await _w(update(image_rating_reports).where(image_rating_reports.c.id == rid)
             .values(status="resolved", resolved_at=time.time(),
                     admin_note=_encrypt_secret(admin_note or "")))


async def create_password_reset_request(user_id: str, username: str) -> str:
    rid = nid("pr")
    await _w(insert(password_reset_requests).values(
        id=rid, user_id=user_id, username=username,
        status="pending", created=time.time()))
    return rid


async def list_password_reset_requests(pending_only: bool = True) -> list[dict]:
    stmt = select(password_reset_requests)
    if pending_only:
        stmt = stmt.where(password_reset_requests.c.status == "pending")
    stmt = stmt.order_by(password_reset_requests.c.created.desc())
    return await _q(stmt)


async def list_title_requests() -> list[dict]:
    stmt = (select(users.c.id, users.c.username, users.c.display_name,
                   users.c.title, users.c.title_status, users.c.created)
            .where(users.c.title_status == "pending")
            .order_by(users.c.created.desc()))
    rows = await _q(stmt)
    for r in rows:
        r["display_name"] = _decrypt_secret(r.get("display_name") or "")
    return rows


async def set_user_title_status(uid: str, status: str):
    await _w(update(users).where(users.c.id == uid).values(title_status=status))


async def get_password_reset_request(rid: str) -> dict | None:
    return await _q1(select(password_reset_requests).where(
        password_reset_requests.c.id == rid))


async def set_password_reset_request_status(rid: str, status: str):
    await _w(update(password_reset_requests).where(
        password_reset_requests.c.id == rid).values(status=status))


async def edit_message(sid: str, mid: str, content: str):
    await _w(update(messages).where(and_(
        messages.c.session_id == sid, messages.c.id == mid)).values(
        content=_encrypt_secret(content or "")))


async def delete_message(sid: str, mid: str):
    await _w(delete(messages).where(and_(
        messages.c.session_id == sid, messages.c.id == mid)))


async def pop_trailing_assistant(sid: str):
    async with _engine.begin() as conn:
        while True:
            res = await conn.execute(
                select(messages.c.seq, messages.c.role)
                .where(messages.c.session_id == sid)
                .order_by(messages.c.seq.desc()).limit(1))
            row = res.fetchone()
            if not row or row._mapping["role"] != "assistant":
                break
            await conn.execute(delete(messages).where(
                messages.c.seq == row._mapping["seq"]))


# ── global settings ──────────────────────────────────────────────────────────

async def all_settings() -> dict:
    out = {}
    for r in await _q(select(settings.c.key, settings.c.value)):
        try:
            out[r["key"]] = json.loads(r["value"])
        except Exception:
            out[r["key"]] = r["value"]
    return out


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
                          model_category=_UNSET):
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
    stmt = pg_insert(table).values(**values)
    set_ = {k: stmt.excluded[k] for k in values if k != name_col.name}
    stmt = stmt.on_conflict_do_update(index_elements=[name_col.name], set_=set_)
    await _w(stmt)


async def list_checkpoint_previews() -> dict:
    return await _list_model_previews(checkpoint_previews, checkpoint_previews.c.checkpoint_name)


async def get_checkpoint_preview(name: str) -> str | None:
    r = await _q1(select(checkpoint_previews.c.image)
                  .where(checkpoint_previews.c.checkpoint_name == name))
    return r["image"] if r else None


async def set_checkpoint_preview(name: str, image: str):
    await _set_model_preview_image(checkpoint_previews, checkpoint_previews.c.checkpoint_name, name, image)


async def delete_checkpoint_preview(name: str):
    await _clear_model_preview_image(checkpoint_previews, checkpoint_previews.c.checkpoint_name, name)


async def set_checkpoint_meta(name: str, display_name: str | None, description: str | None,
                              model_type: str | None = None, default_steps: int | None = None,
                              anima_clip_name: str | None = None, anima_vae_name: str | None = None):
    # model_category intentionally never touched here — checkpoints classify
    # architecture only via the free-text Type field now; whatever category
    # a checkpoint already had from before is left exactly as-is.
    await _set_model_meta(checkpoint_previews, checkpoint_previews.c.checkpoint_name, name,
                          display_name, description, model_type, default_steps)
    stmt = pg_insert(checkpoint_previews).values(
        checkpoint_name=name, anima_clip_name=anima_clip_name, anima_vae_name=anima_vae_name)
    stmt = stmt.on_conflict_do_update(
        index_elements=[checkpoint_previews.c.checkpoint_name.name],
        set_={"anima_clip_name": stmt.excluded.anima_clip_name,
              "anima_vae_name": stmt.excluded.anima_vae_name})
    await _w(stmt)


async def get_checkpoint_anima_overrides(name: str) -> tuple[str | None, str | None]:
    r = await _q1(select(checkpoint_previews.c.anima_clip_name, checkpoint_previews.c.anima_vae_name)
                  .where(checkpoint_previews.c.checkpoint_name == name))
    if not r:
        return None, None
    return r["anima_clip_name"], r["anima_vae_name"]


async def list_lora_previews() -> dict:
    return await _list_model_previews(lora_previews, lora_previews.c.lora_name)


async def get_lora_preview(name: str) -> str | None:
    r = await _q1(select(lora_previews.c.image)
                  .where(lora_previews.c.lora_name == name))
    return r["image"] if r else None


async def set_lora_preview(name: str, image: str):
    await _set_model_preview_image(lora_previews, lora_previews.c.lora_name, name, image)


async def delete_lora_preview(name: str):
    await _clear_model_preview_image(lora_previews, lora_previews.c.lora_name, name)


async def set_lora_meta(name: str, display_name: str | None, description: str | None,
                        model_category: list[str] | None = None):
    await _set_model_meta(lora_previews, lora_previews.c.lora_name, name, display_name, description,
                          model_category=model_category)


async def list_sampler_previews() -> dict:
    return await _list_model_previews(sampler_previews, sampler_previews.c.sampler_name)


async def get_sampler_preview(name: str) -> str | None:
    r = await _q1(select(sampler_previews.c.image)
                  .where(sampler_previews.c.sampler_name == name))
    return r["image"] if r else None


async def set_sampler_preview(name: str, image: str):
    await _set_model_preview_image(sampler_previews, sampler_previews.c.sampler_name, name, image)


async def delete_sampler_preview(name: str):
    await _clear_model_preview_image(sampler_previews, sampler_previews.c.sampler_name, name)


async def set_sampler_meta(name: str, display_name: str | None, description: str | None):
    await _set_model_meta(sampler_previews, sampler_previews.c.sampler_name, name, display_name, description)


async def list_scheduler_previews() -> dict:
    return await _list_model_previews(scheduler_previews, scheduler_previews.c.scheduler_name)


async def get_scheduler_preview(name: str) -> str | None:
    r = await _q1(select(scheduler_previews.c.image)
                  .where(scheduler_previews.c.scheduler_name == name))
    return r["image"] if r else None


async def set_scheduler_preview(name: str, image: str):
    await _set_model_preview_image(scheduler_previews, scheduler_previews.c.scheduler_name, name, image)


async def delete_scheduler_preview(name: str):
    await _clear_model_preview_image(scheduler_previews, scheduler_previews.c.scheduler_name, name)


async def set_scheduler_meta(name: str, display_name: str | None, description: str | None):
    await _set_model_meta(scheduler_previews, scheduler_previews.c.scheduler_name, name, display_name, description)


async def list_upscaler_previews() -> dict:
    return await _list_model_previews(upscaler_previews, upscaler_previews.c.upscaler_name)


async def get_upscaler_preview(name: str) -> str | None:
    r = await _q1(select(upscaler_previews.c.image)
                  .where(upscaler_previews.c.upscaler_name == name))
    return r["image"] if r else None


async def set_upscaler_preview(name: str, image: str):
    await _set_model_preview_image(upscaler_previews, upscaler_previews.c.upscaler_name, name, image)


async def delete_upscaler_preview(name: str):
    await _clear_model_preview_image(upscaler_previews, upscaler_previews.c.upscaler_name, name)


async def set_upscaler_meta(name: str, display_name: str | None, description: str | None):
    await _set_model_meta(upscaler_previews, upscaler_previews.c.upscaler_name, name, display_name, description)


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


async def set_localizations(items: list[tuple], lang: str, kind: str = "content"):
    """items: [(src_hash, source, translated), ...] — write-through cache insert."""
    now = time.time()
    async with _engine.begin() as conn:
        for h, src, tr in items:
            stmt = pg_insert(localization).values(
                src_hash=h, lang=lang, kind=kind, source=src,
                translated=tr, created=now)
            stmt = stmt.on_conflict_do_update(
                index_elements=["src_hash", "lang"],
                set_={"translated": stmt.excluded.translated})
            await conn.execute(stmt)


# ── admin ────────────────────────────────────────────────────────────────────

# ── comments ─────────────────────────────────────────────────────────────────

async def create_comment(target_type: str, target_id: str, author_id: str,
                         parent_id: str | None, content: str, image: str = "",
                         attachment_kind: str = "") -> str:
    cid = nid("cm")
    await _w(insert(comments).values(
        id=cid, target_type=target_type, target_id=target_id,
        author_id=author_id, parent_id=parent_id,
        content=_encrypt_secret(content or ""), image=(image or None),
        attachment_kind=(attachment_kind or None),
        created=time.time()))
    return cid


async def set_comment_explicit(cid: str):
    await _w(update(comments).where(comments.c.id == cid).values(image_is_explicit=1))


async def update_comment(cid: str, content: str) -> float:
    edited_at = time.time()
    await _w(update(comments).where(comments.c.id == cid).values(
        content=_encrypt_secret(content or ""), edited_at=edited_at))
    return edited_at


async def get_comment(cid: str) -> dict | None:
    r = await _q1(select(comments).where(comments.c.id == cid))
    if r:
        r["content"] = _decrypt_secret(r.get("content") or "")
    return r


def _shape_comment(r, like_counts, liked_me, reaction_counts=None, my_reactions=None, reaction_supers=None) -> dict:
    return {
        "id": r["id"], "target_type": r["target_type"], "target_id": r["target_id"],
        "author_id": r["author_id"], "parent_id": r["parent_id"],
        "content": _decrypt_secret(r.get("content") or ""), "created": r["created"],
        "edited_at": r.get("edited_at"),
        "image": r.get("image") or "", "image_is_explicit": bool(r.get("image_is_explicit")),
        "attachment_kind": r.get("attachment_kind") or ("image" if r.get("image") else ""),
        "author_username": r["username"],
        "author_display_name": _decrypt_secret(r.get("display_name") or ""),
        "author_avatar": r.get("avatar") or "",
        "like_count": like_counts.get(r["id"], 0),
        "liked_by_me": r["id"] in liked_me,
        "reactions": (reaction_counts or {}).get(r["id"], {}),
        "my_reactions": (my_reactions or {}).get(r["id"], []),
        "reaction_supers": (reaction_supers or {}).get(r["id"], {}),
        "replies": [], "reply_count": 0,
    }


async def _comment_like_maps(ids, viewer_id):
    like_counts, liked_me = {}, set()
    if not ids:
        return like_counts, liked_me
    lc = await _q(select(comment_likes.c.comment_id, func.count().label("n"))
                  .where(comment_likes.c.comment_id.in_(ids))
                  .group_by(comment_likes.c.comment_id))
    like_counts = {r["comment_id"]: r["n"] for r in lc}
    if viewer_id:
        lm = await _q(select(comment_likes.c.comment_id).where(and_(
            comment_likes.c.comment_id.in_(ids),
            comment_likes.c.user_id == viewer_id)))
        liked_me = {r["comment_id"] for r in lm}
    return like_counts, liked_me


async def list_comments(target_type: str, target_id: str,
                        viewer_id: str | None = None) -> list[dict]:
    blocked = await hidden_user_ids(viewer_id) if viewer_id else set()
    j = comments.join(users, users.c.id == comments.c.author_id)
    stmt = (select(comments, users.c.username, users.c.display_name, users.c.avatar)
            .select_from(j)
            .where(and_(comments.c.target_type == target_type,
                        comments.c.target_id == target_id))
            .order_by(comments.c.created.asc()))
    rows = [r for r in await _q(stmt) if r["author_id"] not in blocked]
    ids = [r["id"] for r in rows]
    like_counts, liked_me = await _comment_like_maps(ids, viewer_id)
    reaction_counts, my_reactions, reaction_supers = await _comment_reaction_maps(ids, viewer_id)
    by_id = {r["id"]: r for r in rows}
    shaped = {r["id"]: _shape_comment(r, like_counts, liked_me, reaction_counts, my_reactions, reaction_supers) for r in rows}

    def root_id(r):
        seen = set()
        while r["parent_id"] and r["parent_id"] in by_id and r["id"] not in seen:
            seen.add(r["id"])
            r = by_id[r["parent_id"]]
        return r["id"]

    top = []
    for r in rows:
        s = shaped[r["id"]]
        if not r["parent_id"] or r["parent_id"] not in by_id:
            top.append(s)
        else:
            shaped[root_id(by_id[r["parent_id"]])]["replies"].append(s)
    for s in shaped.values():
        s["reply_count"] = len(s["replies"])
    top.reverse()
    return top


async def get_comment_view(cid: str, viewer_id: str | None = None) -> dict | None:
    j = comments.join(users, users.c.id == comments.c.author_id)
    r = await _q1(select(comments, users.c.username, users.c.display_name,
                         users.c.avatar).select_from(j).where(comments.c.id == cid))
    if not r:
        return None
    like_counts, liked_me = await _comment_like_maps([cid], viewer_id)
    reaction_counts, my_reactions, reaction_supers = await _comment_reaction_maps([cid], viewer_id)
    return _shape_comment(r, like_counts, liked_me, reaction_counts, my_reactions, reaction_supers)


async def _descendant_ids(cid: str, target_type: str, target_id: str) -> list[str]:
    rows = await _q(select(comments.c.id, comments.c.parent_id).where(and_(
        comments.c.target_type == target_type, comments.c.target_id == target_id)))
    children = {}
    for r in rows:
        children.setdefault(r["parent_id"], []).append(r["id"])
    out, stack = [], [cid]
    while stack:
        x = stack.pop()
        out.append(x)
        stack.extend(children.get(x, []))
    return out


async def delete_comment(cid: str):
    c = await _q1(select(comments).where(comments.c.id == cid))
    if not c:
        return
    ids = await _descendant_ids(cid, c["target_type"], c["target_id"])
    async with _engine.begin() as conn:
        await conn.execute(delete(comment_likes).where(comment_likes.c.comment_id.in_(ids)))
        await conn.execute(delete(comment_reactions).where(comment_reactions.c.comment_id.in_(ids)))
        await conn.execute(delete(comments).where(comments.c.id.in_(ids)))


async def create_admin_note(user_id: str, author_id: str, note: str) -> dict:
    nid_ = nid("an")
    created = time.time()
    await _w(insert(admin_notes).values(
        id=nid_, user_id=user_id, author_id=author_id,
        note=_encrypt_secret(note or ""), created=created))
    return {"id": nid_, "user_id": user_id, "author_id": author_id,
            "note": note, "created": created}


async def list_admin_notes(user_id: str) -> list[dict]:
    j = admin_notes.join(users, users.c.id == admin_notes.c.author_id, isouter=True)
    stmt = (select(admin_notes, users.c.username)
            .select_from(j)
            .where(admin_notes.c.user_id == user_id)
            .order_by(admin_notes.c.created.desc()))
    out = []
    for r in await _q(stmt):
        out.append({
            "id": r["id"], "user_id": r["user_id"], "author_id": r["author_id"],
            "author_username": r.get("username") or "(deleted)",
            "note": _decrypt_secret(r.get("note") or ""), "created": r["created"],
        })
    return out


async def delete_admin_note(note_id: str):
    await _w(delete(admin_notes).where(admin_notes.c.id == note_id))


async def like_comment(cid: str, user_id: str):
    async with _engine.begin() as conn:
        exists = (await conn.execute(select(comment_likes).where(and_(
            comment_likes.c.comment_id == cid,
            comment_likes.c.user_id == user_id)))).fetchone()
        if not exists:
            await conn.execute(insert(comment_likes).values(
                comment_id=cid, user_id=user_id))


async def unlike_comment(cid: str, user_id: str):
    await _w(delete(comment_likes).where(and_(
        comment_likes.c.comment_id == cid, comment_likes.c.user_id == user_id)))


async def comment_like_count(cid: str) -> int:
    return await _scalar(select(func.count()).select_from(comment_likes)
                         .where(comment_likes.c.comment_id == cid)) or 0


# Emoji reaction limits are enforced by whoever calls these (see
# routers/comments.py) — this layer just does the actual toggle.
_MAX_REACTION_EMOJI_LEN = 8   # a couple of codepoints is plenty for any real emoji


async def react_to_comment(cid: str, user_id: str, emoji: str, is_super: bool = False):
    emoji = (emoji or "").strip()[:_MAX_REACTION_EMOJI_LEN]
    if not emoji:
        return
    stmt = pg_insert(comment_reactions).values(
        comment_id=cid, user_id=user_id, emoji=emoji, is_super=1 if is_super else 0)
    # Upsert rather than do-nothing: re-reacting with the same emoji but a
    # different super flag (e.g. upgrading a normal reaction to a super one)
    # should update the existing row, not silently no-op.
    stmt = stmt.on_conflict_do_update(
        index_elements=["comment_id", "user_id", "emoji"],
        set_={"is_super": stmt.excluded.is_super})
    await _w(stmt)


async def unreact_to_comment(cid: str, user_id: str, emoji: str):
    await _w(delete(comment_reactions).where(and_(
        comment_reactions.c.comment_id == cid, comment_reactions.c.user_id == user_id,
        comment_reactions.c.emoji == emoji)))


async def _comment_reaction_maps(ids, viewer_id):
    counts, mine, supers = {}, {}, {}
    if not ids:
        return counts, mine, supers
    rows = await _q(select(comment_reactions.c.comment_id, comment_reactions.c.emoji,
                           func.count().label("n"),
                           func.max(comment_reactions.c.is_super).label("has_super"))
                    .where(comment_reactions.c.comment_id.in_(ids))
                    .group_by(comment_reactions.c.comment_id, comment_reactions.c.emoji))
    for r in rows:
        counts.setdefault(r["comment_id"], {})[r["emoji"]] = r["n"]
        supers.setdefault(r["comment_id"], {})[r["emoji"]] = bool(r["has_super"])
    if viewer_id:
        mrows = await _q(select(comment_reactions.c.comment_id, comment_reactions.c.emoji)
                         .where(and_(comment_reactions.c.comment_id.in_(ids),
                                     comment_reactions.c.user_id == viewer_id)))
        for r in mrows:
            mine.setdefault(r["comment_id"], []).append(r["emoji"])
    return counts, mine, supers


# ── custom emoji / stickers ──────────────────────────────────────────────
_SHORTCODE_RE = re.compile(r"^[a-z0-9_]{2,32}$")


async def create_custom_emoji(shortcode: str, image: str, kind: str, uploader_id: str,
                              is_explicit: bool = False, preview_image: str | None = None) -> dict | None:
    """Returns None for an invalid shortcode OR one already owned by a
    different uploader — since any user can upload these, a plain upsert
    would let anyone silently overwrite someone else's existing :shortcode:
    (replacing content already used across many messages). Only the
    original uploader can update their own shortcode's image/kind.

    is_explicit=True + preview_image is used for animated GIFs, which the
    NSFW classifier can't reliably judge (see chat_service.classify_image_nsfw)
    — rather than trust an always-negative verdict, they're stored pre-flagged
    with a blurred static-frame stand-in pending an admin's manual review;
    see _shape_custom_emoji for how that's served in place of `image`."""
    shortcode = shortcode.strip().lower()
    if not _SHORTCODE_RE.match(shortcode):
        return None
    existing = await _q1(select(custom_emojis).where(custom_emojis.c.shortcode == shortcode))
    if existing and existing["uploader_id"] != uploader_id:
        return None
    eid = existing["id"] if existing else nid("emo")
    explicit_val = 1 if is_explicit else 0
    stmt = pg_insert(custom_emojis).values(
        id=eid, shortcode=shortcode, image=image, kind=kind, uploader_id=uploader_id,
        created=time.time(), is_explicit=explicit_val, preview_image=preview_image)
    stmt = stmt.on_conflict_do_update(
        index_elements=["shortcode"],
        set_={"image": stmt.excluded.image, "kind": stmt.excluded.kind,
              "is_explicit": explicit_val, "preview_image": preview_image})
    await _w(stmt)
    return await _q1(select(custom_emojis).where(custom_emojis.c.shortcode == shortcode))


def _shape_custom_emoji(row: dict, admin_view: bool = False) -> dict:
    """The true uploaded file always stays in `image`; the public-facing dict
    swaps it for the blurred static preview while is_explicit is set and a
    preview exists, so every existing display path (picker, :shortcode:
    rendering, sticker attachments) shows the safe stand-in with no caller-
    side changes. admin_view=True (the admin management panel) always gets
    the real file, since reviewing *is* looking at the actual content."""
    d = dict(row)
    if not admin_view and d.get("is_explicit") and d.get("preview_image"):
        d["image"] = d["preview_image"]
    return d


async def set_custom_emoji_explicit(eid: str):
    await _w(update(custom_emojis).where(custom_emojis.c.id == eid).values(is_explicit=1))


async def approve_custom_emoji(eid: str):
    """Admin confirms a pending (usually GIF) upload is actually SFW — clears
    the flag and the now-unneeded preview so the real file is served again."""
    await _w(update(custom_emojis).where(custom_emojis.c.id == eid)
             .values(is_explicit=0, preview_image=None))


async def update_custom_emoji(eid: str, shortcode: str | None, kind: str | None) -> dict | None:
    """Admin-only rename/retype. Preserves the same shortcode-uniqueness
    constraint as create_custom_emoji — returns None if the new shortcode is
    invalid or already claimed by a different emoji."""
    row = await _q1(select(custom_emojis).where(custom_emojis.c.id == eid))
    if not row:
        return None
    values = {}
    if shortcode is not None:
        shortcode = shortcode.strip().lower()
        if not _SHORTCODE_RE.match(shortcode):
            return None
        existing = await _q1(select(custom_emojis).where(custom_emojis.c.shortcode == shortcode))
        if existing and existing["id"] != eid:
            return None
        values["shortcode"] = shortcode
    if kind is not None:
        values["kind"] = kind
    if values:
        await _w(update(custom_emojis).where(custom_emojis.c.id == eid).values(**values))
    return await _q1(select(custom_emojis).where(custom_emojis.c.id == eid))


async def list_custom_emojis(kind: str | None = None, admin_view: bool = False) -> list[dict]:
    if admin_view:
        # Only the admin review panel needs a human-readable uploader — the
        # public picker never shows it, so the join is skipped there.
        j = custom_emojis.join(users, users.c.id == custom_emojis.c.uploader_id, isouter=True)
        stmt = (select(custom_emojis, users.c.username.label("uploader_username"))
                .select_from(j).order_by(custom_emojis.c.shortcode.asc()))
    else:
        stmt = select(custom_emojis).order_by(custom_emojis.c.shortcode.asc())
    if kind:
        stmt = stmt.where(custom_emojis.c.kind == kind)
    return [_shape_custom_emoji(r, admin_view) for r in await _q(stmt)]


async def get_custom_emoji(eid: str, admin_view: bool = False) -> dict | None:
    row = await _q1(select(custom_emojis).where(custom_emojis.c.id == eid))
    return _shape_custom_emoji(row, admin_view) if row else None


async def get_sticker_by_image(image: str) -> dict | None:
    """Used to validate a comment's sticker attachment actually is one — the
    image path alone (an emo_... filename) isn't proof, since it's just a
    client-supplied string; this confirms a real sticker row backs it."""
    row = await _q1(select(custom_emojis).where(and_(
        custom_emojis.c.image == image, custom_emojis.c.kind == "sticker")))
    return dict(row) if row else None


async def delete_custom_emoji(eid: str):
    await _w(delete(custom_emojis).where(custom_emojis.c.id == eid))


# ── forum ────────────────────────────────────────────────────────────────
async def create_forum_thread(author_id: str, title: str, content: str, category: str = "") -> str:
    tid = nid("th")
    await _w(insert(forum_threads).values(
        id=tid, author_id=author_id, title=_encrypt_secret(title or ""),
        content=_encrypt_secret(content or ""), category=(category or "").strip()[:40],
        created=time.time()))
    return tid


async def delete_forum_thread(tid: str):
    async with _engine.begin() as conn:
        await conn.execute(delete(comments).where(and_(
            comments.c.target_type == "thread", comments.c.target_id == tid)))
        await conn.execute(delete(thread_likes).where(thread_likes.c.thread_id == tid))
        await conn.execute(delete(forum_threads).where(forum_threads.c.id == tid))


def _shape_thread(r, like_counts, liked_me, reply_counts) -> dict:
    return {
        "id": r["id"], "author_id": r["author_id"],
        "title": _decrypt_secret(r.get("title") or ""),
        "content": _decrypt_secret(r.get("content") or ""),
        "category": r.get("category") or "", "created": r["created"],
        "pinned": bool(r.get("pinned")),
        "author_username": r["username"],
        "author_display_name": _decrypt_secret(r.get("display_name") or ""),
        "author_avatar": r.get("avatar") or "",
        "like_count": like_counts.get(r["id"], 0),
        "liked_by_me": r["id"] in liked_me,
        "reply_count": reply_counts.get(r["id"], 0),
    }


async def _thread_like_maps(ids, viewer_id):
    like_counts, liked_me = {}, set()
    if not ids:
        return like_counts, liked_me
    lc = await _q(select(thread_likes.c.thread_id, func.count().label("n"))
                  .where(thread_likes.c.thread_id.in_(ids))
                  .group_by(thread_likes.c.thread_id))
    like_counts = {r["thread_id"]: r["n"] for r in lc}
    if viewer_id:
        lm = await _q(select(thread_likes.c.thread_id).where(and_(
            thread_likes.c.thread_id.in_(ids), thread_likes.c.user_id == viewer_id)))
        liked_me = {r["thread_id"] for r in lm}
    return like_counts, liked_me


async def _thread_reply_counts(ids):
    if not ids:
        return {}
    rows = await _q(select(comments.c.target_id, func.count().label("n"))
                    .where(and_(comments.c.target_type == "thread", comments.c.target_id.in_(ids)))
                    .group_by(comments.c.target_id))
    return {r["target_id"]: r["n"] for r in rows}


async def list_forum_threads(hidden_ids: set, sort: str = "new", category: str = "",
                             limit: int = 50, offset: int = 0, viewer_id: str | None = None) -> list[dict]:
    j = forum_threads.join(users, users.c.id == forum_threads.c.author_id)
    conds = []
    if category:
        conds.append(forum_threads.c.category == category)
    stmt = select(forum_threads, users.c.username, users.c.display_name, users.c.avatar).select_from(j)
    if conds:
        stmt = stmt.where(and_(*conds))
    rows = [r for r in await _q(stmt) if r["author_id"] not in hidden_ids]
    ids = [r["id"] for r in rows]
    like_counts, liked_me = await _thread_like_maps(ids, viewer_id)
    reply_counts = await _thread_reply_counts(ids)
    shaped = [_shape_thread(r, like_counts, liked_me, reply_counts) for r in rows]
    if sort == "top":
        shaped.sort(key=lambda t: (t["pinned"], t["like_count"], t["created"]), reverse=True)
    else:
        shaped.sort(key=lambda t: (t["pinned"], t["created"]), reverse=True)
    return shaped[offset:offset + limit]


async def get_forum_thread(tid: str, viewer_id: str | None = None) -> dict | None:
    j = forum_threads.join(users, users.c.id == forum_threads.c.author_id)
    r = await _q1(select(forum_threads, users.c.username, users.c.display_name, users.c.avatar)
                  .select_from(j).where(forum_threads.c.id == tid))
    if not r:
        return None
    like_counts, liked_me = await _thread_like_maps([tid], viewer_id)
    reply_counts = await _thread_reply_counts([tid])
    return _shape_thread(r, like_counts, liked_me, reply_counts)


async def like_forum_thread(tid: str, user_id: str):
    async with _engine.begin() as conn:
        exists = (await conn.execute(select(thread_likes).where(and_(
            thread_likes.c.thread_id == tid, thread_likes.c.user_id == user_id)))).fetchone()
        if not exists:
            await conn.execute(insert(thread_likes).values(thread_id=tid, user_id=user_id))


async def unlike_forum_thread(tid: str, user_id: str):
    await _w(delete(thread_likes).where(and_(
        thread_likes.c.thread_id == tid, thread_likes.c.user_id == user_id)))


async def delete_comments_by_author_on_owner(author_id: str, owner_id: str,
                                             owner_username: str) -> int:
    char_ids = [r["id"] for r in await _q(
        select(characters.c.id).where(characters.c.owner_id == owner_id))]
    cond = or_(
        and_(comments.c.target_type == "character",
             comments.c.target_id.in_(char_ids or ["__none__"])),
        and_(comments.c.target_type == "user",
             comments.c.target_id == owner_username))
    rows = await _q(select(comments.c.id).where(
        and_(comments.c.author_id == author_id, cond)))
    ids = [r["id"] for r in rows]
    if not ids:
        return 0
    async with _engine.begin() as conn:
        await conn.execute(delete(comment_likes).where(comment_likes.c.comment_id.in_(ids)))
        await conn.execute(delete(comments).where(comments.c.id.in_(ids)))
    return len(ids)


# ── notifications ────────────────────────────────────────────────────────────

def _notif_row(r) -> dict:
    d = dict(r)
    d["read"] = bool(d.get("read"))
    d["title"] = _decrypt_secret(d.get("title") or "")
    d["body"] = _decrypt_secret(d.get("body") or "")
    return d


async def create_notification(user_id: str, type: str, title: str, body: str = "",
                              link: str = "", related_id: str | None = None) -> str:
    nt = nid("nt")
    await _w(insert(notifications).values(
        id=nt, user_id=user_id, type=type,
        title=_encrypt_secret(title or ""), body=_encrypt_secret(body or ""),
        link=link, related_id=related_id, read=0, created=time.time()))
    return nt


async def notify_admins(type: str, title: str, body: str = "",
                        link: str = "", related_id: str | None = None,
                        exclude_user_id: str | None = None) -> int:
    admin_ids = await list_admin_user_ids()
    sent = 0
    for aid in admin_ids:
        if aid == exclude_user_id:
            continue
        if related_id is not None and await notification_exists(aid, type, related_id):
            continue
        await create_notification(aid, type, title, body, link, related_id=related_id)
        sent += 1
    return sent


async def list_notifications(user_id: str, unread_only: bool = False,
                             limit: int = 50) -> list[dict]:
    conds = [notifications.c.user_id == user_id]
    if unread_only:
        conds.append(notifications.c.read == 0)
    stmt = (select(notifications).where(and_(*conds))
            .order_by(notifications.c.created.desc()).limit(limit))
    return [_notif_row(r) for r in await _q(stmt)]


async def mark_notification_read(nt: str, user_id: str):
    await _w(update(notifications).where(and_(
        notifications.c.id == nt, notifications.c.user_id == user_id)).values(read=1))


async def mark_all_read(user_id: str):
    await _w(update(notifications).where(and_(
        notifications.c.user_id == user_id, notifications.c.read == 0)).values(read=1))


async def delete_all_notifications(user_id: str):
    await _w(delete(notifications).where(notifications.c.user_id == user_id))


async def unread_notification_count(user_id: str) -> int:
    return await _scalar(select(func.count()).select_from(notifications).where(and_(
        notifications.c.user_id == user_id, notifications.c.read == 0))) or 0


async def notification_exists(user_id: str, type: str, related_id: str) -> bool:
    r = await _q1(select(notifications.c.id).where(and_(
        notifications.c.user_id == user_id, notifications.c.type == type,
        notifications.c.related_id == related_id)))
    return bool(r)


async def count_char_sessions(cid: str) -> int:
    return await _scalar(select(func.count()).select_from(sessions)
                         .where(sessions.c.char_id == cid)) or 0


# ── service health ───────────────────────────────────────────────────────────

async def record_health_ping(service: str, ok: bool, latency_ms: float | None,
                             error: str = "") -> None:
    await _w(insert(service_health_pings).values(
        id=nid("hp"), service=service, ok=1 if ok else 0,
        latency_ms=latency_ms, error=error or "", created=time.time()))


async def prune_health_pings(older_than_days: int = 7) -> None:
    cutoff = time.time() - older_than_days * 86400
    await _w(delete(service_health_pings).where(service_health_pings.c.created < cutoff))


async def latest_health_ping(service: str) -> dict | None:
    stmt = (select(service_health_pings).where(service_health_pings.c.service == service)
            .order_by(service_health_pings.c.created.desc()).limit(1))
    return await _q1(stmt)


async def health_history(service: str, limit: int = 60, since: float | None = None) -> list[dict]:
    conditions = [service_health_pings.c.service == service]
    if since is not None:
        conditions.append(service_health_pings.c.created >= since)
    stmt = (select(service_health_pings).where(and_(*conditions))
            .order_by(service_health_pings.c.created.desc()).limit(limit))
    rows = await _q(stmt)
    rows.reverse()
    return rows


async def health_uptime_pct(service: str, hours: int = 24) -> float | None:
    since = time.time() - hours * 3600
    stmt = select(func.count(), func.sum(service_health_pings.c.ok)).where(and_(
        service_health_pings.c.service == service,
        service_health_pings.c.created >= since))
    async with _engine.begin() as conn:
        total, ok_sum = (await conn.execute(stmt)).fetchone()
    if not total:
        return None
    return round(100.0 * (ok_sum or 0) / total, 2)


# ── user blocks ──────────────────────────────────────────────────────────────

async def block_user(blocker_id: str, blocked_id: str, reason: str = ""):
    async with _engine.begin() as conn:
        exists = (await conn.execute(select(user_blocks).where(and_(
            user_blocks.c.blocker_id == blocker_id,
            user_blocks.c.blocked_id == blocked_id)))).fetchone()
        if exists:
            await conn.execute(update(user_blocks).where(and_(
                user_blocks.c.blocker_id == blocker_id,
                user_blocks.c.blocked_id == blocked_id)).values(reason=reason or ""))
        else:
            await conn.execute(insert(user_blocks).values(
                blocker_id=blocker_id, blocked_id=blocked_id,
                reason=reason or "", created=time.time()))


async def unblock_user(blocker_id: str, blocked_id: str):
    await _w(delete(user_blocks).where(and_(
        user_blocks.c.blocker_id == blocker_id,
        user_blocks.c.blocked_id == blocked_id)))


async def has_blocked(blocker_id: str, blocked_id: str) -> bool:
    r = await _q1(select(user_blocks.c.blocker_id).where(and_(
        user_blocks.c.blocker_id == blocker_id,
        user_blocks.c.blocked_id == blocked_id)))
    return bool(r)


async def is_block_between(a: str, b: str) -> bool:
    r = await _q1(select(user_blocks.c.blocker_id).where(or_(
        and_(user_blocks.c.blocker_id == a, user_blocks.c.blocked_id == b),
        and_(user_blocks.c.blocker_id == b, user_blocks.c.blocked_id == a))))
    return bool(r)


async def blocked_ids(blocker_id: str) -> set:
    rows = await _q(select(user_blocks.c.blocked_id).where(
        user_blocks.c.blocker_id == blocker_id))
    return {r["blocked_id"] for r in rows}


async def hidden_user_ids(viewer_id: str) -> set:
    rows = await _q(select(user_blocks).where(or_(
        user_blocks.c.blocker_id == viewer_id,
        user_blocks.c.blocked_id == viewer_id)))
    out = set()
    for r in rows:
        out.add(r["blocked_id"] if r["blocker_id"] == viewer_id else r["blocker_id"])
    return out


async def list_blocked(blocker_id: str) -> list[dict]:
    j = user_blocks.join(users, users.c.id == user_blocks.c.blocked_id)
    rows = await _q(select(users.c.id, users.c.username, users.c.display_name,
                          users.c.avatar, user_blocks.c.reason, user_blocks.c.created)
                    .select_from(j)
                    .where(user_blocks.c.blocker_id == blocker_id)
                    .order_by(user_blocks.c.created.desc()))
    return [{"id": r["id"], "username": r["username"],
             "display_name": _decrypt_secret(r.get("display_name") or ""),
             "avatar": r.get("avatar") or "", "reason": r.get("reason") or ""}
            for r in rows]
