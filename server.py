"""server.py — FastAPI app assembly.

Thin composition root: builds the app + lifespan, wires shared infrastructure
(db, vectors, llm config, background session cleanup), and includes the domain
routers in the original registration order. All route handlers and business
logic live in the sibling modules:

  state.py         config/CFG, logging, the shared api/auth_router objects
  auth.py          session cookies, user dependencies, login throttle, /api/auth/*
  ssrf.py          bring-your-own endpoint validation
  prompt.py        build_system, sampling params, mood parsing, dice
  media.py         image validation/optimization, media file helpers
  chat_service.py  retrieval, memory, side-call extractors, SSE machinery, _run
  routers/*        the /api/* route handlers, grouped by domain

Run:  uvicorn server:app --port 8000
"""
import os
import html
import json
import asyncio
import hashlib
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import db
import vectors
import llm
from state import (CFG, MEDIA_DIR, STATIC_DIR,
                   apply_llm_config, log, api, auth_router)
from auth import _prune_login_attempts

@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init()
    saved = await db.all_settings()
    for k, v in saved.items():
        if k in CFG and v is not None:
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
    yield
    cleanup_task.cancel()
    await db.close()
    await vectors.close()


app = FastAPI(title="StoryHaven AI", lifespan=lifespan)


# Importing these modules registers their routes onto the shared auth_router / api
# objects (from state.py). The import order here fixes the /api route registration
# order, which is kept identical to the original single-file server.
import auth  # noqa: F401  (registers /api/auth/* routes)
import routers.characters  # noqa: F401
import routers.personas    # noqa: F401
import routers.lore        # noqa: F401
import routers.sessions    # noqa: F401
import routers.profile     # noqa: F401
import routers.settings    # noqa: F401
import routers.misc        # noqa: F401
import routers.admin       # noqa: F401

app.include_router(auth_router)
app.include_router(api)
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")


@app.get("/")
async def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"),
                        headers={"Cache-Control": "no-store, must-revalidate"})


def esc_html(s: str) -> str:
    return html.escape(str(s or ""), quote=True)


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


@app.get("/c/{cid}")
async def character_share_card(cid: str, request: Request):
    """Server-rendered stand-in for the SPA's #/c/{cid} route, whose sole job
    is to give link-unfurling bots (Discord, WhatsApp, Slack, Twitter/X...)
    real <meta> tags to scrape — they don't run JS, so they never see the
    hash-routed SPA at all otherwise. Real browsers get bounced straight into
    the actual app via the redirect script below. Public characters only —
    private ones fall back to a generic branded card instead of leaking their
    name/description to whoever has the link."""
    c = await db.get_character(cid)
    brand_name = "StoryHaven AI"
    brand_tagline = "Forge worlds. Remember everything."
    if c and c.get("is_public"):
        title = c.get("name") or brand_name
        desc = (c.get("description") or "").strip() or brand_tagline
        img = (_abs_media_url(request, (c.get("assets") or {}).get("banner", ""))
               or _abs_media_url(request, c.get("avatar", "")))
    else:
        title = brand_name
        desc = brand_tagline
        img = None
    spa_url = f"{str(request.base_url).rstrip('/')}/#/c/{cid}"
    img_tag = f'<meta property="og:image" content="{esc_html(img)}">\n<meta name="twitter:image" content="{esc_html(img)}">' if img else ""
    html = f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#E3BD6C">
<title>{esc_html(title)} — {esc_html(brand_name)}</title>
<link rel="icon" href="{FAVICON_DATA_URI}">
<meta property="og:site_name" content="{esc_html(brand_name)}">
<meta property="og:type" content="website">
<meta property="og:title" content="{esc_html(title)}">
<meta property="og:description" content="{esc_html(desc)}">
<meta property="og:url" content="{esc_html(spa_url)}">
<meta name="twitter:card" content="{'summary_large_image' if img else 'summary'}">
<meta name="twitter:title" content="{esc_html(title)}">
<meta name="twitter:description" content="{esc_html(desc)}">
{img_tag}
<meta http-equiv="refresh" content="0; url={esc_html(spa_url)}">
<script>location.replace({json.dumps(spa_url)});</script>
</head><body></body></html>"""
    return Response(content=html, media_type="text/html")


@app.get("/u/{username}")
async def user_share_card(username: str, request: Request):
    """Server-rendered stand-in for the SPA's #/u/{username} route, same
    rationale as character_share_card: link-unfurling bots need real <meta>
    tags since they never execute the SPA's JS. Real browsers get bounced
    into the actual app via the redirect below."""
    u = await db.get_user_by_username(username)
    brand_name = "StoryHaven AI"
    brand_tagline = "Forge worlds. Remember everything."
    if u:
        title = u.get("display_name") or u.get("username") or brand_name
        desc = (u.get("bio") or "").strip() or brand_tagline
        img = _abs_media_url(request, u.get("avatar", ""))
    else:
        title = brand_name
        desc = brand_tagline
        img = None
    spa_url = f"{str(request.base_url).rstrip('/')}/#/u/{username}"
    img_tag = f'<meta property="og:image" content="{esc_html(img)}">\n<meta name="twitter:image" content="{esc_html(img)}">' if img else ""
    html = f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#E3BD6C">
<title>{esc_html(title)} — {esc_html(brand_name)}</title>
<link rel="icon" href="{FAVICON_DATA_URI}">
<meta property="og:site_name" content="{esc_html(brand_name)}">
<meta property="og:type" content="profile">
<meta property="og:title" content="{esc_html(title)}">
<meta property="og:description" content="{esc_html(desc)}">
<meta property="og:url" content="{esc_html(spa_url)}">
<meta name="twitter:card" content="{'summary_large_image' if img else 'summary'}">
<meta name="twitter:title" content="{esc_html(title)}">
<meta name="twitter:description" content="{esc_html(desc)}">
{img_tag}
<meta http-equiv="refresh" content="0; url={esc_html(spa_url)}">
<script>location.replace({json.dumps(spa_url)});</script>
</head><body></body></html>"""
    return Response(content=html, media_type="text/html")


@app.get("/version")
async def frontend_version():
    """Fingerprint of the served frontend (mtimes of the static files), polled by
    app.js so an already-open tab notices a deploy and offers a reload — this is
    what makes cache-busting query strings unnecessary even for a SPA tab that's
    been open across an edit: no-cache headers only help on the *next* request,
    but a hash/history SPA doesn't naturally make one, so this gives it a reason
    to. Public (no auth) since it must be checkable before login too."""
    names = ("index.html", "app.js", "style.css")
    try:
        stamp = "|".join(str(os.path.getmtime(os.path.join(STATIC_DIR, n))) for n in names)
    except OSError:
        stamp = "0"
    return {"v": hashlib.sha256(stamp.encode()).hexdigest()[:16]}


class _RevalidateStaticFiles(StaticFiles):
    """Force browsers to always revalidate app.js/style.css via a conditional GET
    (ETag/Last-Modified, 304 when unchanged) instead of the heuristic caching a
    browser applies by default when no Cache-Control header is present — that
    heuristic can serve a stale script/stylesheet for hours after a deploy.
    Cheap: a 304 round-trip, not a full re-download. Makes manual cache-busting
    query strings (style.css?v=N) unnecessary — index.html itself is already
    no-store above, so it always points at the plain filename."""
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if path.endswith((".js", ".css")):
            response.headers["Cache-Control"] = "no-cache"
        return response


app.mount("/", _RevalidateStaticFiles(directory=STATIC_DIR, html=True), name="static")
