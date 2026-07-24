import os
import json
import time
import logging
import asyncio
import collections

from backend import llm
from fastapi import APIRouter

PROCESS_START_TIME = time.time()
APP_VERSION = "2.0.0"

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger("storyhavenai")
log.setLevel(logging.INFO)

def _sanitize_exc(e: Exception, *secrets: str | None) -> str:
    msg = f"{type(e).__name__}: {e}"
    for s in secrets:
        if s:
            msg = msg.replace(s, "[redacted]")
    return msg

class _RingBufferHandler(logging.Handler):
    PERSIST = os.environ.get("LOG_BUFFER_PATH", "./storyhavenai.logs.jsonl")
    MAX_AGE_SECONDS = 24 * 3600

    def __init__(self, capacity=2000):
        super().__init__()
        self.buffer = collections.deque(maxlen=capacity)
        try:
            with open(self.PERSIST, encoding="utf-8") as f:
                for line in f.readlines()[-capacity:]:
                    try:
                        self.buffer.append(json.loads(line))
                    except ValueError:
                        pass
        except OSError:
            pass
        self._prune()

    def _prune(self):
        cutoff = time.time() - self.MAX_AGE_SECONDS
        while self.buffer and self.buffer[0]["ts"] < cutoff:
            self.buffer.popleft()

    def emit(self, record):
        self._prune()
        entry = {
            "ts": record.created,
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        self.buffer.append(entry)
        line = json.dumps(entry, ensure_ascii=False) + "\n"

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
        try:
            with open(self.PERSIST, "w", encoding="utf-8") as f:
                for e in self.buffer:
                    f.write(json.dumps(e, ensure_ascii=False) + "\n")
        except OSError:
            pass

_log_buffer = _RingBufferHandler()
_log_buffer.compact()
log.addHandler(_log_buffer)

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
MEDIA_DIR  = os.environ.get("MEDIA_DIR", "./media")
STATIC_DIR = os.environ.get("STATIC_DIR", "./static")

CFG = {
    "base_url":       os.environ.get("LLM_BASE_URL", "http://llamacpp-chat:5001/v1"),
    "embed_base_url": os.environ.get("EMBED_BASE_URL", "http://llamacpp-embed:5002/v1"),
    "api_key":        os.environ.get("LLM_API_KEY", ""),
    "embed_api_key":  os.environ.get("EMBED_API_KEY", ""),
    "chat_model":     os.environ.get("CHAT_MODEL", "Gemma-4-E4B-Uncensored-HauhauCS-Aggressive"),
    "embed_model":    os.environ.get("EMBED_MODEL", "Qwen3-Embedding-0.6B"),
    "embed_dim":      int(os.environ.get("EMBED_DIM", "1024")),
    "history_turns":  int(os.environ.get("HISTORY_TURNS", "16")),
    "top_k_lore":     int(os.environ.get("TOP_K_LORE", "6")),
    "lore_max_dist":  float(os.environ.get("LORE_MAX_DIST", "0.80")),
    "temperature":    float(os.environ.get("GEN_TEMP", "0.85")),
    "top_p":          float(os.environ.get("GEN_TOP_P", "0.9")),
    "max_tokens":     int(os.environ.get("GEN_MAX_TOKENS", "4096")),
    "enable_thinking": os.environ.get("ENABLE_THINKING", "true").lower() in ("1", "true", "yes", "on"),
    "memory_v2": os.environ.get("MEMORY_V2", "false").lower() in ("1", "true", "yes", "on"),
    "nsfw_classification": os.environ.get("NSFW_CLASSIFICATION", "true").lower() in ("1", "true", "yes", "on"),
    "memory_v2_budget_tokens": int(os.environ.get("MEMORY_V2_BUDGET_TOKENS", "1000")),
    "webauthn_rp_id": os.environ.get("WEBAUTHN_RP_ID", ""),
    "webauthn_origin": os.environ.get("WEBAUTHN_ORIGIN", ""),
    "gpu_temp_limit": int(os.environ.get("GPU_TEMP_LIMIT", "83")),
    "gpu_temp_resume": int(os.environ.get("GPU_TEMP_RESUME", "75")),
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

    "default_language": os.environ.get("DEFAULT_LANGUAGE", "English"),
    "comfyui_url":        os.environ.get("COMFYUI_URL", "http://comfyui:8188"),
    "comfyui_checkpoint": os.environ.get("COMFYUI_CHECKPOINT", "v1-5-pruned-emaonly.safetensors"),
    "comfyui_workflow":   os.environ.get("COMFYUI_WORKFLOW", ""),

    "image_provider":       os.environ.get("IMAGE_PROVIDER", "comfyui"),
    "image_provider_url":   os.environ.get("IMAGE_PROVIDER_URL", ""),
    "image_provider_key":   os.environ.get("IMAGE_PROVIDER_KEY", ""),
    "image_provider_model": os.environ.get("IMAGE_PROVIDER_MODEL", ""),

    "model_request_hosts": [
        {"host": "huggingface.co", "api_key": ""},
        {"host": "civitai.red", "api_key": ""},
    ],

    "embed_link_hosts": [
        "tenor.com", "media.tenor.com", "giphy.com", "media.giphy.com",
        "media.discordapp.net", "cdn.discordapp.com", "imgur.com", "i.imgur.com",
    ],

    "modal_train_url": os.environ.get("MODAL_LORA_TRAIN_URL", ""),
    "modal_shared_secret": os.environ.get("MODAL_LORA_SHARED_SECRET", ""),

    "modal_checkpoint_url": os.environ.get("MODAL_LORA_CHECKPOINT_URL", ""),

    "modal_check_cached_url": os.environ.get("MODAL_LORA_CHECK_CACHED_URL", ""),
    "modal_upload_model_url": os.environ.get("MODAL_LORA_UPLOAD_MODEL_URL", ""),

    "modal_download_output_url": os.environ.get("MODAL_LORA_DOWNLOAD_OUTPUT_URL", ""),

    "giphy_api_key": os.environ.get("GIPHY_API_KEY", ""),

    "wan_unet_name": os.environ.get("WAN_UNET_NAME", ""),
    "wan_clip_name": os.environ.get("WAN_CLIP_NAME", ""),
    "wan_vae_name": os.environ.get("WAN_VAE_NAME", ""),
}

COMFYUI_MODELS_DIR = os.environ.get("COMFYUI_MODELS_DIR", "/app/comfyui_models")
LORA_OUTPUT_DIR = os.path.join(COMFYUI_MODELS_DIR, "loras")
CHECKPOINTS_DIR = os.path.join(COMFYUI_MODELS_DIR, "checkpoints")
UPSCALE_MODELS_DIR = os.path.join(COMFYUI_MODELS_DIR, "upscale_models")

DIFFUSION_MODELS_DIR = os.path.join(COMFYUI_MODELS_DIR, "diffusion_models")
TEXT_ENCODERS_DIR = os.path.join(COMFYUI_MODELS_DIR, "text_encoders")
VAE_DIR = os.path.join(COMFYUI_MODELS_DIR, "vae")
COMFYUI_OWNER_UID = int(os.environ.get("COMFYUI_OWNER_UID", "1000"))

VISION_CLASSIFY = {
    "base_url": os.environ.get("VISION_BASE_URL",
                               os.environ.get("LLM_BASE_URL", "http://llamacpp-chat:5001/v1")),
    "api_key":  os.environ.get("VISION_API_KEY", os.environ.get("LLM_API_KEY", "")),
    "model":    os.environ.get("VISION_MODEL",
                               os.environ.get("CHAT_MODEL", "Gemma-4-E4B-Uncensored-HauhauCS-Aggressive")),
}

PUBLIC_CFG_KEYS = [
    "base_url", "embed_base_url", "chat_model", "embed_model", "embed_dim",
    "history_turns", "temperature", "top_p", "max_tokens", "enable_thinking",
    "memory_v2", "memory_v2_budget_tokens",
    "nsfw_classification",
    "webauthn_rp_id", "webauthn_origin",
    "gpu_temp_limit", "gpu_temp_resume",
    "top_k", "min_p", "top_a", "typical_p", "tfs",
    "repetition_penalty", "repetition_penalty_range",
    "frequency_penalty", "presence_penalty",
    "mirostat_mode", "mirostat_tau", "mirostat_eta",
    "smoothing_factor", "dynatemp_low", "dynatemp_high",
    "dry_multiplier", "dry_base", "dry_allowed_length",
    "xtc_threshold", "xtc_probability", "seed", "stop", "extra_params",
    "system_suffix", "post_history", "default_language",
    "comfyui_url", "comfyui_checkpoint", "comfyui_workflow",
    "image_provider", "image_provider_url", "image_provider_model",
    "model_request_hosts", "embed_link_hosts",
    "modal_train_url", "modal_checkpoint_url", "modal_check_cached_url", "modal_upload_model_url",
    "modal_download_output_url",
    "wan_unet_name", "wan_clip_name", "wan_vae_name",

]

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

COOKIE_NAME = "persona_session"
COOKIE_MAX_AGE = 60 * 60 * 24 * 30

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
IMG_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

ACCESS_COOKIE_NAME = "sh_access"
REFRESH_COOKIE_NAME = "sh_refresh"

auth_router = APIRouter(prefix="/api/auth")
api = APIRouter(prefix="/api")
