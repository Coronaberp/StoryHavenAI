import os
import re
import html
import json
import asyncio
import hashlib
import mimetypes
from contextlib import asynccontextmanager

from PIL import Image

from fastapi import FastAPI, Request, Response, Depends
from fastapi.responses import FileResponse, JSONResponse
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
from backend.repositories import groups as groups_repo
from backend.repositories import session_invites
from backend.repositories import chat_sessions as chat_sessions_repo
from backend.repositories import session_characters as session_char_repo
from backend.repositories import session_participants
from backend.repositories import characters as characters_repo
from backend.repositories import content_likes as content_likes_repo
from backend.repositories import checkpoints as checkpoints_repo
from backend.repositories import upscalers as upscalers_repo
from backend.repositories import follows as follows_repo

mimetypes.add_type("image/webp", ".webp")

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
from backend import prompt_guard

_INJECTION_TIMEOUT_EXEMPT_PATHS = {"/api/auth/login", "/api/auth/register", "/api/auth/refresh"}

@app.middleware("http")
async def _prompt_injection_timeout_guard(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.url.path not in _INJECTION_TIMEOUT_EXEMPT_PATHS:
        claims = await auth._resolve_access_claims(request)
        if claims:
            remaining = prompt_guard.remaining_timeout(claims["sub"])
            if remaining > 0:
                return JSONResponse(status_code=429, content={
                    "detail": prompt_guard.BLOCKED_MESSAGE,
                    "retry_after": round(remaining, 1),
                })
    return await call_next(request)

@app.exception_handler(prompt_guard.PromptInjectionBlocked)
async def _prompt_injection_blocked_handler(request: Request, exc: prompt_guard.PromptInjectionBlocked):
    return JSONResponse(status_code=429, content={
        "detail": prompt_guard.BLOCKED_MESSAGE,
        "retry_after": round(exc.retry_after, 1),
    })

import backend.routers.webauthn
import backend.routers.oauth
import backend.routers.characters
import backend.routers.personas
import backend.routers.lore
import backend.routers.session_lore
import backend.routers.tts
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
import backend.routers.rbac
import backend.routers.admin_dev
import backend.routers.content_likes

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

def _og_join_names(names) -> str:
    names = [n for n in names if n]
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + " and " + names[-1]

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

def _og_creator_footer(canvas, draw, name, avatar_rel, accent_hex, banner_hex, username=None, tag_text=None):
    from PIL import ImageDraw
    width, footer_top = 1200, 510
    draw.rectangle([0, footer_top, width, 630], fill=_OG_PAPER)
    draw.line([(0, footer_top), (width, footer_top)], fill=_OG_GOLD, width=2)
    size, ring, ax, ay = 60, 3, 48, 530
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
        fitted = _og_contain(avatar, size, size)
        tile = Image.new("RGB", (size, size), accent_rgb)
        tile.paste(fitted, ((size - fitted.width) // 2, (size - fitted.height) // 2))
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
        canvas.paste(tile, (ax, ay), mask)
        text_x = ax + size + 20
    draw.text((text_x, ay + 2), (name or "")[:44], font=_og_font(_FONT_BODY, 28, 600), fill=_OG_GOLD)
    if username or tag_text:
        handle_font = _og_font(_FONT_BODY, 20, 500)
        row_cy = ay + 46
        cx = text_x
        if username:
            handle_text = f"@{username}"
            draw.text((cx, row_cy), handle_text, font=handle_font, fill=_OG_MUTED, anchor="lm")
            cx += draw.textlength(handle_text, font=handle_font) + 14
        if tag_text:
            tag_font = _og_font(_FONT_BODY, 15, 600)
            pill_h = 26
            pill_w = draw.textlength(tag_text, font=tag_font) + 22
            draw.rounded_rectangle([cx, row_cy - pill_h / 2, cx + pill_w, row_cy + pill_h / 2],
                                   radius=pill_h / 2, fill=_OG_GOLD)
            draw.text((cx + 11, row_cy), tag_text, font=tag_font, fill=_OG_PAPER, anchor="lm")

def _og_icon_message(draw, x, y, size, color):
    stroke = max(2, round(size * 0.08))
    pad = size * 0.12
    body_w, body_h = size - 2 * pad, size * 0.62
    draw.rounded_rectangle([x + pad, y + pad, x + pad + body_w, y + pad + body_h],
                           radius=size * 0.14, outline=color, width=stroke)
    tail_x = x + pad + body_w * 0.24
    draw.polygon([(tail_x, y + pad + body_h - 1), (tail_x, y + pad + body_h + size * 0.16),
                 (tail_x + size * 0.18, y + pad + body_h - 1)], fill=color)

def _og_icon_heart(draw, x, y, size, color):
    lobe_r = size * 0.22
    top = y + size * 0.16
    draw.ellipse([x + size * 0.1, top, x + size * 0.1 + 2 * lobe_r, top + 2 * lobe_r], fill=color)
    draw.ellipse([x + size * 0.9 - 2 * lobe_r, top, x + size * 0.9, top + 2 * lobe_r], fill=color)
    draw.polygon([(x + size * 0.08, top + lobe_r * 0.9), (x + size * 0.5, y + size * 0.92),
                 (x + size * 0.92, top + lobe_r * 0.9)], fill=color)

def _og_icon_people(draw, x, y, size, color):
    stroke = max(2, round(size * 0.09))
    r = size * 0.16
    draw.ellipse([x + size * 0.06, y + size * 0.1, x + size * 0.06 + 2 * r, y + size * 0.1 + 2 * r],
                outline=color, width=stroke)
    draw.arc([x, y + size * 0.4, x + size * 0.52, y + size * 0.98], 195, 345, fill=color, width=stroke)
    draw.ellipse([x + size * 0.46, y + size * 0.1, x + size * 0.46 + 2 * r, y + size * 0.1 + 2 * r],
                outline=color, width=stroke)
    draw.arc([x + size * 0.4, y + size * 0.4, x + size * 0.4 + size * 0.52, y + size * 0.98],
             195, 345, fill=color, width=stroke)

def _og_icon_person(draw, x, y, size, color):
    stroke = max(2, round(size * 0.09))
    r = size * 0.2
    draw.ellipse([x + size * 0.5 - r, y + size * 0.06, x + size * 0.5 + r, y + size * 0.06 + 2 * r],
                outline=color, width=stroke)
    draw.arc([x + size * 0.12, y + size * 0.48, x + size * 0.88, y + size * 1.05], 195, 345,
             fill=color, width=stroke)

def _og_icon_clock(draw, x, y, size, color):
    stroke = max(2, round(size * 0.08))
    draw.ellipse([x + size * 0.08, y + size * 0.08, x + size * 0.92, y + size * 0.92],
                outline=color, width=stroke)
    cx, cy = x + size * 0.5, y + size * 0.5
    draw.line([(cx, cy), (cx, cy - size * 0.26)], fill=color, width=stroke)
    draw.line([(cx, cy), (cx + size * 0.2, cy + size * 0.12)], fill=color, width=stroke)

def _og_icon_pin(draw, x, y, size, color):
    stroke = max(2, round(size * 0.08))
    draw.ellipse([x + size * 0.24, y + size * 0.06, x + size * 0.76, y + size * 0.58],
                outline=color, width=stroke)
    draw.polygon([(x + size * 0.5 - size * 0.11, y + size * 0.5),
                 (x + size * 0.5 + size * 0.11, y + size * 0.5),
                 (x + size * 0.5, y + size * 0.94)], fill=color)

def _og_icon_bolt(draw, x, y, size, color):
    draw.polygon([(x + size * 0.55, y + size * 0.04), (x + size * 0.18, y + size * 0.58),
                 (x + size * 0.44, y + size * 0.58), (x + size * 0.4, y + size * 0.96),
                 (x + size * 0.84, y + size * 0.38), (x + size * 0.56, y + size * 0.38)], fill=color)

_OG_ICONS = {
    "message": _og_icon_message, "heart": _og_icon_heart, "people": _og_icon_people,
    "person": _og_icon_person, "clock": _og_icon_clock, "pin": _og_icon_pin, "bolt": _og_icon_bolt,
}

def _og_icon(draw, name, x, y, size, color):
    icon_fn = _OG_ICONS.get(name)
    if icon_fn:
        icon_fn(draw, x, y, size, color)

def _og_stat_block(draw, x, top, icon_name, value, label, icon_color):
    icon_size = 30
    value_font = _og_font(_FONT_BODY, 30, 700)
    label_font = _og_font(_FONT_BODY, 20, 500)
    value_text = str(value)
    value_width = draw.textlength(value_text, font=value_font)
    label_width = draw.textlength(label, font=label_font)
    block_width = max(icon_size, value_width, label_width)
    _og_icon(draw, icon_name, x + (block_width - icon_size) / 2, top, icon_size, icon_color)
    draw.text((x + (block_width - value_width) / 2, top + icon_size + 10), value_text,
              font=value_font, fill=icon_color)
    draw.text((x + (block_width - label_width) / 2, top + icon_size + 48), label,
              font=label_font, fill=_OG_MUTED)
    return block_width

def _og_stat_row(draw, x, top, stats, icon_color=None, gap=44):
    icon_color = icon_color or _OG_GOLD
    cursor_x = x
    for icon_name, value, label in stats:
        block_width = _og_stat_block(draw, cursor_x, top, icon_name, value, label, icon_color)
        cursor_x += block_width + gap

_OG_BRAND_MARK_CACHE = None

def _og_brand_mark_icon():
    global _OG_BRAND_MARK_CACHE
    if _OG_BRAND_MARK_CACHE is None:
        mark_path = os.path.join(STATIC_DIR, "img", "brand-mark.png")
        icon = Image.open(mark_path).convert("RGBA").resize((32, 32), Image.LANCZOS)
        _OG_BRAND_MARK_CACHE = icon
    return _OG_BRAND_MARK_CACHE

def _og_frosted_pill(canvas, box, radius, tint=(10, 8, 6), tint_alpha=145, blur_radius=18):
    from PIL import ImageDraw, ImageFilter
    x0, y0, x1, y1 = (round(v) for v in box)
    radius = round(radius)
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(canvas.width, x1), min(canvas.height, y1)
    if x1 <= x0 or y1 <= y0:
        return
    region = canvas.crop((x0, y0, x1, y1)).filter(ImageFilter.GaussianBlur(blur_radius))
    tint_layer = Image.new("RGB", region.size, tint)
    blended = Image.blend(region, tint_layer, tint_alpha / 255)
    mask = Image.new("L", region.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, region.width - 1, region.height - 1],
                                           radius=radius, fill=255)
    canvas.paste(blended, (x0, y0), mask)

def _og_brand_mark(canvas, draw):
    mark_x, mark_y, mark_size = 32, 18, 32
    title = "StoryHaven AI"
    tagline = "Forge worlds. Remember everything."
    title_font = _og_font(_FONT_BODY, 20, 700)
    tagline_font = _og_font(_FONT_BODY, 13, 500)
    text_w = max(draw.textlength(title, font=title_font), draw.textlength(tagline, font=tagline_font))
    pad_x, pad_y = 16, 10
    block_h = 42
    pill_box = (mark_x - pad_x, mark_y - pad_y,
               round(mark_x + mark_size + 10 + text_w + pad_x), mark_y + block_h + pad_y)
    _og_frosted_pill(canvas, pill_box, radius=(pill_box[3] - pill_box[1]) // 2)
    icon = _og_brand_mark_icon()
    canvas.paste(icon, (mark_x, mark_y + (block_h - mark_size) // 2), icon)
    text_x = mark_x + mark_size + 10
    draw.text((text_x, mark_y), title, font=title_font, fill=_OG_GOLD)
    draw.text((text_x, mark_y + 24), tagline, font=tagline_font, fill=_OG_MUTED)

def _og_bottom_gradient(width, gradient_h, peak=225, power=1.3):
    column = Image.new("L", (1, gradient_h), 0)
    for i in range(gradient_h):
        column.putpixel((0, i), int(peak * (i / gradient_h) ** power))
    return column.resize((width, gradient_h))

def _og_apply_bottom_gradient(canvas, width, height, gradient_h, tint=(0, 0, 0)):
    mask = _og_bottom_gradient(width, gradient_h)
    canvas.paste(Image.new("RGB", (width, gradient_h), tint), (0, height - gradient_h), mask)

def _og_relative_time(timestamp) -> str:
    if not timestamp:
        return "recently"
    import time as _time
    delta = max(0, _time.time() - timestamp)
    if delta < 60:
        return "Active just now"
    if delta < 3600:
        minutes = round(delta / 60)
        return f"Active {minutes} minute{'s' if minutes != 1 else ''} ago"
    if delta < 86400:
        hours = round(delta / 3600)
        return f"Active {hours} hour{'s' if hours != 1 else ''} ago"
    days = round(delta / 86400)
    return f"Active {days} day{'s' if days != 1 else ''} ago"

async def _og_resolve_model_display_name(checkpoint_name):
    if not checkpoint_name:
        return None
    row = await checkpoints_repo.get_display_name(checkpoint_name)
    return row or checkpoint_name

async def _og_resolve_upscaler_display_name(upscaler_name):
    if not upscaler_name:
        return None
    row = await upscalers_repo.get_display_name(upscaler_name)
    return row or upscaler_name

def _compose_image_card(rel_path, name, avatar_rel, accent_hex, banner_hex,
                        like_count=0, positive_tags=None, negative_tags=None,
                        cfg=None, steps=None, sampler=None, checkpoint=None, upscaler=None,
                        username=None, tag_text=None, created_ts=None):
    from PIL import ImageFilter, ImageDraw
    if not rel_path or not rel_path.startswith("/media/"):
        return None
    fname = rel_path[len("/media/"):].split("?")[0]
    base, _ext = os.path.splitext(fname)
    signature = (f"{fname}|{name}|{avatar_rel}|{accent_hex}|{banner_hex}|{like_count}|{positive_tags}"
                 f"|{negative_tags}|{cfg}|{steps}|{sampler}|{checkpoint}|{upscaler}"
                 f"|{username}|{tag_text}|{created_ts}")
    digest = hashlib.md5(signature.encode()).hexdigest()[:8]
    cache_name = f"{base}_ogcard{digest}v{_OG_IMG_VERSION}.png"
    cache_fs = os.path.join(MEDIA_DIR, cache_name)
    if os.path.exists(cache_fs):
        return f"/media/{cache_name}"
    src_fs = os.path.join(MEDIA_DIR, fname)
    try:
        art = Image.open(src_fs).convert("RGB")
    except Exception as e:
        log.warning("og compose: cannot open art for %s: %s", rel_path, e)
        return None
    width, footer_top, footer_bottom, band = 1200, 510, 630, 150
    art_h = footer_top - band
    tag_font = _og_font(_FONT_BODY, 18, 500)
    column_width = (width - 96 - 24) // 2
    scratch_draw = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    pos_measured = _og_draw_prompt_tag_column(scratch_draw, 48, 0, column_width,
                                              positive_tags, tag_font, _OG_TAG_POSITIVE)
    neg_measured = _og_draw_prompt_tag_column(scratch_draw, 48, 0, column_width,
                                              negative_tags, tag_font, _OG_TAG_NEGATIVE)
    meta_y = footer_bottom + 18 + max(pos_measured, neg_measured) + 6
    bottom_row_cy = meta_y + 16
    height = round(bottom_row_cy + 34)
    canvas = Image.new("RGB", (width, height), _OG_PAPER)
    draw = ImageDraw.Draw(canvas)
    background = _og_cover(art, width, art_h).filter(ImageFilter.GaussianBlur(28))
    background = Image.blend(background, Image.new("RGB", (width, art_h), (0, 0, 0)), 0.45)
    canvas.paste(background, (0, band))
    foreground = _og_contain(art, width - 96, art_h - 48)
    canvas.paste(foreground, ((width - foreground.width) // 2, band + (art_h - foreground.height) // 2))
    _og_creator_footer(canvas, draw, name, avatar_rel, accent_hex, banner_hex, username, tag_text)
    if like_count:
        heart_font = _og_font(_FONT_BODY, 30, 600)
        like_text = str(like_count)
        like_x = width - 48 - draw.textlength(like_text, font=heart_font) - 34
        _og_icon(draw, "heart", like_x, footer_top + 34, 26, _OG_GOLD)
        draw.text((like_x + 34, footer_top + 36), like_text, font=heart_font, fill=_OG_GOLD)
    draw.rectangle([0, footer_bottom, width, height], fill=_OG_PAPER)
    draw.line([(0, footer_bottom), (width, footer_bottom)], fill=_OG_GOLD, width=1)
    positive_bottom = _og_draw_prompt_tag_column(draw, 48, footer_bottom + 18, column_width,
                                                 positive_tags, tag_font, _OG_TAG_POSITIVE)
    negative_bottom = _og_draw_prompt_tag_column(draw, 48 + column_width + 24, footer_bottom + 18,
                                                 column_width, negative_tags, tag_font, _OG_TAG_NEGATIVE)
    meta_y = max(positive_bottom, negative_bottom) + 6
    config_bits = []
    if cfg is not None:
        config_bits.append(f"CFG {cfg}")
    if steps is not None:
        config_bits.append(f"{steps} steps")
    if sampler:
        config_bits.append(sampler)
    if checkpoint:
        config_bits.append(checkpoint)
    if upscaler:
        config_bits.append(upscaler)
    bottom_row_cy = meta_y + 16
    if config_bits:
        draw.text((48, bottom_row_cy), " · ".join(config_bits)[:100],
                  font=_og_font(_FONT_BODY, 20, 500), fill=_OG_MUTED, anchor="lm")
    if created_ts:
        import datetime as _dt
        ts_text = _dt.datetime.fromtimestamp(created_ts).strftime("%b %d, %Y")
        draw.text((width - 48, bottom_row_cy), ts_text,
                  font=_og_font(_FONT_BODY, 18, 500), fill=_OG_MUTED, anchor="rm")
    _og_brand_mark(canvas, draw)
    try:
        canvas.save(cache_fs, "PNG")
    except Exception as e:
        log.warning("og compose: cannot save %s: %s", cache_fs, e)
        return None
    return f"/media/{cache_name}"

def _og_image_url(request: Request, art_rel_path, name=None, avatar_rel=None,
                  accent_hex=None, banner_hex=None, like_count=0, positive_tags=None,
                  negative_tags=None, cfg=None, steps=None, sampler=None, checkpoint=None,
                  upscaler=None, username=None, tag_text=None, created_ts=None) -> str:
    origin = str(request.base_url).rstrip("/")
    composite = _compose_image_card(art_rel_path, name, avatar_rel, accent_hex, banner_hex,
                                    like_count, positive_tags, negative_tags,
                                    cfg, steps, sampler, checkpoint, upscaler,
                                    username, tag_text, created_ts)
    if composite:
        return f"{origin}{composite}"
    return f"{origin}/img/storyhaven-og.png?v={_OG_IMG_VERSION}"

_FONT_DISPLAY = os.path.join(STATIC_DIR, "fonts", "Fraunces.ttf")
_FONT_BODY = os.path.join(STATIC_DIR, "fonts", "Inter.ttf")
_OG_GOLD = (227, 189, 108)
_OG_MUTED = (183, 176, 160)
_OG_PAPER = (12, 12, 14)
_OG_CHAT_BLUE = (108, 178, 227)
_OG_CHAT_BLUE_HEX = "6cb2e3"
_OG_CHAT_BG = (16, 21, 32)

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

def _og_fit_font(draw, text, path, max_size, min_size, weight, max_width):
    size = max_size
    while size > min_size:
        font = _og_font(path, size, weight)
        if draw.textlength(text, font=font) <= max_width:
            return font
        size -= 2
    return _og_font(path, min_size, weight)

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

_OG_TAG_POSITIVE = (127, 201, 143)
_OG_TAG_NEGATIVE = (217, 138, 138)

def _og_draw_prompt_tag_column(draw, x, y, column_width, tags, font, color):
    cx, cy = x, y
    for tag in (tags or [])[:6]:
        label = str(tag)[:16]
        pill_w = draw.textlength(label, font=font) + 20
        if cx + pill_w > x + column_width:
            cx = x
            cy += 32
        draw.rounded_rectangle([cx, cy, cx + pill_w, cy + 26], radius=13, outline=color, width=1)
        draw.text((cx + 10, cy + 4), label, font=font, fill=color)
        cx += pill_w + 8
    return cy + 32

def _compose_character_card(name, avatar_rel, banner_rel, tags, genre, message_count, like_count,
                            creator_name, creator_avatar_rel, creator_accent_hex, creator_banner_hex,
                            cache_key):
    from PIL import ImageDraw
    digest = hashlib.md5(
        f"{cache_key}|{name}|{avatar_rel}|{banner_rel}|{tags}|{genre}|{message_count}|{like_count}"
        f"|{creator_name}|{creator_avatar_rel}|{creator_accent_hex}|{creator_banner_hex}".encode()
    ).hexdigest()[:12]
    cache_name = f"ogchar_{digest}_v{_OG_IMG_VERSION}.png"
    cache_fs = os.path.join(MEDIA_DIR, cache_name)
    if os.path.exists(cache_fs):
        return f"/media/{cache_name}"
    width, height = 1200, 630
    canvas = Image.new("RGB", (width, height), _OG_PAPER)
    has_banner = bool(_og_open_media(banner_rel))
    hero = _og_open_media(banner_rel) if has_banner else _og_open_media(avatar_rel)
    if hero is not None:
        canvas.paste(_og_cover(hero, width, height), (0, 0))
    gradient_h = round(height * 0.62)
    _og_apply_bottom_gradient(canvas, width, height, gradient_h)
    draw = ImageDraw.Draw(canvas)
    _og_brand_mark(canvas, draw)
    bottom_margin = 48
    stats_block_h = 98
    stats_y = height - bottom_margin - stats_block_h
    badge_y = stats_y - 56
    content_bottom = badge_y - 22
    if has_banner:
        avatar_size, avatar_ring = 140, 5
        avatar_x = 48
        avatar_y = content_bottom - avatar_size
        _og_paste_ringed_avatar(canvas, draw, avatar_rel, avatar_x, avatar_y, avatar_size, name,
                               creator_accent_hex, creator_banner_hex, ring=avatar_ring)
        text_x = avatar_x + avatar_size + 28
        name_y = avatar_y + avatar_size / 2 - 32
    else:
        text_x = 48
        name_y = content_bottom - 54
    name_text = name or ""
    name_max_w = width - 48 - text_x
    name_font = _og_fit_font(draw, name_text, _FONT_DISPLAY, 44, 22, 600, name_max_w)
    draw.text((text_x, name_y), name_text, font=name_font, fill=(255, 255, 255))
    badge_x = 48
    if genre:
        genre_font = _og_font(_FONT_BODY, 22, 600)
        pill_w = draw.textlength(genre, font=genre_font) + 26
        draw.rounded_rectangle([badge_x, badge_y, badge_x + pill_w, badge_y + 36], radius=18, fill=_OG_GOLD)
        draw.text((badge_x + 13, badge_y + 6), genre, font=genre_font, fill=_OG_PAPER)
        badge_x += pill_w + 12
    if tags:
        _og_draw_tags(draw, badge_x, badge_y, tags, _og_font(_FONT_BODY, 22, 500))
    _og_stat_row(draw, 48, stats_y,
                [("message", message_count, "Messages"), ("heart", like_count, "Likes")],
                icon_color=(255, 255, 255))
    if creator_name:
        creator_size = 40
        creator_font = _og_font(_FONT_BODY, 20, 500)
        creator_text = f"Created by {creator_name}"[:42]
        creator_text_w = draw.textlength(creator_text, font=creator_font)
        pad_x, pad_y, gap = 16, 10, 12
        row_w = creator_size + gap + creator_text_w
        row_y0 = (height - bottom_margin) - pad_y - creator_size
        row_x1 = width - 48
        row_x0 = row_x1 - row_w
        pill_box = (row_x0 - pad_x, row_y0 - pad_y, row_x1 + pad_x, row_y0 + creator_size + pad_y)
        _og_frosted_pill(canvas, pill_box, radius=(pill_box[3] - pill_box[1]) // 2)
        _og_paste_ringed_avatar(canvas, draw, creator_avatar_rel, round(row_x0), round(row_y0), creator_size,
                               creator_name, creator_accent_hex, creator_banner_hex, ring=2)
        draw.text((row_x0 + creator_size + gap, row_y0 + creator_size / 2 - 12), creator_text,
                  font=creator_font, fill=_OG_MUTED)
    try:
        canvas.save(cache_fs, "PNG")
    except Exception as e:
        log.warning("og character card save failed: %s", e)
        return None
    return f"/media/{cache_name}"

def _og_character_url(request: Request, name, avatar_rel, banner_rel, tags, genre,
                      message_count, like_count, creator_name, creator_avatar_rel,
                      creator_accent_hex, creator_banner_hex, cache_key) -> str:
    origin = str(request.base_url).rstrip("/")
    card = _compose_character_card(name, avatar_rel, banner_rel, tags, genre, message_count, like_count,
                                   creator_name, creator_avatar_rel, creator_accent_hex,
                                   creator_banner_hex, cache_key)
    if card:
        return f"{origin}{card}"
    return f"{origin}/img/storyhaven-og.png?v={_OG_IMG_VERSION}"

def _og_paste_ringed_avatar(canvas, draw, avatar_rel, x, y, size, name, accent_hex=None, banner_hex=None, ring=6):
    from PIL import ImageDraw
    x, y, size, ring = round(x), round(y), round(size), round(ring)
    accent_rgb = _og_hex_rgb(accent_hex, _OG_GOLD)
    banner_rgb = _og_hex_rgb(banner_hex, accent_rgb)
    outer = size + ring * 2
    ring_gradient = _og_diagonal_gradient(outer, accent_rgb, banner_rgb)
    ring_mask = Image.new("L", (outer, outer), 0)
    ImageDraw.Draw(ring_mask).ellipse([0, 0, outer - 1, outer - 1], fill=255)
    canvas.paste(ring_gradient, (x - ring, y - ring), ring_mask)
    avatar_mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(avatar_mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    avatar_img = _og_open_media(avatar_rel)
    if avatar_img is not None:
        fitted = _og_contain(avatar_img, size, size)
        tile = Image.new("RGB", (size, size), accent_rgb)
        tile.paste(fitted, ((size - fitted.width) // 2, (size - fitted.height) // 2))
        canvas.paste(tile, (x, y), avatar_mask)
    else:
        canvas.paste(Image.new("RGB", (size, size), accent_rgb), (x, y), avatar_mask)
        initial = (name or "?")[0].upper()
        initial_font = _og_font(_FONT_DISPLAY, round(size * 0.44), 600)
        initial_w = draw.textlength(initial, font=initial_font)
        draw.text((x + size / 2 - initial_w / 2, y + size / 2 - round(size * 0.28)),
                  initial, font=initial_font, fill=_OG_PAPER)

def _compose_profile_card(name, avatar_rel, banner_rel, characters_count, followers_count,
                          cache_key, accent_hex=None, banner_hex=None, username=None, tag_text=None,
                          joined_ts=None):
    from PIL import ImageDraw
    digest = hashlib.md5(
        f"{cache_key}|{name}|{avatar_rel}|{banner_rel}|{characters_count}|{followers_count}"
        f"|{accent_hex}|{banner_hex}|{username}|{tag_text}|{joined_ts}".encode()
    ).hexdigest()[:12]
    cache_name = f"ogp_{digest}_v{_OG_IMG_VERSION}.png"
    cache_fs = os.path.join(MEDIA_DIR, cache_name)
    if os.path.exists(cache_fs):
        return f"/media/{cache_name}"
    width, height, avatar_size, overlap = 1200, 630, 160, 70
    bottom_margin = 48
    stats_block_h = 98
    handle_row_h = 44 if (username or tag_text) else 0
    stats_y = height - bottom_margin - stats_block_h
    avatar_y = stats_y - overlap - 104 - handle_row_h
    name_y = avatar_y + overlap + 30
    handle_y = name_y + 58
    banner_h = avatar_y + overlap
    avatar_ring = 6
    wrapper_h = avatar_y + avatar_size + avatar_ring + 4
    wrapper = Image.new("RGB", (width, wrapper_h), _OG_PAPER)
    accent_rgb = _og_hex_rgb(accent_hex, _OG_GOLD)
    banner_rgb = _og_hex_rgb(banner_hex, accent_rgb)
    banner_src = _og_open_media(banner_rel)
    if banner_src is not None:
        wrapper.paste(_og_cover(banner_src, width, banner_h), (0, 0))
    else:
        wrapper.paste(_og_diagonal_gradient(max(width, banner_h), accent_rgb, banner_rgb)
                     .resize((width, banner_h)), (0, 0))
    wrapper_draw = ImageDraw.Draw(wrapper)
    avatar_x = 48
    _og_paste_ringed_avatar(wrapper, wrapper_draw, avatar_rel, avatar_x, avatar_y, avatar_size,
                           name, accent_hex, banner_hex)
    canvas = Image.new("RGB", (width, height), _OG_PAPER)
    canvas.paste(wrapper, (0, 0))
    draw = ImageDraw.Draw(canvas)
    _og_brand_mark(canvas, draw)
    text_x = avatar_x + avatar_size + 34
    name_text = name or ""
    name_max_w = width - 48 - text_x
    name_font = _og_fit_font(draw, name_text, _FONT_DISPLAY, 50, 26, 600, name_max_w)
    draw.text((text_x, name_y), name_text, font=name_font, fill=_OG_GOLD)
    if username or tag_text:
        handle_font = _og_font(_FONT_BODY, 22, 500)
        row_cy = handle_y + 15
        cx = text_x
        if username:
            handle_text = f"@{username}"
            draw.text((cx, row_cy), handle_text, font=handle_font, fill=_OG_MUTED, anchor="lm")
            cx += draw.textlength(handle_text, font=handle_font) + 16
        if tag_text:
            tag_font = _og_font(_FONT_BODY, 16, 600)
            pill_h = 28
            pill_w = draw.textlength(tag_text, font=tag_font) + 24
            draw.rounded_rectangle([cx, row_cy - pill_h / 2, cx + pill_w, row_cy + pill_h / 2],
                                   radius=pill_h / 2, fill=_OG_GOLD)
            draw.text((cx + 12, row_cy), tag_text, font=tag_font, fill=_OG_PAPER, anchor="lm")
    stat_items = [("person", characters_count, "Characters"), ("people", followers_count, "Followers")]
    if joined_ts:
        import datetime as _dt
        joined_text = _dt.datetime.fromtimestamp(joined_ts).strftime("%b %Y")
        stat_items.append(("clock", joined_text, "Joined"))
    _og_stat_row(draw, text_x, stats_y, stat_items)
    try:
        canvas.save(cache_fs, "PNG")
    except Exception as e:
        log.warning("og profile card save failed: %s", e)
        return None
    return f"/media/{cache_name}"

def _og_profile_url(request: Request, name, avatar_rel, banner_rel, characters_count,
                    followers_count, cache_key, accent_hex=None, banner_hex=None,
                    username=None, tag_text=None, joined_ts=None) -> str:
    origin = str(request.base_url).rstrip("/")
    card = _compose_profile_card(name, avatar_rel, banner_rel, characters_count,
                                 followers_count, cache_key, accent_hex, banner_hex,
                                 username, tag_text, joined_ts)
    if card:
        return f"{origin}{card}"
    return f"{origin}/img/storyhaven-og.png?v={_OG_IMG_VERSION}"

def _og_split_cast_background(canvas, width, height, cast, tint=(0, 0, 0)):
    members = cast[:2]
    if len(members) == 2:
        half = width // 2
        left = _og_open_media(members[0].get("avatar"))
        right = _og_open_media(members[1].get("avatar"))
        if left is not None:
            canvas.paste(_og_cover(left, half, height), (0, 0))
        if right is not None:
            canvas.paste(_og_cover(right, width - half, height), (half, 0))
    elif len(members) == 1:
        source = _og_open_media(members[0].get("avatar"))
        if source is not None:
            canvas.paste(_og_cover(source, width, height), (0, 0))
    return Image.blend(canvas, Image.new("RGB", (width, height), tint), 0.35)

def _og_avatar_tile_row(canvas, draw, cast, cy, accent_rgb, bg_rgb):
    from PIL import ImageDraw as _ImageDraw
    width = canvas.width
    shown = cast[:5]
    overflow = len(cast) - len(shown)
    size, gap, radius = 170, 26, 28
    slot_count = len(shown) + (1 if overflow > 0 else 0)
    if slot_count == 0:
        return
    total_w = size * slot_count + gap * (slot_count - 1)
    start_x = (width - total_w) // 2
    y = cy - size // 2
    for i, member in enumerate(shown):
        x = start_x + i * (size + gap)
        mask = Image.new("L", (size, size), 0)
        _ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
        avatar = _og_open_media(member.get("avatar"))
        if avatar is not None:
            canvas.paste(_og_cover(avatar, size, size), (x, y), mask)
        else:
            canvas.paste(Image.new("RGB", (size, size), accent_rgb), (x, y), mask)
            initial = (member.get("name") or "?")[0].upper()
            initial_font = _og_font(_FONT_DISPLAY, round(size * 0.4), 600)
            initial_w = draw.textlength(initial, font=initial_font)
            draw.text((x + size / 2 - initial_w / 2, y + size / 2 - size * 0.26),
                      initial, font=initial_font, fill=bg_rgb)
        draw.rounded_rectangle([x, y, x + size - 1, y + size - 1], radius=radius, outline=accent_rgb, width=3)
    if overflow > 0:
        x = start_x + len(shown) * (size + gap)
        mask = Image.new("L", (size, size), 0)
        _ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
        canvas.paste(Image.new("RGB", (size, size), bg_rgb), (x, y), mask)
        draw.rounded_rectangle([x, y, x + size - 1, y + size - 1], radius=radius, outline=accent_rgb, width=3)
        overflow_font = _og_font(_FONT_DISPLAY, round(size * 0.36), 600)
        draw.text((x + size / 2, y + size / 2), f"+{overflow}", font=overflow_font,
                  fill=accent_rgb, anchor="mm")

def _compose_group_card(group_name, cast, character_count, like_count, creator_name, genre, cache_key,
                        group_mode="roleplay", creator_avatar_rel=None, creator_accent_hex=None,
                        creator_banner_hex=None, creator_username=None, creator_tag_text=None):
    from PIL import ImageDraw
    signature = "|".join(f"{c.get('name') or ''}:{c.get('avatar') or ''}" for c in cast)
    digest = hashlib.md5(
        f"{cache_key}|{group_name}|{signature}|{character_count}|{like_count}|{creator_name}"
        f"|{genre}|{group_mode}|{creator_avatar_rel}|{creator_accent_hex}|{creator_banner_hex}"
        f"|{creator_username}|{creator_tag_text}".encode()
    ).hexdigest()[:12]
    cache_name = f"ogg_{digest}_v{_OG_IMG_VERSION}.png"
    cache_fs = os.path.join(MEDIA_DIR, cache_name)
    if os.path.exists(cache_fs):
        return f"/media/{cache_name}"
    width, height = 1200, 630
    is_chat = group_mode == "chat"
    accent_rgb = _OG_CHAT_BLUE if is_chat else _OG_GOLD
    gradient_h = 340
    canvas = Image.new("RGB", (width, height), _OG_CHAT_BG if is_chat else _OG_PAPER)
    if not is_chat:
        canvas = _og_split_cast_background(canvas, width, height, cast)
        _og_apply_bottom_gradient(canvas, width, height, gradient_h)
    draw = ImageDraw.Draw(canvas)
    if is_chat:
        _og_avatar_tile_row(canvas, draw, cast, height - gradient_h - 6, accent_rgb, _OG_CHAT_BG)
    _og_brand_mark(canvas, draw)
    mode_label = "Chat" if is_chat else "Roleplay"
    mode_font = _og_font(_FONT_BODY, 22, 600)
    mode_pill_w = draw.textlength(mode_label, font=mode_font) + 26
    mode_x1 = width - 48
    mode_x0 = mode_x1 - mode_pill_w
    draw.rounded_rectangle([mode_x0, 32, mode_x1, 68], radius=18, fill=accent_rgb)
    draw.text((mode_x0 + 13, 38), mode_label, font=mode_font, fill=_OG_PAPER)
    badge_x, badge_y = 48, 88
    if genre:
        genre_font = _og_font(_FONT_BODY, 22, 600)
        pill_w = draw.textlength(genre, font=genre_font) + 26
        draw.rounded_rectangle([badge_x, badge_y, badge_x + pill_w, badge_y + 36], radius=18,
                               outline=accent_rgb, width=2)
        draw.text((badge_x + 13, badge_y + 6), genre, font=genre_font, fill=accent_rgb)
    bottom_margin = 48
    stats_block_h = 98
    stats_y = height - bottom_margin - stats_block_h
    name_y = stats_y - 78
    name_max_w = width - 96
    name_text = (group_name or "")
    name_font = _og_fit_font(draw, name_text, _FONT_DISPLAY, 50, 30, 600, name_max_w)
    draw.text((48, name_y), name_text, font=name_font, fill=(255, 255, 255))
    character_icon = "message" if is_chat else "people"
    _og_stat_row(draw, 48, stats_y,
                [(character_icon, character_count, "Characters"), ("heart", like_count, "Likes")],
                icon_color=accent_rgb if is_chat else (255, 255, 255))
    if creator_name:
        creator_size = 52
        name_font = _og_font(_FONT_BODY, 20, 600)
        handle_font = _og_font(_FONT_BODY, 15, 500)
        tag_font = _og_font(_FONT_BODY, 13, 600)
        handle_text = f"@{creator_username}" if creator_username else ""
        name_w = draw.textlength(creator_name, font=name_font)
        handle_w = draw.textlength(handle_text, font=handle_font) if handle_text else 0
        tag_pad = 18
        tag_w = (draw.textlength(creator_tag_text, font=tag_font) + tag_pad) if creator_tag_text else 0
        line2_gap = 10 if (handle_text and creator_tag_text) else 0
        line2_w = handle_w + line2_gap + tag_w
        text_w = max(name_w, line2_w)
        pad_x, pad_y, gap = 16, 10, 12
        row_w = creator_size + gap + text_w
        row_x1 = width - 48
        row_x0 = row_x1 - row_w
        row_y0 = (height - bottom_margin) - pad_y - creator_size
        pill_box = (row_x0 - pad_x, row_y0 - pad_y, row_x1 + pad_x, row_y0 + creator_size + pad_y)
        _og_frosted_pill(canvas, pill_box, radius=(pill_box[3] - pill_box[1]) // 2)
        _og_paste_ringed_avatar(canvas, draw, creator_avatar_rel, round(row_x0), round(row_y0), creator_size,
                               creator_name, creator_accent_hex, creator_banner_hex, ring=2)
        text_x = row_x0 + creator_size + gap
        draw.text((text_x, row_y0 + 2), creator_name, font=name_font, fill=accent_rgb)
        cx, line2_cy = text_x, row_y0 + creator_size - 16
        if handle_text:
            draw.text((cx, line2_cy), handle_text, font=handle_font, fill=_OG_MUTED, anchor="lm")
            cx += handle_w + line2_gap
        if creator_tag_text:
            tag_h = 22
            draw.rounded_rectangle([cx, line2_cy - tag_h / 2, cx + tag_w, line2_cy + tag_h / 2],
                                   radius=tag_h / 2, fill=accent_rgb)
            draw.text((cx + tag_pad / 2, line2_cy), creator_tag_text, font=tag_font, fill=_OG_PAPER, anchor="lm")
    try:
        canvas.save(cache_fs, "PNG")
    except Exception as e:
        log.warning("og group card save failed: %s", e)
        return None
    return f"/media/{cache_name}"

def _og_group_url(request: Request, group_name, cast, character_count, like_count,
                  creator_name, genre, cache_key, group_mode="roleplay", creator_avatar_rel=None,
                  creator_accent_hex=None, creator_banner_hex=None, creator_username=None,
                  creator_tag_text=None) -> str:
    origin = str(request.base_url).rstrip("/")
    card = _compose_group_card(group_name, cast, character_count, like_count,
                               creator_name, genre, cache_key, group_mode,
                               creator_avatar_rel, creator_accent_hex, creator_banner_hex,
                               creator_username, creator_tag_text)
    if card:
        return f"{origin}{card}"
    return f"{origin}/img/storyhaven-og.png?v={_OG_IMG_VERSION}"

def _compose_shared_chat_card(title, cast, player_count, message_count, last_active_ts,
                              location_text, cache_key, creator_name=None, creator_avatar_rel=None,
                              creator_accent_hex=None, creator_banner_hex=None, creator_username=None,
                              creator_tag_text=None):
    from PIL import ImageDraw
    signature = "|".join(f"{c.get('name') or ''}:{c.get('avatar') or ''}" for c in cast)
    digest = hashlib.md5(
        f"{cache_key}|{title}|{signature}|{player_count}|{message_count}|{last_active_ts}|{location_text}"
        f"|{creator_name}|{creator_avatar_rel}|{creator_accent_hex}|{creator_banner_hex}"
        f"|{creator_username}|{creator_tag_text}".encode()
    ).hexdigest()[:12]
    cache_name = f"ogchat_{digest}_v{_OG_IMG_VERSION}.png"
    cache_fs = os.path.join(MEDIA_DIR, cache_name)
    if os.path.exists(cache_fs):
        return f"/media/{cache_name}"
    width, height = 1200, 630
    canvas = Image.new("RGB", (width, height), _OG_PAPER)
    canvas = _og_split_cast_background(canvas, width, height, cast)
    gradient_h = 340
    _og_apply_bottom_gradient(canvas, width, height, gradient_h)
    draw = ImageDraw.Draw(canvas)
    _og_brand_mark(canvas, draw)
    live_font = _og_font(_FONT_BODY, 22, 700)
    live_label = "ACTIVE NOW"
    live_w = draw.textlength(live_label, font=live_font) + 44
    live_x = width - 48 - live_w
    draw.rounded_rectangle([live_x, 32, live_x + live_w, 68], radius=18, fill=(46, 196, 113))
    _og_icon(draw, "bolt", live_x + 12, 38, 22, (255, 255, 255))
    draw.text((live_x + 40, 40), live_label, font=live_font, fill=(255, 255, 255))
    bottom_margin = 48
    stats_block_h = 98
    stats_y = height - bottom_margin - stats_block_h
    scene_y = stats_y - 30 - (34 if location_text else 0)
    name_y = scene_y - 62
    name_max_w = width - 96
    name_text = (title or "")
    name_font = _og_fit_font(draw, name_text, _FONT_DISPLAY, 50, 30, 600, name_max_w)
    draw.text((48, name_y), name_text, font=name_font, fill=(255, 255, 255))
    if location_text:
        location_font = _og_font(_FONT_BODY, 24, 500)
        _og_icon(draw, "pin", 48, scene_y, 22, _OG_MUTED)
        draw.text((48 + 30, scene_y + 2), location_text[:60], font=location_font, fill=_OG_MUTED)
    _og_stat_row(draw, 48, stats_y,
                [("people", player_count, "Players"), ("message", message_count, "Messages"),
                 ("clock", _og_relative_time(last_active_ts).replace("Active ", "").capitalize(), "Last active")],
                icon_color=(255, 255, 255))
    if creator_name:
        creator_size = 52
        name_font = _og_font(_FONT_BODY, 20, 600)
        handle_font = _og_font(_FONT_BODY, 15, 500)
        tag_font = _og_font(_FONT_BODY, 13, 600)
        handle_text = f"@{creator_username}" if creator_username else ""
        name_w = draw.textlength(creator_name, font=name_font)
        handle_w = draw.textlength(handle_text, font=handle_font) if handle_text else 0
        tag_pad = 18
        tag_w = (draw.textlength(creator_tag_text, font=tag_font) + tag_pad) if creator_tag_text else 0
        line2_gap = 10 if (handle_text and creator_tag_text) else 0
        line2_w = handle_w + line2_gap + tag_w
        text_w = max(name_w, line2_w)
        pad_x, pad_y, gap = 16, 10, 12
        row_w = creator_size + gap + text_w
        row_x1 = width - 48
        row_x0 = row_x1 - row_w
        row_y0 = (height - bottom_margin) - pad_y - creator_size
        pill_box = (row_x0 - pad_x, row_y0 - pad_y, row_x1 + pad_x, row_y0 + creator_size + pad_y)
        _og_frosted_pill(canvas, pill_box, radius=(pill_box[3] - pill_box[1]) // 2)
        _og_paste_ringed_avatar(canvas, draw, creator_avatar_rel, round(row_x0), round(row_y0), creator_size,
                               creator_name, creator_accent_hex, creator_banner_hex, ring=2)
        text_x = row_x0 + creator_size + gap
        draw.text((text_x, row_y0 + 2), creator_name, font=name_font, fill=_OG_GOLD)
        cx, line2_cy = text_x, row_y0 + creator_size - 16
        if handle_text:
            draw.text((cx, line2_cy), handle_text, font=handle_font, fill=_OG_MUTED, anchor="lm")
            cx += handle_w + line2_gap
        if creator_tag_text:
            tag_h = 22
            draw.rounded_rectangle([cx, line2_cy - tag_h / 2, cx + tag_w, line2_cy + tag_h / 2],
                                   radius=tag_h / 2, fill=_OG_GOLD)
            draw.text((cx + tag_pad / 2, line2_cy), creator_tag_text, font=tag_font, fill=_OG_PAPER, anchor="lm")
    try:
        canvas.save(cache_fs, "PNG")
    except Exception as e:
        log.warning("og shared-chat card save failed: %s", e)
        return None
    return f"/media/{cache_name}"

def _og_shared_chat_url(request: Request, title, cast, player_count, message_count,
                        last_active_ts, location_text, cache_key, creator_name=None,
                        creator_avatar_rel=None, creator_accent_hex=None, creator_banner_hex=None,
                        creator_username=None, creator_tag_text=None) -> str:
    origin = str(request.base_url).rstrip("/")
    card = _compose_shared_chat_card(title, cast, player_count, message_count,
                                     last_active_ts, location_text, cache_key, creator_name,
                                     creator_avatar_rel, creator_accent_hex, creator_banner_hex,
                                     creator_username, creator_tag_text)
    if card:
        return f"{origin}{card}"
    return f"{origin}/img/storyhaven-og.png?v={_OG_IMG_VERSION}"

def _compose_docs_card():
    from PIL import ImageDraw
    cache_name = f"ogdocs_v{_OG_IMG_VERSION}.png"
    cache_fs = os.path.join(MEDIA_DIR, cache_name)
    if os.path.exists(cache_fs):
        return f"/media/{cache_name}"
    width, height = 1200, 630
    canvas = Image.new("RGB", (width, height), _OG_PAPER)
    draw = ImageDraw.Draw(canvas)
    _og_brand_mark(canvas, draw)
    draw.text((48, 130), "How StoryHaven Works", font=_og_font(_FONT_DISPLAY, 54, 600), fill=_OG_GOLD)
    desc = ("The whole architecture in plain English. How it remembers your stories, pulls in "
            "your world, and runs group chats. Sign in to read the full documentation.")
    desc_font = _og_font(_FONT_BODY, 28, 400)
    desc_lines = _og_wrap(draw, desc, desc_font, width - 96, 3)
    for i, line in enumerate(desc_lines):
        draw.text((48, 220 + i * 38), line, font=desc_font, fill=_OG_MUTED)
    pill_font = _og_font(_FONT_BODY, 24, 600)
    px, py = 48, 220 + len(desc_lines) * 38 + 24
    for label in ("Memory", "Lore", "Group Chats", "Live API", "6 Diagrams"):
        pill_w = draw.textlength(label, font=pill_font) + 32
        if px + pill_w > width - 48:
            px, py = 48, py + 54
        draw.rounded_rectangle([px, py, px + pill_w, py + 42], radius=21, outline=_OG_GOLD, width=2)
        draw.text((px + 16, py + 8), label, font=pill_font, fill=_OG_GOLD)
        px += pill_w + 14
    cta = "Sign in to read the full documentation"
    cta_font = _og_font(_FONT_BODY, 24, 600)
    cta_w = draw.textlength(cta, font=cta_font) + 48
    draw.rounded_rectangle([48, height - 90, 48 + cta_w, height - 42], radius=24, outline=_OG_MUTED, width=2)
    draw.text((48 + 24, height - 78), cta, font=cta_font, fill=_OG_MUTED)
    try:
        canvas.save(cache_fs, "PNG")
    except Exception as e:
        log.warning("og docs card save failed: %s", e)
        return None
    return f"/media/{cache_name}"

def _og_docs_url(request: Request) -> str:
    origin = str(request.base_url).rstrip("/")
    card = _compose_docs_card()
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

_OG_IMG_VERSION = "34"

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
        message_count = await chat_sessions_repo.message_count_for_char(cid)
        like_count = await content_likes_repo.like_count("character", cid)
        owner = await user_repo.get_user_by_id(c.get("owner_id")) if c.get("owner_id") else None
        creator_name = (owner or {}).get("display_name") or (owner or {}).get("username")
        img = _og_character_url(request, c.get("name") or brand_name,
                                c.get("avatar"), (c.get("assets") or {}).get("banner"),
                                c.get("tags"), c.get("genre"), message_count, like_count,
                                creator_name, (owner or {}).get("avatar"),
                                (owner or {}).get("accent_color"), (owner or {}).get("banner_color"),
                                f"c{cid}")
    else:
        title = brand_name
        desc = brand_tagline
        img = f"{str(request.base_url).rstrip('/')}/img/storyhaven-og.png?v={_OG_IMG_VERSION}"
    canonical = f"{str(request.base_url).rstrip('/')}/c/{cid}"
    return _share_shell(title, desc, img, "website", canonical)

@app.get("/g/{gid}")
async def group_share_card(gid: str, request: Request):
    g = await groups_repo.get(gid)
    brand_name = "StoryHaven AI"
    brand_tagline = "Forge worlds. Remember everything."
    origin = str(request.base_url).rstrip("/")
    canonical = f"{origin}/g/{gid}"
    if g and g.get("is_public"):
        cast = []
        for row in await groups_repo.list_cast(gid):
            member = await db.get_character(row["char_id"])
            if member:
                cast.append(member)
        if cast and all(member.get("is_public") for member in cast):
            title = g.get("name") or brand_name
            names = _og_join_names(member.get("name") or "?" for member in cast[:4])
            if (g.get("group_mode") or "roleplay") == "chat":
                desc = _og_excerpt(f"Join the chat with {names}.") or brand_tagline
            else:
                desc = _og_excerpt(g.get("opening") or f"A character group with {names}.") or brand_tagline
            like_count = await content_likes_repo.like_count("group", gid)
            creator = await user_repo.get_user_by_id(g.get("owner_id")) if g.get("owner_id") else None
            creator_name = (creator or {}).get("display_name") or (creator or {}).get("username")
            if creator and creator.get("title_status") == "approved" and creator.get("title"):
                creator_tag_text = creator.get("title")
            elif creator and creator.get("is_admin"):
                creator_tag_text = "Dev" if creator.get("role") == "dev" else "Admin"
            else:
                creator_tag_text = None
            img = _og_group_url(request, g.get("name") or brand_name, cast, len(cast),
                                like_count, creator_name, g.get("genre"), f"g{gid}",
                                g.get("group_mode") or "roleplay", (creator or {}).get("avatar"),
                                (creator or {}).get("accent_color"), (creator or {}).get("banner_color"),
                                (creator or {}).get("username"), creator_tag_text)
            return _share_shell(title, desc, img, "website", canonical)
    fallback = f"{origin}/img/storyhaven-og.png?v={_OG_IMG_VERSION}"
    return _share_shell(brand_name, brand_tagline, fallback, "website", canonical)

@app.get("/chats/{sid}")
async def chat_share_card(sid: str, request: Request):
    origin = str(request.base_url).rstrip("/")
    brand_name = "StoryHaven AI"
    brand_tagline = "Forge worlds. Remember everything."
    token = request.query_params.get("token")
    if token:
        invite = await session_invites.resolve(token)
        if invite and invite.get("session_id") == sid:
            session = await chat_sessions_repo.get(sid)
            if session:
                cast = []
                for row in await session_char_repo.list_cast(sid):
                    member = await db.get_character(row["char_id"])
                    if member:
                        cast.append(member)
                if not cast and session.get("char_id"):
                    member = await db.get_character(session["char_id"])
                    if member:
                        cast.append(member)
                if cast and all(member.get("is_public") for member in cast):
                    players = len(await session_participants.list_for_session(sid))
                    title = session.get("title") or brand_name
                    names = _og_join_names(member.get("name") or "?" for member in cast[:4])
                    desc = _og_excerpt(f"Join the chat with {names}.") or brand_tagline
                    message_count = len(session.get("messages") or [])
                    creator = (await user_repo.get_user_by_id(session.get("user_id"))
                              if session.get("user_id") else None)
                    creator_name = (creator or {}).get("display_name") or (creator or {}).get("username")
                    if creator and creator.get("title_status") == "approved" and creator.get("title"):
                        creator_tag_text = creator.get("title")
                    elif creator and creator.get("is_admin"):
                        creator_tag_text = "Dev" if creator.get("role") == "dev" else "Admin"
                    else:
                        creator_tag_text = None
                    img = _og_shared_chat_url(request, title, cast, players, message_count,
                                              session.get("updated"), session.get("char_location"),
                                              f"chat{sid}", creator_name, (creator or {}).get("avatar"),
                                              (creator or {}).get("accent_color"),
                                              (creator or {}).get("banner_color"),
                                              (creator or {}).get("username"), creator_tag_text)
                    return _share_shell(title, desc, img, "website", f"{origin}/chats/{sid}?token={token}")
    generic = f"{origin}/img/storyhaven-og.png?v={_OG_IMG_VERSION}"
    return _share_shell(brand_name, brand_tagline, generic, "website", f"{origin}/chats/{sid}")

@app.get("/u/{username}")
async def user_share_card(username: str, request: Request):
    u = await user_repo.get_user_by_username(username)
    brand_name = "StoryHaven AI"
    brand_tagline = "Forge worlds. Remember everything."
    if u and u.get("status") == "active":
        title = db._decrypt_secret(u.get("display_name") or "") or u.get("username") or brand_name
        desc = _og_excerpt(db._decrypt_secret(u.get("bio") or "")) or brand_tagline
        characters_count = await characters_repo.public_character_count(u.get("id"))
        followers_count = await follows_repo.follower_count(u.get("id"))
        if u.get("title_status") == "approved" and u.get("title"):
            tag_text = u.get("title")
        elif u.get("is_admin"):
            tag_text = "Dev" if u.get("role") == "dev" else "Admin"
        else:
            tag_text = None
        img = _og_profile_url(request, title, u.get("avatar"), u.get("banner_img"),
                              characters_count, followers_count, f"u{username}",
                              u.get("accent_color"), u.get("banner_color"),
                              u.get("username"), tag_text, u.get("created"))
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
    like_count = 0
    positive_tags, negative_tags = None, None
    cfg, steps, sampler, checkpoint, upscaler = None, None, None, None, None
    if art_rel:
        creator = await user_repo.get_user_by_id(rec.get("user_id"))
        name = (creator or {}).get("display_name") or (creator or {}).get("username") or "a StoryHaven creator"
        title = f"View this image on {brand_name}"
        desc = f"By {name}"
        like_count = await content_likes_repo.like_count("image", iid)
        positive_tags = [tag.strip() for tag in (rec.get("positive") or "").split(",") if tag.strip()]
        negative_tags = [tag.strip() for tag in (rec.get("negative") or "").split(",") if tag.strip()]
        cfg, steps, sampler = rec.get("cfg"), rec.get("steps"), rec.get("sampler")
        checkpoint = await _og_resolve_model_display_name(rec.get("checkpoint"))
        upscaler = await _og_resolve_upscaler_display_name(rec.get("upscaler"))
    else:
        name = brand_name
        title = brand_name
        desc = brand_tagline
    if creator and creator.get("title_status") == "approved" and creator.get("title"):
        tag_text = creator.get("title")
    elif creator and creator.get("is_admin"):
        tag_text = "Dev" if creator.get("role") == "dev" else "Admin"
    else:
        tag_text = None
    img = _og_image_url(request, art_rel, name if art_rel else None,
                        (creator or {}).get("avatar"), (creator or {}).get("accent_color"),
                        (creator or {}).get("banner_color"), like_count, positive_tags,
                        negative_tags, cfg, steps, sampler, checkpoint, upscaler,
                        (creator or {}).get("username"), tag_text, rec.get("created") if art_rel else None)
    canonical = f"{str(request.base_url).rstrip('/')}/i/{iid}"
    return _share_shell(title, desc, img, "website", canonical)

@app.get("/settings-docs")
async def docs_share_card(request: Request):
    origin = str(request.base_url).rstrip("/")
    title = "How StoryHaven Works"
    desc = ("The whole architecture in plain English. How it remembers your stories, "
            "pulls in your world, and runs group chats. Sign in to read the full documentation.")
    img = _og_docs_url(request)
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
