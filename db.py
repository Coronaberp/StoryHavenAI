"""
db.py — SQLite persistence (async, via SQLAlchemy Core + aiosqlite).

All structured data lives here: characters, personas, lore, sessions, messages,
settings, users, auth tokens, and per-user LLM overrides.
Vector embeddings live in Redis (vectors.py).

The query layer is written with SQLAlchemy Core (Table objects + expression API)
so it stays dialect-portable for a future PostgreSQL migration — but this file
still runs against the same SQLite file with zero data migration. The Fernet
encryption layer (_encrypt_secret/_decrypt_secret) operates on plain Python
strings before/after they touch SQL and is unaffected by the query builder.
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
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine

_THINK_RE = re.compile(r"<think>.*?</think>\s*", re.S)


def _preview(content: str, n: int = 80) -> str:
    return _THINK_RE.sub("", content or "").strip()[:n].replace("\n", " ")


_engine: AsyncEngine | None = None
_is_pg: bool = False
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
    sqlite_autoincrement=True,
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
)

flagged_endpoints = sa.Table(
    "flagged_endpoints", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("user_id", sa.Text, nullable=False),
    sa.Column("url", sa.Text, nullable=False),
    sa.Column("api_key", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("reason", sa.Text, nullable=False, server_default=text("''")),
    sa.Column("status", sa.Text, nullable=False, server_default=text("'pending'")),
    sa.Column("created", sa.Float, nullable=False),
)

sa.Index("idx_msg_session", messages.c.session_id, messages.c.seq)
sa.Index("idx_lore_char", lore.c.char_id)
sa.Index("idx_sess_char", sessions.c.char_id, sessions.c.updated)
sa.Index("idx_sess_user", sessions.c.user_id, sessions.c.updated)
sa.Index("idx_char_owner", characters.c.owner_id)
sa.Index("idx_auth_user", auth_sessions.c.user_id)
sa.Index("idx_standalone_user", standalone_images.c.user_id, standalone_images.c.created)


# ── lifecycle ────────────────────────────────────────────────────────────────

def nid(prefix: str = "") -> str:
    return prefix + uuid4().hex[:12]


def _set_sqlite_pragma(dbapi_conn, _rec):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


def engine() -> AsyncEngine:
    return _engine


def is_pg() -> bool:
    return _is_pg


def _upsert(table):
    """Dialect-correct INSERT with ON CONFLICT support (.on_conflict_do_update / .excluded)."""
    return pg_insert(table) if _is_pg else sqlite_insert(table)


async def init(path: str):
    global _engine, _is_pg, _fernet
    database_url = os.environ.get("DATABASE_URL", "").strip()
    _is_pg = bool(database_url)
    if _is_pg:
        _engine = create_async_engine(database_url)
    else:
        _engine = create_async_engine("sqlite+aiosqlite:///" + path)
        sa.event.listen(_engine.sync_engine, "connect", _set_sqlite_pragma)

    async with _engine.begin() as conn:
        # Migration must run before create_all so existing tables gain new columns;
        # create_all (checkfirst) then only adds tables that don't exist yet. The
        # additive migration is SQLite-only (uses sqlite_master/PRAGMA introspection);
        # on Postgres the schema is created fresh with every column already present.
        if not _is_pg:
            await _migrate(conn)
        await conn.run_sync(_meta.create_all)

    # Bring-your-own-endpoint API keys (per-user and flagged-pending-review) are
    # encrypted at rest so nobody browsing the settings UI or admin panel (not
    # even an admin) can read another user's raw key back out; only the server
    # process can decrypt it to use it in an outbound Authorization header.
    #
    # Key source, in order of preference:
    #   1. SECRET_ENCRYPTION_KEY env var — the key lives outside the database, so
    #      stealing personae.db alone does not hand over the plaintext keys. This
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
        res = await conn.execute(
            select(settings.c.value).where(settings.c.key == "_secret_enc_key"))
        row = res.fetchone()
        if row:
            key = row[0].encode()
        else:
            key = Fernet.generate_key()
            await conn.execute(
                insert(settings).values(key="_secret_enc_key", value=key.decode()))
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


async def _table_exists(conn, name: str) -> bool:
    res = await conn.execute(
        text("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:n"), {"n": name})
    return res.fetchone() is not None


async def _columns(conn, table: str) -> set[str]:
    if not await _table_exists(conn, table):
        return set()
    res = await conn.execute(text(f"PRAGMA table_info({table})"))
    return {r._mapping["name"] for r in res.fetchall()}


async def _migrate(conn):
    """Idempotent: add columns introduced after initial release. Runs raw ALTER
    statements — ad-hoc additive migrations don't need the expression API."""
    async def ex(sql):
        await conn.execute(text(sql))

    char_cols = await _columns(conn, "characters")
    if char_cols:
        if "mode" not in char_cols:
            await ex("ALTER TABLE characters ADD COLUMN mode TEXT NOT NULL DEFAULT 'character'")
            await ex("UPDATE characters SET mode='rpg'")
        if "assets" not in char_cols:
            await ex("ALTER TABLE characters ADD COLUMN assets TEXT NOT NULL DEFAULT '{}'")
        if "owner_id" not in char_cols:
            await ex("ALTER TABLE characters ADD COLUMN owner_id TEXT")
        if "is_public" not in char_cols:
            await ex("ALTER TABLE characters ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0")
            await ex("UPDATE characters SET is_public=1 WHERE owner_id IS NULL")
        if "presentation_html" not in char_cols:
            await ex("ALTER TABLE characters ADD COLUMN presentation_html TEXT NOT NULL DEFAULT ''")
        if "can_be_persona" not in char_cols:
            await ex("ALTER TABLE characters ADD COLUMN can_be_persona INTEGER NOT NULL DEFAULT 0")
        if "allow_download" not in char_cols:
            await ex("ALTER TABLE characters ADD COLUMN allow_download INTEGER NOT NULL DEFAULT 0")
        if "description" not in char_cols:
            await ex("ALTER TABLE characters ADD COLUMN description TEXT NOT NULL DEFAULT ''")
        if "is_explicit" not in char_cols:
            await ex("ALTER TABLE characters ADD COLUMN is_explicit INTEGER NOT NULL DEFAULT 0")

    sess_cols = await _columns(conn, "sessions")
    if sess_cols:
        if "user_id" not in sess_cols:
            await ex("ALTER TABLE sessions ADD COLUMN user_id TEXT")
        if "style_key" not in sess_cols:
            await ex("ALTER TABLE sessions ADD COLUMN style_key TEXT NOT NULL DEFAULT 'unspecified'")
        if "style_prompt" not in sess_cols:
            await ex("ALTER TABLE sessions ADD COLUMN style_prompt TEXT")
        if "language" not in sess_cols:
            await ex("ALTER TABLE sessions ADD COLUMN language TEXT")
        if "char_doing" not in sess_cols:
            await ex("ALTER TABLE sessions ADD COLUMN char_doing TEXT")
        if "char_location" not in sess_cols:
            await ex("ALTER TABLE sessions ADD COLUMN char_location TEXT")
        if "known_names" not in sess_cols:
            await ex("ALTER TABLE sessions ADD COLUMN known_names TEXT NOT NULL DEFAULT '[]'")
        if "author_note" not in sess_cols:
            await ex("ALTER TABLE sessions ADD COLUMN author_note TEXT")
        if "glossary" not in sess_cols:
            await ex("ALTER TABLE sessions ADD COLUMN glossary TEXT NOT NULL DEFAULT '{}'")

    user_cols = await _columns(conn, "users")
    if user_cols and "status" not in user_cols:
        await ex("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
    for col, ddl in (("display_name", "ALTER TABLE users ADD COLUMN display_name TEXT"),
                     ("bio", "ALTER TABLE users ADD COLUMN bio TEXT"),
                     ("avatar", "ALTER TABLE users ADD COLUMN avatar TEXT"),
                     ("banner_color", "ALTER TABLE users ADD COLUMN banner_color TEXT"),
                     ("accent_color", "ALTER TABLE users ADD COLUMN accent_color TEXT"),
                     ("banner_img", "ALTER TABLE users ADD COLUMN banner_img TEXT"),
                     ("social_links", "ALTER TABLE users ADD COLUMN social_links TEXT NOT NULL DEFAULT '{}'"),
                     ("profile_html", "ALTER TABLE users ADD COLUMN profile_html TEXT NOT NULL DEFAULT ''")):
        if user_cols and col not in user_cols:
            await ex(ddl)

    msg_cols = await _columns(conn, "messages")
    if msg_cols and "lang" not in msg_cols:
        await ex("ALTER TABLE messages ADD COLUMN lang TEXT")
    if msg_cols and "image" not in msg_cols:
        await ex("ALTER TABLE messages ADD COLUMN image TEXT")
    if msg_cols and "image_positive" not in msg_cols:
        await ex("ALTER TABLE messages ADD COLUMN image_positive TEXT")
    if msg_cols and "image_negative" not in msg_cols:
        await ex("ALTER TABLE messages ADD COLUMN image_negative TEXT")
    if msg_cols and "image_ts" not in msg_cols:
        await ex("ALTER TABLE messages ADD COLUMN image_ts INTEGER")

    persona_cols = await _columns(conn, "personas")
    if persona_cols:
        if "owner_id" not in persona_cols:
            await ex("ALTER TABLE personas ADD COLUMN owner_id TEXT")
        if "source_char_id" not in persona_cols:
            await ex("ALTER TABLE personas ADD COLUMN source_char_id TEXT")

    lore_cols = await _columns(conn, "lore")
    if lore_cols:
        if "image" not in lore_cols:
            await ex("ALTER TABLE lore ADD COLUMN image TEXT NOT NULL DEFAULT ''")
        if "category" not in lore_cols:
            await ex("ALTER TABLE lore ADD COLUMN category TEXT NOT NULL DEFAULT ''")
        if "hidden" not in lore_cols:
            await ex("ALTER TABLE lore ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0")
        if "name" not in lore_cols:
            await ex("ALTER TABLE lore ADD COLUMN name TEXT NOT NULL DEFAULT ''")
        if "appearance_tags" not in lore_cols:
            await ex("ALTER TABLE lore ADD COLUMN appearance_tags TEXT NOT NULL DEFAULT ''")
        if "appearance_tags_negative" not in lore_cols:
            await ex("ALTER TABLE lore ADD COLUMN appearance_tags_negative TEXT NOT NULL DEFAULT ''")


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
    d["is_admin"] = bool(d.get("is_admin"))
    try:
        d["social_links"] = json.loads(d.get("social_links") or "{}")
    except (json.JSONDecodeError, TypeError):
        d["social_links"] = {}
    d["profile_html"] = d.get("profile_html") or ""
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


async def update_user_profile(uid: str, data: dict):
    """Profile fields only — never auth/role fields."""
    allowed = {k: data[k] for k in ("display_name", "bio", "avatar", "banner_color",
                                    "accent_color", "banner_img", "social_links",
                                    "profile_html") if k in data}
    if not allowed:
        return
    if "social_links" in allowed:
        allowed["social_links"] = json.dumps(allowed["social_links"] or {})
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
    return [_user_row(r) for r in await _q(select(users).order_by(users.c.created.asc()))]


async def update_user_password(uid: str, new_password: str):
    await _w(update(users).where(users.c.id == uid).values(
        password_hash=hash_password(new_password)))


async def update_user_role(uid: str, is_admin: bool):
    await _w(update(users).where(users.c.id == uid).values(is_admin=int(is_admin)))


async def delete_user(uid: str):
    async with _engine.begin() as conn:
        await conn.execute(delete(auth_sessions).where(auth_sessions.c.user_id == uid))
        await conn.execute(delete(user_settings).where(user_settings.c.user_id == uid))
        await conn.execute(delete(users).where(users.c.id == uid))


# ── auth sessions ────────────────────────────────────────────────────────────

async def create_auth_session(user_id: str) -> str:
    token = secrets.token_hex(32)
    await _w(insert(auth_sessions).values(
        token=token, user_id=user_id, expires=time.time() + SESSION_TTL))
    return token


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
            stmt = _upsert(user_settings).values(
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
    d["tags"] = _loads(d.get("tags"), [])
    d["persona"] = _decrypt_secret(d.get("persona") or "")
    d["scenario"] = _decrypt_secret(d.get("scenario") or "")
    d["greeting"] = _decrypt_secret(d.get("greeting") or "")
    d["dialogue"] = _decrypt_secret(d.get("dialogue") or "")
    d["system_prompt"] = _decrypt_secret(d.get("system_prompt") or "")
    d["alt_greetings"] = _decrypt_json_list(d.get("alt_greetings"))
    d["assets"] = _loads(d.get("assets"), {})
    d["is_public"] = bool(d.get("is_public"))
    d["can_be_persona"] = bool(d.get("can_be_persona"))
    d["allow_download"] = bool(d.get("allow_download"))
    d["is_explicit"] = bool(d.get("is_explicit"))
    return d


async def create_character(data: dict) -> dict:
    cid = nid("c")
    mode = data.get("mode", "character")
    if mode not in ("character", "rpg"):
        mode = "character"
    await _w(insert(characters).values(
        id=cid,
        name=data.get("name") or "Unnamed",
        persona=_encrypt_secret(data.get("persona") or ""),
        scenario=_encrypt_secret(data.get("scenario") or ""),
        greeting=_encrypt_secret(data.get("greeting") or ""),
        dialogue=_encrypt_secret(data.get("dialogue") or ""),
        system_prompt=_encrypt_secret(data.get("system_prompt") or ""),
        tags=json.dumps(data.get("tags") or []),
        creator=data.get("creator") or "you",
        avatar=data.get("avatar") or "",
        alt_greetings=_encrypt_json_list(data.get("alt_greetings") or []),
        mode=mode,
        assets=json.dumps(data.get("assets") or {}),
        owner_id=data.get("owner_id"),
        is_public=int(bool(data.get("is_public", False))),
        presentation_html=data.get("presentation_html") or "",
        can_be_persona=int(bool(data.get("can_be_persona", False))),
        allow_download=int(bool(data.get("allow_download", False))),
        description=data.get("description") or "",
        is_explicit=int(bool(data.get("is_explicit", False))),
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


async def list_characters(q: str | None = None, user_id: str | None = None,
                           is_admin: bool = False,
                           scope: str | None = None) -> list[dict]:
    """Return characters filtered by scope.

    scope='mine'      → owner's private characters only
    scope='community' → public characters (is_public=1)
    scope=None        → public + user's own (legacy / admin uses all)
    """
    conditions = []
    if scope == "mine":
        conditions.append(characters.c.owner_id == (user_id or ""))
    elif scope == "community":
        conditions.append(characters.c.is_public == 1)
    else:
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
        name=data.get("name") or c["name"],
        persona=_encrypt_secret(data.get("persona", c["persona"]) or ""),
        scenario=_encrypt_secret(data.get("scenario", c["scenario"]) or ""),
        greeting=_encrypt_secret(data.get("greeting", c["greeting"]) or ""),
        dialogue=_encrypt_secret(data.get("dialogue", c["dialogue"]) or ""),
        system_prompt=_encrypt_secret(data.get("system_prompt", c.get("system_prompt", "")) or ""),
        tags=json.dumps(data.get("tags", c["tags"])),
        creator=data.get("creator", c["creator"]),
        avatar=data.get("avatar", c["avatar"]),
        alt_greetings=_encrypt_json_list(data.get("alt_greetings", c["alt_greetings"])),
        mode=mode,
        assets=json.dumps(data.get("assets", c["assets"]) or {}),
        owner_id=owner_id,
        is_public=is_public,
        presentation_html=data.get("presentation_html", c.get("presentation_html", "")),
        can_be_persona=int(bool(data.get("can_be_persona", c.get("can_be_persona", False)))),
        allow_download=int(bool(data.get("allow_download", c.get("allow_download", False)))),
        description=data.get("description", c.get("description", "")),
        is_explicit=int(bool(data.get("is_explicit", c.get("is_explicit", False))))))
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
    d["description"] = _decrypt_secret(d.get("description") or "")
    return d


async def create_persona(data: dict, user_id: str = None) -> dict:
    pid = nid("p")
    async with _engine.begin() as conn:
        if data.get("is_default"):
            await conn.execute(update(personas)
                               .where(personas.c.owner_id == user_id)
                               .values(is_default=0))
        await conn.execute(insert(personas).values(
            id=pid, name=data.get("name") or "You",
            description=_encrypt_secret(data.get("description") or ""),
            is_default=1 if data.get("is_default") else 0,
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
                        personas.c.source_char_id.is_(None)))
            .order_by(personas.c.is_default.desc(), personas.c.created.desc()))
    return [_persona_row(r) for r in await _q(stmt)]


async def list_persona_pool_characters(user_id: str = None, is_admin: bool = False) -> list[dict]:
    """Characters flagged can_be_persona that the user is allowed to play as."""
    conditions = [characters.c.can_be_persona == 1]
    if user_id:
        conditions.append(or_(characters.c.is_public == 1,
                              characters.c.owner_id == user_id))
    else:
        conditions.append(characters.c.is_public == 1)
    stmt = select(characters).where(and_(*conditions)).order_by(characters.c.name)
    return [_char_row(r) for r in await _q(stmt)]


async def get_or_create_persona_from_character(char: dict, user_id: str = None) -> dict:
    row = await _q1(select(personas).where(and_(
        personas.c.source_char_id == char["id"], personas.c.owner_id == user_id)))
    if row:
        return _persona_row(row)
    pid = nid("p")
    await _w(insert(personas).values(
        id=pid, name=char["name"],
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
        await conn.execute(update(personas).where(personas.c.id == pid).values(
            name=data.get("name", p["name"]),
            description=_encrypt_secret(data.get("description", p["description"]) or ""),
            is_default=1 if data.get("is_default") else p["is_default"]))
    return await get_persona(pid)


async def delete_persona(pid: str):
    await _w(delete(personas).where(personas.c.id == pid))


# ── lore ─────────────────────────────────────────────────────────────────────

def _lore_row(row) -> dict:
    d = dict(row)
    d["content"] = _decrypt_secret(d.get("content") or "")
    d["keys"] = [k for k in (d.get("keys") or "").split(",") if k]
    d["always"] = bool(d.get("always"))
    d["hidden"] = bool(d.get("hidden"))
    d["global"] = d.get("char_id") is None
    return d


def _lore_keys(keys) -> str:
    if isinstance(keys, list):
        return ",".join(k.strip() for k in keys if k.strip())
    return ",".join(k.strip() for k in str(keys or "").split(",") if k.strip())


async def create_lore(char_id, keys, content, always, image="", category="", hidden=False, name="",
                      appearance_tags="", appearance_tags_negative="") -> str:
    lid = nid("l")
    await _w(insert(lore).values(
        id=lid, char_id=char_id, keys=_lore_keys(keys),
        content=_encrypt_secret(content or ""), always=1 if always else 0,
        image=image, category=category, hidden=1 if hidden else 0, name=name,
        appearance_tags=appearance_tags, appearance_tags_negative=appearance_tags_negative,
        created=time.time()))
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
                      appearance_tags=None, appearance_tags_negative=None) -> bool:
    cur = await get_lore(lid)
    if not cur:
        return False
    await _w(update(lore).where(lore.c.id == lid).values(
        keys=_lore_keys(keys), content=_encrypt_secret(content or ""),
        always=1 if always else 0,
        image=cur["image"] if image is None else image,
        category=cur["category"] if category is None else category,
        hidden=(1 if cur["hidden"] else 0) if hidden is None else (1 if hidden else 0),
        name=cur["name"] if name is None else name,
        appearance_tags=cur["appearance_tags"] if appearance_tags is None else appearance_tags,
        appearance_tags_negative=cur["appearance_tags_negative"] if appearance_tags_negative is None else appearance_tags_negative))
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
        s["preview"] = _preview(last[s["id"]]) if s["id"] in last else ""
        s["message_count"] = counts.get(s["id"], 0)
    return out


async def create_session(char_id, persona_id, title, user_name, user_id=None) -> str:
    sid = nid("s")
    now = time.time()
    await _w(insert(sessions).values(
        id=sid, char_id=char_id, persona_id=persona_id, title=title,
        user_name=user_name, user_id=user_id, created=now, updated=now))
    return sid


async def get_session(sid: str) -> dict | None:
    s = await _q1(select(sessions).where(sessions.c.id == sid))
    if not s:
        return None
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
    await _w(update(sessions).where(sessions.c.id == sid).values(title=title))


async def set_session_style(sid: str, key: str, prompt: str | None):
    await _w(update(sessions).where(sessions.c.id == sid).values(
        style_key=key, style_prompt=prompt))


async def set_session_language(sid: str, language: str | None):
    await _w(update(sessions).where(sessions.c.id == sid).values(language=language))


async def set_session_glossary(sid: str, glossary: str):
    await _w(update(sessions).where(sessions.c.id == sid).values(glossary=glossary))


async def set_session_author_note(sid: str, note: str | None):
    await _w(update(sessions).where(sessions.c.id == sid).values(author_note=note))


async def set_char_state(sid: str, doing: str | None, location: str | None, known_names: list[str]):
    await _w(update(sessions).where(sessions.c.id == sid).values(
        char_doing=doing, char_location=location, known_names=json.dumps(known_names)))


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


async def set_message_image(sid: str, mid: str, url: str, positive: str = None, negative: str = None):
    await _w(update(messages).where(and_(
        messages.c.session_id == sid, messages.c.id == mid)).values(
        image=url, image_positive=positive, image_negative=negative,
        image_ts=int(time.time()) if url else None))


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
                sessions.c.char_id.label("char_id"),
                sessions.c.title.label("session_title"),
                characters.c.name.label("char_name"),
                characters.c.avatar.label("char_avatar"))
            .select_from(j)
            .where(and_(sessions.c.user_id == user_id,
                        messages.c.image.isnot(None),
                        messages.c.image != ""))
            .order_by(messages.c.ts.desc()))
    rows = await _q(stmt)
    for r in rows:
        content = _decrypt_secret(r.pop("content", "") or "")
        r["scene_full"] = _THINK_RE.sub("", content).strip()
        r["scene"] = _preview(content, 160)
    return rows


async def create_standalone_image(user_id: str, image: str, positive: str, negative: str) -> dict:
    iid = nid("si")
    created = time.time()
    await _w(insert(standalone_images).values(
        id=iid, user_id=user_id, image=image, positive=positive,
        negative=negative, created=created))
    return {"id": iid, "image": image, "positive": positive, "negative": negative, "created": created}


async def list_standalone_images(user_id: str) -> list[dict]:
    stmt = (select(standalone_images).where(standalone_images.c.user_id == user_id)
            .order_by(standalone_images.c.created.desc()))
    return await _q(stmt)


async def delete_standalone_image(iid: str, user_id: str) -> str | None:
    image = await _scalar(select(standalone_images.c.image).where(and_(
        standalone_images.c.id == iid, standalone_images.c.user_id == user_id)))
    if image is None:
        return None
    await _w(delete(standalone_images).where(standalone_images.c.id == iid))
    return image


async def flag_endpoint(user_id: str, url: str, api_key: str, reason: str) -> str:
    fid = nid("fe")
    await _w(insert(flagged_endpoints).values(
        id=fid, user_id=user_id, url=url,
        api_key=_encrypt_secret(api_key) if api_key else "",
        reason=reason, created=time.time()))
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
    return d


async def set_flagged_endpoint_status(fid: str, status: str):
    await _w(update(flagged_endpoints).where(flagged_endpoints.c.id == fid)
             .values(status=status))


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
            stmt = _upsert(settings).values(key=k, value=json.dumps(v))
            stmt = stmt.on_conflict_do_update(
                index_elements=["key"], set_={"value": stmt.excluded.value})
            await conn.execute(stmt)


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
            stmt = _upsert(localization).values(
                src_hash=h, lang=lang, kind=kind, source=src,
                translated=tr, created=now)
            stmt = stmt.on_conflict_do_update(
                index_elements=["src_hash", "lang"],
                set_={"translated": stmt.excluded.translated})
            await conn.execute(stmt)


# ── admin ────────────────────────────────────────────────────────────────────

async def purge_content():
    """Delete all chat/character content. Leaves users, auth, and user_settings intact."""
    async with _engine.begin() as conn:
        for tbl in (messages, sessions, lore, characters, personas):
            await conn.execute(delete(tbl))
        # settings holds global config, but _secret_enc_key must survive — wiping it
        # would silently make every already-encrypted user api_key undecryptable
        # (_decrypt_secret fails closed and returns "") on the next restart.
        await conn.execute(delete(settings).where(settings.c.key != "_secret_enc_key"))
