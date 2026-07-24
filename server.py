import os
import re
import html
import json
import asyncio
import hashlib
from contextlib import asynccontextmanager

from PIL import Image

from fastapi import FastAPI, Request, Response, Depends
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware
from starlette.exceptions import HTTPException

from backend import db
from backend import seed_content
from backend import vectors
from backend import llm
from backend.state import (CFG, MEDIA_DIR, STATIC_DIR, APP_VERSION,
                   apply_llm_config, log, api, auth_router, _log_buffer)
from backend.auth import _prune_login_attempts, get_current_user
from backend.repositories import users as user_repo
from backend.repositories import settings as global_settings_repo
from backend.repositories import lora_training as lora_training_repo
from backend.repositories import oauth_pending as oauth_pending_repo

@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init()
    saved = await global_settings_repo.all_settings()
    for k, v in saved.items():
        if k not in CFG or v is None:
            continue
        if k == "model_request_hosts" and isinstance(v, list):
            v = [{"host": e, "api_key": ""} if isinstance(e, str) else e for e in v]
        CFG[k] = v
    vectors.connect()
    await vectors.ensure_indexes(CFG["embed_dim"])
    apply_llm_config()

    n_stuck = await lora_training_repo.fail_stuck_jobs()
    if n_stuck:
        log.warning("startup: marked %d orphaned LoRA training job(s) as failed (queued/training when the process last stopped)", n_stuck)

    if not await user_repo.any_users():
        import secrets as _sec
        pwd = _sec.token_urlsafe(14)
        admin_user = await user_repo.create_user("admin", pwd, is_admin=True)
        seeded = await seed_content.seed_default_content(admin_user["id"])
        log.info("first run: seeded %d bundled content item(s)", seeded)
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
                await user_repo.cleanup_expired_sessions()
                _prune_login_attempts()
                await oauth_pending_repo.purge_expired()
            except Exception:
                log.exception("session cleanup failed")

    async def _log_buffer_prune_loop():

        while True:
            await asyncio.sleep(3600)
            try:
                _log_buffer._prune()
                await asyncio.get_running_loop().run_in_executor(None, _log_buffer.compact)
            except Exception:
                log.exception("log buffer prune failed")

    cleanup_task = asyncio.create_task(_session_cleanup_loop())
    health_task = asyncio.create_task(backend.routers.health.health_ping_loop())
    log_prune_task = asyncio.create_task(_log_buffer_prune_loop())
    yield
    cleanup_task.cancel()
    health_task.cancel()
    log_prune_task.cancel()
    await db.close()
    await vectors.close()

app = FastAPI(title="StoryHaven AI", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(GZipMiddleware, minimum_size=500)

def _strip_ciphertext(value):
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

from backend import auth
import backend.routers.webauthn
import backend.routers.oauth
import backend.routers.characters
import backend.routers.personas
import backend.routers.lore
import backend.routers.session_lore
import backend.routers.sessions
import backend.routers.chat
import backend.routers.imagegen
import backend.routers.model_previews
import backend.routers.profile
import backend.routers.settings
import backend.routers.misc
import backend.routers.admin
import backend.routers.comments
import backend.routers.notifications
import backend.routers.feature_flags
import backend.routers.health
import backend.routers.forum
import backend.routers.emojis
import backend.routers.multiplayer
import backend.routers.lora_training
import backend.routers.groups
import backend.routers.announcements

app.include_router(auth_router)
app.include_router(api)

@app.get("/api/openapi-schema")
async def get_openapi_schema(_user: dict = Depends(get_current_user)):
    return app.openapi()

class _NosniffStaticFiles(StaticFiles):
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
    s = " ".join((text or "").split())
    if len(s) <= limit:
        return s
    return s[:limit].rsplit(" ", 1)[0].rstrip() + "…"

def _abs_media_url(request: Request, path: str) -> str | None:
    if not path:
        return None
    if path.startswith("http://") or path.startswith("https://"):
        return path
    if path.startswith("/media/"):
        return str(request.base_url).rstrip("/") + path
    return None

def _blurred_media_path(rel_path: str) -> str | None:
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

def _og_cover(img, w, h):
    ratio = max(w / img.width, h / img.height)
    resized = img.resize((max(1, round(img.width * ratio)), max(1, round(img.height * ratio))))
    left = (resized.width - w) // 2
    top = (resized.height - h) // 2
    return resized.crop((left, top, left + w, top + h))

def _og_contain(img, w, h):
    ratio = min(w / img.width, h / img.height)
    return img.resize((max(1, round(img.width * ratio)), max(1, round(img.height * ratio))))

def _og_creator_footer(canvas, draw, name, avatar_rel, accent_hex, banner_hex):
    from PIL import ImageDraw
    width, footer_top = 1200, 546
    draw.rectangle([0, footer_top, width, 630], fill=_OG_PAPER)
    draw.line([(0, footer_top), (width, footer_top)], fill=_OG_GOLD, width=2)
    size, ring, ax, ay = 60, 3, 48, 558
    text_x = ax
    avatar = _og_open_media(avatar_rel)
    if avatar is not None:
        accent_rgb = _og_hex_rgb(accent_hex, _OG_GOLD)
        banner_rgb = _og_hex_rgb(banner_hex, accent_rgb)
        outer = size + ring * 2
        gradient = _og_diagonal_gradient(outer, accent_rgb, banner_rgb)
        outer_mask = Image.new("L", (outer, outer), 0)
        ImageDraw.Draw(outer_mask).ellipse([0, 0, outer - 1, outer - 1], fill=255)
        canvas.paste(gradient, (ax - ring, ay - ring), outer_mask)
        av = _og_cover(avatar, size, size)
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
        canvas.paste(av, (ax, ay), mask)
        text_x = ax + size + 20
    draw.text((text_x, ay + 14), (name or "")[:44], font=_og_font(_FONT_BODY, 30, 600), fill=_OG_GOLD)

def _compose_image_card(rel_path, name, avatar_rel, accent_hex, banner_hex):
    from PIL import ImageFilter, ImageDraw
    if not rel_path or not rel_path.startswith("/media/"):
        return None
    fname = rel_path[len("/media/"):].split("?")[0]
    base, _ext = os.path.splitext(fname)
    digest = hashlib.md5(f"{fname}|{name}|{avatar_rel}|{accent_hex}|{banner_hex}".encode()).hexdigest()[:8]
    cache_name = f"{base}_ogcard{digest}v{_OG_IMG_VERSION}.png"
    cache_fs = os.path.join(MEDIA_DIR, cache_name)
    if os.path.exists(cache_fs):
        return f"/media/{cache_name}"
    src_fs = os.path.join(MEDIA_DIR, fname)
    header_fs = os.path.join(STATIC_DIR, "img", "og-header.png")
    try:
        art = Image.open(src_fs).convert("RGB")
        header = Image.open(header_fs).convert("RGB").resize((1200, 150))
    except Exception as e:
        log.warning("og compose: cannot open art/header for %s: %s", rel_path, e)
        return None
    width, height, band, footer_top = 1200, 630, 150, 546
    art_h = footer_top - band
    canvas = Image.new("RGB", (width, height), _OG_PAPER)
    draw = ImageDraw.Draw(canvas)
    background = _og_cover(art, width, art_h).filter(ImageFilter.GaussianBlur(28))
    background = Image.blend(background, Image.new("RGB", (width, art_h), (0, 0, 0)), 0.45)
    canvas.paste(background, (0, band))
    foreground = _og_contain(art, width - 96, art_h - 48)
    canvas.paste(foreground, ((width - foreground.width) // 2, band + (art_h - foreground.height) // 2))
    _og_creator_footer(canvas, draw, name, avatar_rel, accent_hex, banner_hex)
    canvas.paste(header, (0, 0))
    try:
        canvas.save(cache_fs, "PNG")
    except Exception as e:
        log.warning("og compose: cannot save %s: %s", cache_fs, e)
        return None
    return f"/media/{cache_name}"

def _og_image_url(request: Request, art_rel_path, name=None, avatar_rel=None,
                  accent_hex=None, banner_hex=None) -> str:
    origin = str(request.base_url).rstrip("/")
    composite = _compose_image_card(art_rel_path, name, avatar_rel, accent_hex, banner_hex)
    if composite:
        return f"{origin}{composite}"
    return f"{origin}/img/storyhaven-og.png?v={_OG_IMG_VERSION}"

_FONT_DISPLAY = os.path.join(STATIC_DIR, "fonts", "Fraunces.ttf")
_FONT_BODY = os.path.join(STATIC_DIR, "fonts", "Inter.ttf")
_OG_GOLD = (227, 189, 108)
_OG_MUTED = (183, 176, 160)
_OG_PAPER = (12, 12, 14)

def _og_hex_rgb(value, fallback):
    text = (value or "").strip().lstrip("#")
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    if len(text) != 6:
        return fallback
    try:
        return tuple(int(text[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return fallback

def _og_diagonal_gradient(size, start_rgb, end_rgb):
    from PIL import Image as _Image
    grad = _Image.new("RGB", (size, size))
    px = grad.load()
    span = max(1, (size - 1) * 2)
    for y in range(size):
        for x in range(size):
            t = (x + y) / span
            px[x, y] = tuple(round(start_rgb[i] + (end_rgb[i] - start_rgb[i]) * t) for i in range(3))
    return grad

def _og_font(path, size, weight):
    from PIL import ImageFont
    font = ImageFont.truetype(path, size)
    try:
        values = []
        for axis in font.get_variation_axes():
            name = (axis["name"].decode() if isinstance(axis["name"], bytes) else axis["name"]).lower()
            if "weight" in name:
                values.append(weight)
            elif "optical" in name:
                values.append(min(max(size, 9), 144))
            else:
                values.append(axis.get("default") or axis.get("minimum") or 0)
        font.set_variation_by_axes(values)
    except Exception:
        pass
    return font

def _og_wrap(draw, text, font, max_width, max_lines):
    lines, current = [], ""
    for word in (text or "").split():
        trial = (current + " " + word).strip()
        if draw.textlength(trial, font=font) <= max_width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
            if len(lines) == max_lines:
                current = ""
                break
    if current and len(lines) < max_lines:
        lines.append(current)
    if len(lines) == max_lines:
        last = lines[-1]
        while last and draw.textlength(last + "…", font=font) > max_width:
            last = last[:-1]
        lines[-1] = (last.rstrip() + "…") if last else last
    return lines

def _og_open_media(rel_path):
    if not rel_path or not rel_path.startswith("/media/"):
        return None
    try:
        return Image.open(os.path.join(MEDIA_DIR, rel_path[len("/media/"):].split("?")[0])).convert("RGB")
    except Exception:
        return None

def _og_draw_tags(draw, x, y, tags, font):
    cx = x
    for tag in (tags or [])[:4]:
        label = str(tag)[:18]
        pill_w = draw.textlength(label, font=font) + 26
        if cx + pill_w > 1152:
            break
        draw.rounded_rectangle([cx, y, cx + pill_w, y + 36], radius=18, outline=_OG_GOLD, width=2)
        draw.text((cx + 13, y + 6), label, font=font, fill=_OG_GOLD)
        cx += pill_w + 10

def _compose_profile_card(name, desc, avatar_rel, banner_rel, tags, cache_key,
                          accent_hex=None, banner_hex=None):
    from PIL import ImageDraw, ImageFilter
    import hashlib
    digest = hashlib.md5(f"{cache_key}|{name}|{desc}|{avatar_rel}|{banner_rel}|{tags}|{accent_hex}|{banner_hex}".encode()).hexdigest()[:12]
    cache_name = f"ogp_{digest}_v{_OG_IMG_VERSION}.png"
    cache_fs = os.path.join(MEDIA_DIR, cache_name)
    if os.path.exists(cache_fs):
        return f"/media/{cache_name}"
    width, height, band, strip_h = 1200, 630, 150, 210
    canvas = Image.new("RGB", (width, height), _OG_PAPER)
    draw = ImageDraw.Draw(canvas)
    strip_src = _og_open_media(banner_rel)
    blur_strip = strip_src is None
    if strip_src is None:
        strip_src = _og_open_media(avatar_rel)
    if strip_src is not None:
        strip = _og_cover(strip_src, width, strip_h)
        if blur_strip:
            strip = strip.filter(ImageFilter.GaussianBlur(24))
            strip = Image.blend(strip, Image.new("RGB", (width, strip_h), (0, 0, 0)), 0.4)
        canvas.paste(strip, (0, band))
    draw.line([(0, band + strip_h), (width, band + strip_h)], fill=_OG_GOLD, width=2)
    size, ax, ay, ring = 148, 48, band + strip_h - 72, 5
    avatar = _og_open_media(avatar_rel)
    text_x = 48
    if avatar is not None:
        accent_rgb = _og_hex_rgb(accent_hex, _OG_GOLD)
        banner_rgb = _og_hex_rgb(banner_hex, accent_rgb)
        outer = size + ring * 2
        gradient = _og_diagonal_gradient(outer, accent_rgb, banner_rgb)
        outer_mask = Image.new("L", (outer, outer), 0)
        ImageDraw.Draw(outer_mask).rounded_rectangle([0, 0, outer - 1, outer - 1], radius=31, fill=255)
        canvas.paste(gradient, (ax - ring, ay - ring), outer_mask)
        av = _og_cover(avatar, size, size)
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=26, fill=255)
        canvas.paste(av, (ax, ay), mask)
        text_x = ax + size + 34
    name_y = band + strip_h + 18
    draw.text((text_x, name_y), (name or "")[:38], font=_og_font(_FONT_DISPLAY, 50, 600), fill=_OG_GOLD)
    tags_bottom = 0
    if tags:
        _og_draw_tags(draw, text_x, name_y + 66, tags, _og_font(_FONT_BODY, 22, 500))
        tags_bottom = name_y + 66 + 36
    desc_font = _og_font(_FONT_BODY, 26, 400)
    desc_y = max(ay + size + 28, tags_bottom + 18)
    for i, line in enumerate(_og_wrap(draw, desc, desc_font, width - 96, 3)):
        draw.text((48, desc_y + i * 37), line, font=desc_font, fill=_OG_MUTED)
    try:
        header = Image.open(os.path.join(STATIC_DIR, "img", "og-header.png")).convert("RGB").resize((width, band))
        canvas.paste(header, (0, 0))
    except Exception:
        pass
    try:
        canvas.save(cache_fs, "PNG")
    except Exception as e:
        log.warning("og profile card save failed: %s", e)
        return None
    return f"/media/{cache_name}"

def _og_profile_url(request: Request, name, desc, avatar_rel, banner_rel, tags, cache_key,
                    accent_hex=None, banner_hex=None) -> str:
    origin = str(request.base_url).rstrip("/")
    card = _compose_profile_card(name, desc, avatar_rel, banner_rel, tags, cache_key,
                                 accent_hex, banner_hex)
    if card:
        return f"{origin}{card}"
    return f"{origin}/img/storyhaven-og.png?v={_OG_IMG_VERSION}"

def _is_wide_enough_for_large_card(img_url: str | None) -> bool:
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
    path = os.path.join(STATIC_DIR, "index.html")
    mtime = os.path.getmtime(path)
    if _SHELL_CACHE.get("mtime") != mtime:
        with open(path, encoding="utf-8") as f:
            _SHELL_CACHE["html"] = f.read()
        _SHELL_CACHE["mtime"] = mtime
    return _SHELL_CACHE["html"]

_OG_IMG_VERSION = "5"

def _share_shell(title, desc, img, og_type, canonical_url, theme_color="#E3BD6C"):
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
    if theme_color:
        shell = re.sub(r'<meta name="theme-color"[^>]*>',
                       f'<meta name="theme-color" content="{esc_html(theme_color)}">', shell, count=1)
    shell = shell.replace("</head>", meta, 1)
    return Response(content=shell, media_type="text/html",
                    headers={"Cache-Control": "no-store, must-revalidate"})

@app.get("/c/{cid}")
async def character_share_card(cid: str, request: Request):
    c = await db.get_character(cid)
    brand_name = "StoryHaven AI"
    brand_tagline = "Forge worlds. Remember everything."
    if c and c.get("is_public"):
        title = c.get("name") or brand_name
        desc = _og_excerpt(c.get("description")) or brand_tagline
        owner = await user_repo.get_user_by_id(c.get("owner_id")) if c.get("owner_id") else None
        img = _og_profile_url(request, c.get("name") or brand_name, desc,
                              c.get("avatar"), (c.get("assets") or {}).get("banner"),
                              c.get("tags"), f"c{cid}",
                              (owner or {}).get("accent_color"), (owner or {}).get("banner_color"))
    else:
        title = brand_name
        desc = brand_tagline
        img = f"{str(request.base_url).rstrip('/')}/img/storyhaven-og.png?v={_OG_IMG_VERSION}"
    canonical = f"{str(request.base_url).rstrip('/')}/c/{cid}"
    return _share_shell(title, desc, img, "website", canonical)

@app.get("/u/{username}")
async def user_share_card(username: str, request: Request):
    u = await user_repo.get_user_by_username(username)
    brand_name = "StoryHaven AI"
    brand_tagline = "Forge worlds. Remember everything."
    if u and u.get("status") == "active":
        title = db._decrypt_secret(u.get("display_name") or "") or u.get("username") or brand_name
        desc = _og_excerpt(db._decrypt_secret(u.get("bio") or "")) or brand_tagline
        img = _og_profile_url(request, title, desc, u.get("avatar"), u.get("banner_img"),
                              None, f"u{username}", u.get("accent_color"), u.get("banner_color"))
    else:
        title = brand_name
        desc = brand_tagline
        img = f"{str(request.base_url).rstrip('/')}/img/storyhaven-og.png?v={_OG_IMG_VERSION}"
    canonical = f"{str(request.base_url).rstrip('/')}/u/{username}"
    return _share_shell(title, desc, img, "profile", canonical)

@app.get("/i/{iid}")
async def image_share_card(iid: str, request: Request):
    rec = await db.get_standalone_image(iid)
    brand_name = "StoryHaven AI"
    brand_tagline = "Forge worlds. Remember everything."
    art_rel = None
    if rec and rec.get("is_public"):
        if rec.get("is_explicit"):
            art_rel = _blurred_media_path(rec.get("image", ""))
        else:
            art_rel = rec.get("image") or None
    creator = None
    if art_rel:
        creator = await user_repo.get_user_by_id(rec.get("user_id"))
        name = (creator or {}).get("display_name") or (creator or {}).get("username") or "a StoryHaven creator"
        title = f"View this image on {brand_name}"
        desc = f"By {name}"
    else:
        name = brand_name
        title = brand_name
        desc = brand_tagline
    img = _og_image_url(request, art_rel, name if art_rel else None,
                        (creator or {}).get("avatar"), (creator or {}).get("accent_color"),
                        (creator or {}).get("banner_color"))
    canonical = f"{str(request.base_url).rstrip('/')}/i/{iid}"
    return _share_shell(title, desc, img, "website", canonical)

@app.get("/settings-docs")
async def docs_share_card(request: Request):
    origin = str(request.base_url).rstrip("/")
    title = "How StoryHaven Works"
    desc = ("The whole architecture in plain English. How it remembers your stories, "
            "pulls in your world, and runs group chats. Sign in to read the full docs.")
    img = f"{origin}/img/docs-og.png?v={_OG_IMG_VERSION}"
    canonical = f"{origin}/settings-docs"
    return _share_shell(title, desc, img, "website", canonical)

@app.get("/version")
async def frontend_version():

    names = ["index.html"]
    for sub, exts in (("js", (".js",)), ("css", (".css",))):
        d = os.path.join(STATIC_DIR, sub)
        names += sorted(os.path.join(sub, n) for n in os.listdir(d) if n.endswith(exts))
    try:
        stamp = "|".join(str(os.path.getmtime(os.path.join(STATIC_DIR, n))) for n in names)
    except OSError as e:
        log.warning("frontend_version: mtime lookup failed, falling back to constant stamp: %s", e)
        stamp = "0"
    return {"v": hashlib.sha256(stamp.encode()).hexdigest()[:16], "app_version": APP_VERSION}

class _RevalidateStaticFiles(StaticFiles):
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
