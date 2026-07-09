"""server.py — FastAPI app assembly.

Thin composition root: builds the app + lifespan, wires shared infrastructure
(db, vectors, llm config, background session cleanup), and includes the domain
routers in the original registration order. All route handlers and business
logic live in the backend/ package (the only module outside it is this file):

  backend/state.py         config/CFG, logging, the shared api/auth_router objects
  backend/auth.py          session cookies, user dependencies, login throttle, /api/auth/*
  backend/ssrf.py          bring-your-own endpoint validation
  backend/prompt.py        build_system, sampling params, mood parsing, dice
  backend/media.py         image validation/optimization, media file helpers
  backend/chat_service.py  retrieval, memory, side-call extractors, SSE machinery, _run
  backend/routers/*        the /api/* route handlers, grouped by domain

Run:  uvicorn server:app --port 8000
"""
import os
import re
import html
import json
import asyncio
import hashlib
from contextlib import asynccontextmanager

from PIL import Image

from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

from backend import db
from backend import vectors
from backend import llm
from backend.state import (CFG, MEDIA_DIR, STATIC_DIR, APP_VERSION,
                   apply_llm_config, log, api, auth_router)
from backend.auth import _prune_login_attempts

@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init()
    saved = await db.all_settings()
    for k, v in saved.items():
        if k not in CFG or v is None:
            continue
        if k == "model_request_hosts" and isinstance(v, list):
            v = [{"host": e, "api_key": ""} if isinstance(e, str) else e for e in v]
        CFG[k] = v
    vectors.connect()
    await vectors.ensure_indexes(CFG["embed_dim"])
    apply_llm_config()

    if not await db.any_users():
        import secrets as _sec
        pwd = _sec.token_urlsafe(14)
        await db.create_user("admin", pwd, is_admin=True)
        print("\n" + "=" * 60)
        print("FIRST RUN — Admin account created automatically")
        print(f"  Username : admin")
        print(f"  Password : {pwd}")
        print("Change this password after your first login.")
        print("=" * 60 + "\n")

    async def _session_cleanup_loop():
        while True:
            await asyncio.sleep(6 * 3600)
            try:
                await db.cleanup_expired_sessions()
                _prune_login_attempts()
            except Exception:
                log.exception("session cleanup failed")

    cleanup_task = asyncio.create_task(_session_cleanup_loop())
    health_task = asyncio.create_task(backend.routers.health.health_ping_loop())
    yield
    cleanup_task.cancel()
    health_task.cancel()
    await db.close()
    await vectors.close()


app = FastAPI(title="StoryHaven AI", lifespan=lifespan)


def _strip_ciphertext(value):
    """Recursively blank any string still carrying the raw 'enc:' at-rest prefix."""
    if isinstance(value, str):
        return ("", True) if value.startswith("enc:") else (value, False)
    if isinstance(value, list):
        changed = False
        out = []
        for v in value:
            nv, ch = _strip_ciphertext(v)
            out.append(nv)
            changed = changed or ch
        return out, changed
    if isinstance(value, dict):
        changed = False
        out = {}
        for k, v in value.items():
            nv, ch = _strip_ciphertext(v)
            out[k] = nv
            changed = changed or ch
        return out, changed
    return value, False


@app.middleware("http")
async def _ciphertext_leak_guard(request: Request, call_next):
    """Defense-in-depth: if any route ever forgets to decrypt an at-rest field,
    this scans outgoing JSON bodies and blanks any value still prefixed 'enc:'
    (log-and-strip — a blank field is a safer failure than either leaking
    ciphertext or hard-500'ing the page). Non-JSON and streaming (SSE) responses
    pass through untouched."""
    response = await call_next(request)
    ctype = response.headers.get("content-type", "")
    if "application/json" not in ctype:
        return response
    body = b""
    async for chunk in response.body_iterator:
        body += chunk if isinstance(chunk, bytes) else chunk.encode()
    if b'"enc:' not in body:
        return Response(content=body, status_code=response.status_code,
                        headers=dict(response.headers), media_type=response.media_type)
    try:
        data = json.loads(body)
        cleaned, changed = _strip_ciphertext(data)
    except (json.JSONDecodeError, UnicodeDecodeError):
        changed = False
    if not changed:
        return Response(content=body, status_code=response.status_code,
                        headers=dict(response.headers), media_type=response.media_type)
    log.warning("ciphertext-leak-guard: blanked 'enc:' value(s) leaking from %s %s",
                request.method, request.url.path)
    new_body = json.dumps(cleaned).encode()
    headers = dict(response.headers)
    headers.pop("content-length", None)
    return Response(content=new_body, status_code=response.status_code,
                    headers=headers, media_type="application/json")


# Importing these modules registers their routes onto the shared auth_router / api
# objects (from state.py). The import order here fixes the /api route registration
# order, which is kept identical to the original single-file server.
from backend import auth  # noqa: F401  (registers /api/auth/* routes)
import backend.routers.characters  # noqa: F401
import backend.routers.personas    # noqa: F401
import backend.routers.lore        # noqa: F401
import backend.routers.sessions    # noqa: F401
import backend.routers.profile     # noqa: F401
import backend.routers.settings    # noqa: F401
import backend.routers.misc        # noqa: F401
import backend.routers.admin       # noqa: F401
import backend.routers.comments     # noqa: F401
import backend.routers.notifications  # noqa: F401
import backend.routers.health       # noqa: F401
import backend.routers.forum        # noqa: F401
import backend.routers.emojis       # noqa: F401

app.include_router(auth_router)
app.include_router(api)
class _NosniffStaticFiles(StaticFiles):
    """Adds X-Content-Type-Options: nosniff to every response. Uploaded files
    are already restricted to a real-image extension allowlist and re-decoded
    through PIL (see media.py), so this is defense-in-depth, not the primary
    control — it closes the residual case of a legacy MIME-sniffing browser
    guessing a different content type than the served extension for a file
    that happened to survive re-optimization unchanged."""
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response


app.mount("/media", _NosniffStaticFiles(directory=MEDIA_DIR), name="media")


def _spa_shell_response():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"),
                        headers={"Cache-Control": "no-store, must-revalidate"})


@app.get("/")
async def index():
    return _spa_shell_response()


def esc_html(s: str) -> str:
    return html.escape(str(s or ""), quote=True)


def _og_excerpt(text: str, limit: int = 200) -> str:
    """One-line, length-capped excerpt for og:description — link-preview crawlers
    want a short single-line summary, not the entity's whole multi-paragraph body,
    so newlines/runs of whitespace are collapsed and the text is cut on a word
    boundary with an ellipsis."""
    s = " ".join((text or "").split())
    if len(s) <= limit:
        return s
    return s[:limit].rsplit(" ", 1)[0].rstrip() + "…"


# Brand favicon for link-preview embeds (Discord/Slack/etc. show this small
# icon next to the site name) — a gold "❖" on the app's dark surface, inlined
# as a data URI so the share route needs no extra static asset.
FAVICON_DATA_URI = (
    "data:image/svg+xml,"
    "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E"
    "%3Crect width='64' height='64' rx='14' fill='%230C0C0E'/%3E"
    "%3Ctext x='32' y='45' font-size='36' text-anchor='middle' "
    "fill='%23E3BD6C' font-family='Georgia,serif'%3E%E2%9D%96%3C/text%3E"
    "%3C/svg%3E"
)


def _abs_media_url(request: Request, path: str) -> str | None:
    if not path:
        return None
    if path.startswith("http://") or path.startswith("https://"):
        return path
    if path.startswith("/media/"):
        return str(request.base_url).rstrip("/") + path
    return None


def _blurred_media_path(rel_path: str) -> str | None:
    """og:image is a raw URL a link-unfurler (Discord etc.) fetches directly —
    there's no CSS/JS control over what it renders, so an NSFW image can't be
    blurred client-side the way the in-app gallery does it. This generates
    (once, then caches on disk next to the original) an actually-blurred copy
    and returns its /media/... path, so the embed itself never exposes the
    real content to someone who hasn't opted into mature content and may not
    even have an account. Returns None if the source file is missing/unreadable
    — callers should fall back to no image rather than a broken embed."""
    if not rel_path or not rel_path.startswith("/media/"):
        return None
    fname = rel_path[len("/media/"):]
    base, ext = os.path.splitext(fname)
    blurred_name = f"{base}_blur{ext}"
    blurred_fs_path = os.path.join(MEDIA_DIR, blurred_name)
    if os.path.exists(blurred_fs_path):
        return f"/media/{blurred_name}"
    src_fs_path = os.path.join(MEDIA_DIR, fname)
    try:
        img = Image.open(src_fs_path).convert("RGB")
        from PIL import ImageFilter
        img = img.filter(ImageFilter.GaussianBlur(radius=max(img.width, img.height) / 20))
        img.save(blurred_fs_path, quality=80)
    except Exception:
        return None
    return f"/media/{blurred_name}"


def _is_wide_enough_for_large_card(img_url: str | None) -> bool:
    """Discord's summary_large_image card stretches og:image to a wide banner —
    great for a landscape banner, but a tall portrait avatar gets rendered
    huge and cropped oddly (see: a tall character-avatar embed looking like a
    giant sliver). Only use the large-image card for images that are actually
    landscape/near-square; portrait images fall back to the small `summary`
    card, which uses a modest square thumbnail that looks fine at any source
    aspect ratio. Defaults to True (large card) if the file can't be read —
    fails open to the previous behavior rather than breaking the embed."""
    if not img_url:
        return False
    idx = img_url.find("/media/")
    if idx == -1:
        return True
    local = os.path.join(MEDIA_DIR, img_url[idx + len("/media/"):].split("?")[0])
    try:
        with Image.open(local) as im:
            w, h = im.size
        return h == 0 or (w / h) >= 0.9
    except Exception:
        return True


_SHELL_CACHE: dict = {}
_OG_DEFAULT_RE = re.compile(r"<!-- og:default:start -->.*?<!-- og:default:end -->", re.S)


def _load_shell() -> str:
    """index.html read once and memoized, re-read only when its mtime changes —
    so the share routes don't hit disk on every request, while a live edit under
    uvicorn --reload still takes effect without a restart (matching the no-store
    hot-reload contract the plain static shell already honors)."""
    path = os.path.join(STATIC_DIR, "index.html")
    mtime = os.path.getmtime(path)
    if _SHELL_CACHE.get("mtime") != mtime:
        with open(path, encoding="utf-8") as f:
            _SHELL_CACHE["html"] = f.read()
        _SHELL_CACHE["mtime"] = mtime
    return _SHELL_CACHE["html"]


def _share_shell(title, desc, img, og_type, canonical_url):
    """Serve the real SPA shell (index.html) with link-unfurling <meta> tags
    injected into its <head>. Under clean-path routing the SPA renders these
    same URLs (/c/{cid}, /u/{username}) itself, so the old redirect-into-the-app
    trick would just bounce back to this very route — an infinite loop. Instead
    a real browser loads app.js from this shell and its router takes over from
    location.pathname; bots that never run JS still scrape the injected tags.
    Public/existing subjects only — otherwise a generic branded card, so a
    private character's name/description never leaks to whoever holds the link."""
    brand_name = "StoryHaven AI"
    shell = _OG_DEFAULT_RE.sub("", _load_shell(), count=1)
    img_tag = (f'<meta property="og:image" content="{esc_html(img)}">\n'
               f'<meta name="twitter:image" content="{esc_html(img)}">') if img else ""
    large_card = _is_wide_enough_for_large_card(img)
    meta = f"""<title>{esc_html(title)} — {esc_html(brand_name)}</title>
<meta property="og:site_name" content="{esc_html(brand_name)}">
<meta property="og:type" content="{og_type}">
<meta property="og:title" content="{esc_html(title)}">
<meta property="og:description" content="{esc_html(desc)}">
<meta property="og:url" content="{esc_html(canonical_url)}">
<meta name="twitter:card" content="{'summary_large_image' if large_card else 'summary'}">
<meta name="twitter:title" content="{esc_html(title)}">
<meta name="twitter:description" content="{esc_html(desc)}">
{img_tag}
</head>"""
    shell = shell.replace(
        "<title>StoryHaven AI — Forge worlds. Remember everything.</title>", "", 1)
    shell = shell.replace("</head>", meta, 1)
    return Response(content=shell, media_type="text/html",
                    headers={"Cache-Control": "no-store, must-revalidate"})


@app.get("/c/{cid}")
async def character_share_card(cid: str, request: Request):
    """SPA shell for the /c/{cid} character page, with link-unfurling <meta>
    tags injected for bots (Discord, WhatsApp, Slack, Twitter/X...) that don't
    run JS. Public characters only — private ones fall back to a generic branded
    card. Real browsers boot the SPA, whose router renders the character view."""
    c = await db.get_character(cid)
    brand_name = "StoryHaven AI"
    brand_tagline = "Forge worlds. Remember everything."
    if c and c.get("is_public"):
        title = c.get("name") or brand_name
        desc = _og_excerpt(c.get("description")) or brand_tagline
        img = (_abs_media_url(request, (c.get("assets") or {}).get("banner", ""))
               or _abs_media_url(request, c.get("avatar", "")))
    else:
        title = brand_name
        desc = brand_tagline
        img = None
    canonical = f"{str(request.base_url).rstrip('/')}/c/{cid}"
    return _share_shell(title, desc, img, "website", canonical)


@app.get("/u/{username}")
async def user_share_card(username: str, request: Request):
    """SPA shell for the /u/{username} profile page, with link-unfurling <meta>
    tags injected for bots that never execute the SPA's JS. Real browsers boot
    the SPA, whose router renders the profile view."""
    u = await db.get_user_by_username(username)
    brand_name = "StoryHaven AI"
    brand_tagline = "Forge worlds. Remember everything."
    if u and u.get("status") == "active":
        title = db._decrypt_secret(u.get("display_name") or "") or u.get("username") or brand_name
        desc = _og_excerpt(db._decrypt_secret(u.get("bio") or "")) or brand_tagline
        img = _abs_media_url(request, u.get("avatar", ""))
    else:
        title = brand_name
        desc = brand_tagline
        img = None
    canonical = f"{str(request.base_url).rstrip('/')}/u/{username}"
    return _share_shell(title, desc, img, "profile", canonical)


@app.get("/i/{iid}")
async def image_share_card(iid: str, request: Request):
    """SPA shell for the /i/{iid} standalone-image page, with link-unfurling
    <meta> tags injected for bots that never run JS. Public images only —
    private/unshared ones fall back to a generic branded card so nothing leaks.
    An NSFW public image shows a blurred copy in the embed instead of the real
    file — unlike the in-app Community feed, a link-unfurl preview is visible
    to literally anyone who sees the link (Discord, Slack, etc.), including
    people with no account here at all and no chance to opt into mature content."""
    rec = await db.get_standalone_image(iid)
    brand_name = "StoryHaven AI"
    brand_tagline = "Forge worlds. Remember everything."
    img = None
    if rec and rec.get("is_public"):
        if rec.get("is_explicit"):
            blurred = _blurred_media_path(rec.get("image", ""))
            img = _abs_media_url(request, blurred) if blurred else None
        else:
            img = _abs_media_url(request, rec.get("image", ""))
    if img:
        creator = await db.get_user_by_id(rec.get("user_id"))
        name = (creator or {}).get("display_name") or (creator or {}).get("username") or "a StoryHaven creator"
        title = f"View this image on {brand_name}"
        desc = f"By {name}"
    else:
        title = brand_name
        desc = brand_tagline
        img = None
    canonical = f"{str(request.base_url).rstrip('/')}/i/{iid}"
    return _share_shell(title, desc, img, "website", canonical)


@app.get("/version")
async def frontend_version():
    """Fingerprint of the served frontend (mtimes of the static files), polled by
    the frontend so an already-open tab notices a deploy and offers a reload —
    this is what makes cache-busting query strings unnecessary even for a SPA
    tab that's been open across an edit: no-cache headers only help on the
    *next* request, but a hash/history SPA doesn't naturally make one, so this
    gives it a reason to. Public (no auth) since it must be checkable before
    login too. Also carries the human-readable app version shown in the UI."""
    names = ("index.html",) + tuple(
        os.path.join("js", n) for n in (
            "core.js", "auth.js", "nav.js", "library.js", "admin.js", "comments.js",
            "dossier.js", "chat.js", "editor.js", "personas.js", "lorebook.js",
            "modal-settings.js", "boot.js")) + tuple(
        os.path.join("css", n) for n in (
            "base.css", "profile.css", "overlay.css", "studio.css", "pages.css",
            "studio2.css", "admin.css"))
    try:
        stamp = "|".join(str(os.path.getmtime(os.path.join(STATIC_DIR, n))) for n in names)
    except OSError:
        stamp = "0"
    return {"v": hashlib.sha256(stamp.encode()).hexdigest()[:16], "app_version": APP_VERSION}


class _RevalidateStaticFiles(StaticFiles):
    """Force browsers to always revalidate the js/*.js/style.css bundle via a conditional GET
    (ETag/Last-Modified, 304 when unchanged) instead of the heuristic caching a
    browser applies by default when no Cache-Control header is present — that
    heuristic can serve a stale script/stylesheet for hours after a deploy.
    Cheap: a 304 round-trip, not a full re-download. Makes manual cache-busting
    query strings (style.css?v=N) unnecessary — index.html itself is already
    no-store above, so it always points at the plain filename."""
    def _is_spa_route(self, path):
        return not os.path.splitext(path)[1] and not path.startswith(("api/", "media/"))

    async def get_response(self, path, scope):
        try:
            response = await super().get_response(path, scope)
        except HTTPException as e:
            if e.status_code == 404 and self._is_spa_route(path):
                return _spa_shell_response()
            raise
        if response.status_code == 404 and self._is_spa_route(path):
            return _spa_shell_response()
        if path.endswith((".js", ".css")):
            response.headers["Cache-Control"] = "no-cache"
        return response


app.mount("/", _RevalidateStaticFiles(directory=STATIC_DIR, html=True), name="static")
