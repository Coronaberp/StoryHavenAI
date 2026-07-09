"""Shared application state: config, logging, and the router objects that every
route module decorates. Imported one-way by all other modules — never imports them."""
import os
import json
import time
import logging
import asyncio
import collections

from backend import llm
from fastapi import APIRouter

PROCESS_START_TIME = time.time()
APP_VERSION = "1.1.0"

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger("personae")
log.setLevel(logging.INFO)



def _sanitize_exc(e: Exception, *secrets: str | None) -> str:
    """Stringifies an exception for logging with any known-sensitive values
    (a user's bring-your-own base_url/api_key, which httpx errors often embed
    verbatim, e.g. "Connection refused: http://host:port/v1/...") replaced by
    a placeholder — keeps the actually-useful diagnostic detail (status code,
    timeout, connection-refused, JSON-decode error, etc.) that an admin needs
    to root-cause a failed generation, without leaking a user's private
    endpoint into the server logs."""
    msg = f"{type(e).__name__}: {e}"
    for s in secrets:
        if s:
            msg = msg.replace(s, "[redacted]")
    return msg


class _RingBufferHandler(logging.Handler):
    """In-memory tail of the app's own log events, backed by a JSONL file so the
    admin Logs panel survives server restarts (the buffer used to be memory-only,
    which meant every restart wiped it). Same privacy rule as before: only what
    the app explicitly logs — never raw request lines, chat content, or keys."""
    PERSIST = os.environ.get("LOG_BUFFER_PATH", "./personae.logs.jsonl")

    def __init__(self, capacity=2000):
        super().__init__()
        self.buffer = collections.deque(maxlen=capacity)
        try:  # reload the tail from the previous run(s)
            with open(self.PERSIST, encoding="utf-8") as f:
                for line in f.readlines()[-capacity:]:
                    try:
                        self.buffer.append(json.loads(line))
                    except ValueError:
                        pass
        except OSError:
            pass

    def emit(self, record):
        entry = {
            "ts": record.created,
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        self.buffer.append(entry)
        line = json.dumps(entry, ensure_ascii=False) + "\n"
        # emit() is called synchronously by the logging framework, often from inside
        # async request handlers — doing the file append inline would block the single
        # event loop on disk I/O on every log call. When a loop is running, hand the
        # append off to the default thread pool (fire-and-forget); otherwise (startup,
        # non-async contexts) write inline.
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop is not None:
            loop.run_in_executor(None, self._append, line)
        else:
            self._append(line)

    def _append(self, line):
        try:
            with open(self.PERSIST, "a", encoding="utf-8") as f:
                f.write(line)
        except OSError:
            pass

    def compact(self):
        """Rewrite the persist file down to the in-memory tail (called at startup)."""
        try:
            with open(self.PERSIST, "w", encoding="utf-8") as f:
                for e in self.buffer:
                    f.write(json.dumps(e, ensure_ascii=False) + "\n")
        except OSError:
            pass


_log_buffer = _RingBufferHandler()
_log_buffer.compact()
log.addHandler(_log_buffer)


# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------
# Required: db.py + vectors.py run against PostgreSQL + pgvector. db.init()
# fails fast at startup if this is unset.
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
MEDIA_DIR  = os.environ.get("MEDIA_DIR", "./media")
STATIC_DIR = os.environ.get("STATIC_DIR", "./static")

CFG = {
    "base_url":       os.environ.get("LLM_BASE_URL", "http://llamacpp-chat:5001/v1"),
    "embed_base_url": os.environ.get("EMBED_BASE_URL", "http://llamacpp-embed:5002/v1"),
    "api_key":        os.environ.get("LLM_API_KEY", ""),
    "embed_api_key":  os.environ.get("EMBED_API_KEY", ""),
    "chat_model":     os.environ.get("CHAT_MODEL", "Gemma-4-E4B-Uncensored-HauhauCS-Aggressive"),
    "embed_model":    os.environ.get("EMBED_MODEL", "nomic-embed-text"),
    "embed_dim":      int(os.environ.get("EMBED_DIM", "768")),
    "history_turns":  int(os.environ.get("HISTORY_TURNS", "16")),
    "top_k_memory":   int(os.environ.get("TOP_K_MEMORY", "4")),
    "top_k_lore":     int(os.environ.get("TOP_K_LORE", "6")),
    "mem_max_dist":   float(os.environ.get("MEM_MAX_DIST", "0.80")),
    "lore_max_dist":  float(os.environ.get("LORE_MAX_DIST", "0.80")),
    "temperature":    float(os.environ.get("GEN_TEMP", "0.85")),
    "top_p":          float(os.environ.get("GEN_TOP_P", "0.9")),
    "max_tokens":     int(os.environ.get("GEN_MAX_TOKENS", "4096")),
    "enable_thinking": os.environ.get("ENABLE_THINKING", "true").lower() in ("1", "true", "yes", "on"),
    "scene_style": False,
    "top_k": 0, "min_p": 0.0, "top_a": 0.0, "typical_p": 1.0, "tfs": 1.0,
    "repetition_penalty": 1.0, "repetition_penalty_range": 0,
    "frequency_penalty": 0.0, "presence_penalty": 0.0,
    "mirostat_mode": 0, "mirostat_tau": 5.0, "mirostat_eta": 0.1,
    "smoothing_factor": 0.0, "dynatemp_low": 0.0, "dynatemp_high": 0.0,
    "dry_multiplier": 0.0, "dry_base": 1.75, "dry_allowed_length": 2,
    "xtc_threshold": 0.1, "xtc_probability": 0.0,
    "seed": -1, "stop": [], "extra_params": {},
    "system_suffix": "", "post_history": "",
    # Instance-wide default display/generation language (what users read and what
    # the model writes in when they haven't picked their own interface language).
    "default_language": os.environ.get("DEFAULT_LANGUAGE", "English"),
    "comfyui_url":        os.environ.get("COMFYUI_URL", "http://comfyui:8188"),
    "comfyui_checkpoint": os.environ.get("COMFYUI_CHECKPOINT", "v1-5-pruned-emaonly.safetensors"),
    "comfyui_workflow":   os.environ.get("COMFYUI_WORKFLOW", ""),
    # Hosts a user-submitted "request a new model" source URL is allowed to
    # point at (checked server-side, never auto-fetched — see routers/sessions.py
    # _match_model_request_host). Admin-editable via PUT /api/settings so new
    # hosts can be allow-listed without a code change.
    "model_request_hosts": [
        {"host": "huggingface.co", "api_key": ""},
        {"host": "civitai.red", "api_key": ""},
    ],
    # Hosts a comment/thread link is allowed to auto-embed as an inline
    # image/gif preview (Discord-style), purely client-side — the server
    # never fetches these URLs itself, the viewer's own browser does, same
    # as any plain <img src>. Admin-editable via PUT /api/settings.
    "embed_link_hosts": [
        "tenor.com", "media.tenor.com", "giphy.com", "media.giphy.com",
        "media.discordapp.net", "cdn.discordapp.com", "imgur.com", "i.imgur.com",
    ],
}

# Dedicated vision endpoint for automatic NSFW image classification. This is
# intentionally NOT the general chat endpoint (which an admin may point at a
# text-only cloud API like DeepSeek via Settings): classification needs the
# local vision-capable Gemma served by llamacpp-chat, so it uses the env
# defaults directly and is never overlaid from the settings table.
VISION_CLASSIFY = {
    "base_url": os.environ.get("VISION_BASE_URL",
                               os.environ.get("LLM_BASE_URL", "http://llamacpp-chat:5001/v1")),
    "api_key":  os.environ.get("VISION_API_KEY", os.environ.get("LLM_API_KEY", "")),
    "model":    os.environ.get("VISION_MODEL",
                               os.environ.get("CHAT_MODEL", "Gemma-4-E4B-Uncensored-HauhauCS-Aggressive")),
}

# Keys safe to expose/edit over the global settings API
PUBLIC_CFG_KEYS = [
    "base_url", "embed_base_url", "chat_model", "embed_model", "embed_dim",
    "history_turns", "temperature", "top_p", "max_tokens", "enable_thinking",
    "top_k", "min_p", "top_a", "typical_p", "tfs",
    "repetition_penalty", "repetition_penalty_range",
    "frequency_penalty", "presence_penalty",
    "mirostat_mode", "mirostat_tau", "mirostat_eta",
    "smoothing_factor", "dynatemp_low", "dynatemp_high",
    "dry_multiplier", "dry_base", "dry_allowed_length",
    "xtc_threshold", "xtc_probability", "seed", "stop", "extra_params",
    "system_suffix", "post_history", "default_language",
    "comfyui_url", "comfyui_checkpoint", "comfyui_workflow",
    "model_request_hosts", "embed_link_hosts",
]

# Keys that a regular user can override per-session (NOT embed_dim, embed_model,
# embed_base_url, embed_api_key — embeddings always use the shared global endpoint;
# only the chat endpoint is user-bring-your-own, and even that goes through
# _validate_chat_endpoint before it's ever actually used, see PUT /me/settings)
USER_CFG_KEYS = [
    "base_url", "api_key", "chat_model",
    "history_turns", "enable_thinking", "scene_style", "temperature", "top_p", "max_tokens",
    "top_k", "min_p", "top_a", "typical_p", "tfs",
    "repetition_penalty", "repetition_penalty_range",
    "frequency_penalty", "presence_penalty",
    "mirostat_mode", "mirostat_tau", "mirostat_eta",
    "smoothing_factor", "dynatemp_low", "dynatemp_high",
    "dry_multiplier", "dry_base", "dry_allowed_length",
    "xtc_threshold", "xtc_probability", "seed", "stop", "extra_params",
    "system_suffix", "post_history",
]

os.makedirs(MEDIA_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)


def apply_llm_config():
    llm.configure(CFG["base_url"], CFG["api_key"],
                  embed_url=CFG.get("embed_base_url") or None,
                  embed_key=CFG.get("embed_api_key") or None)


# Auth cookie
COOKIE_NAME = "persona_session"
COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30 days

# Uploads
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
IMG_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

# Routers — auth_router is public, api requires authentication. Route modules
# import and decorate these; server.py includes them in section order.
auth_router = APIRouter(prefix="/api/auth")
api = APIRouter(prefix="/api")
