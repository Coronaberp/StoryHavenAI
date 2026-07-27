import os
import zipfile

import httpx
from fastapi import Depends, HTTPException

from backend.state import api, log
from backend.auth import get_dev
from backend.routers.imagegen import _match_model_request_host
from backend.repositories import model_requests as model_request_repo

_MR_SUBDIRS = {"checkpoint": "checkpoints", "lora": "loras", "upscaler": "upscale_models",
               "anima": "diffusion_models", "wan": "diffusion_models"}
_MR_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
_MR_TARGET_UID = 525287
_MR_TARGET_GID = 525287


def _mr_ext_for(url: str, request_type: str) -> str:
    known = (".safetensors", ".ckpt", ".pt", ".pth")
    lowered = url.lower()
    for ext in known:
        if lowered.endswith(ext):
            return ext
    return ".pth" if request_type == "upscaler" else ".safetensors"


def _mr_manual_command(subdir: str, url: str, filename: str, api_key: str | None) -> str:
    auth_part = f" -H 'Authorization: Bearer {api_key}'" if api_key else ""
    return (f"cd /var/mnt/storage/podman/volumes/sillytavern_comfyui_models/_data/{subdir} && "
            f"sudo curl -L -A '{_MR_UA}'{auth_part} '{url}' -o '{filename}.dl' && "
            f"sudo mv '{filename}.dl' '{filename}' && sudo chown {_MR_TARGET_UID}:{_MR_TARGET_GID} '{filename}'")


@api.post("/admin/model-requests/{rid}/fetch")
async def admin_fetch_model_request(rid: str, current_user: dict = Depends(get_dev)):
    r = await model_request_repo.get(rid)
    if not r:
        raise HTTPException(404, "not found")
    match = _match_model_request_host(r["source_url"])
    if not match:
        raise HTTPException(400, "source URL is not on the allowed host list")

    subdir = _MR_SUBDIRS.get(r["request_type"], "checkpoints")
    ext = _mr_ext_for(r["source_url"], r["request_type"])
    filename = f"{r['model_name']}{ext}"
    target_dir = f"/app/comfyui_models/{subdir}"
    target_path = f"{target_dir}/{filename}"
    api_key = match.get("api_key")
    headers = {"User-Agent": _MR_UA}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        os.makedirs(target_dir, exist_ok=True)
        async with httpx.AsyncClient(follow_redirects=True, timeout=None) as client:
            async with client.stream("GET", r["source_url"], headers=headers) as resp:
                if resp.status_code >= 400:
                    raise RuntimeError(f"HTTP {resp.status_code}")
                with open(target_path, "wb") as f:
                    async for chunk in resp.aiter_bytes():
                        f.write(chunk)
    except Exception as exc:
        log.error("admin_dev: model fetch failed rid=%s error=%s", rid, exc)
        manual = _mr_manual_command(subdir, r["source_url"], filename, api_key)
        return {"status": "failed_show_manual_command", "manual_command": manual}

    if zipfile.is_zipfile(target_path):
        extract_dir = f"{target_dir}/{filename}_extract"
        with zipfile.ZipFile(target_path) as zf:
            zf.extractall(extract_dir)
        for root, _dirs, files in os.walk(extract_dir):
            for name in files:
                if name.lower().endswith((".safetensors", ".ckpt", ".pt", ".pth")):
                    os.replace(os.path.join(root, name), f"{target_dir}/{name}")
        os.remove(target_path)

    try:
        os.chown(target_path, _MR_TARGET_UID, _MR_TARGET_GID)
    except (PermissionError, OSError) as exc:
        log.warning("admin_dev: model fetch chown failed rid=%s error=%s", rid, exc)
        manual = (f"sudo chown {_MR_TARGET_UID}:{_MR_TARGET_GID} "
                  f"/var/mnt/storage/podman/volumes/sillytavern_comfyui_models/_data/{subdir}/{filename}")
        return {"status": "fetched_needs_chown_fix", "manual_command": manual}

    log.info("admin_dev: model fetch complete rid=%s model=%s", rid, r["model_name"])
    return {"status": "fetched", "manual_command": None}
