import asyncio
import os
import re
import secrets

import httpx

from backend import db
from backend.state import CFG, log

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_URL_RE = re.compile(r"https://\S+\.modal\.run")

MODAL_BIN = os.path.join(REPO_ROOT, "venv", "bin", "modal")

_provisioning_lock = asyncio.Lock()

class ModalProvisionError(RuntimeError):
    pass

async def _is_alive(checkpoint_url: str, shared_secret: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.post(checkpoint_url, headers={"Authorization": f"Bearer {shared_secret}"},
                                     json={"job_id": ""})

        return resp.status_code in (200, 400, 401)
    except httpx.HTTPError:
        return False

async def ensure_deployed(on_log=None):
    def _all_cached():
        return (CFG.get("modal_train_url") and CFG.get("modal_checkpoint_url")
                and CFG.get("modal_check_cached_url") and CFG.get("modal_upload_model_url")
                and CFG.get("modal_download_output_url") and CFG.get("modal_shared_secret"))
    checkpoint_url_before = CFG.get("modal_checkpoint_url")
    if _all_cached() and await _is_alive(checkpoint_url_before, CFG["modal_shared_secret"]):
        return
    async with _provisioning_lock:

        if _all_cached() and CFG.get("modal_checkpoint_url") != checkpoint_url_before:
            return
        token_id = os.environ.get("MODAL_TOKEN_ID", "")
        token_secret = os.environ.get("MODAL_TOKEN_SECRET", "")
        if not token_id or not token_secret:
            raise ModalProvisionError(
                "Modal isn't set up yet — set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET on the "
                "story-game container (from `modal token new`) and restart it, then try again.")

        shared_secret = secrets.token_urlsafe(32)
        env = {**os.environ, "MODAL_TOKEN_ID": token_id, "MODAL_TOKEN_SECRET": token_secret,
              "LORA_TRAIN_SHARED_SECRET": shared_secret}
        log.info("modal_provision: deploying modal_app/lora_train.py")
        try:
            proc = await asyncio.create_subprocess_exec(
                MODAL_BIN, "deploy", "modal_app/lora_train.py",
                cwd=REPO_ROOT, env=env,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        except OSError as e:
            raise ModalProvisionError(f"Could not launch `modal deploy` ({MODAL_BIN}): {e}") from e

        lines: list[str] = []
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            text_line = line.decode("utf-8", "ignore").rstrip("\r\n")
            lines.append(text_line)
            if text_line.strip() and on_log:
                try:
                    await on_log(text_line)
                except Exception:
                    log.exception("modal_provision: on_log callback failed")
        await proc.wait()
        text = "\n".join(lines)
        if proc.returncode != 0:
            log.warning("modal_provision: deploy failed: %s", text[-2000:])

            raise ModalProvisionError(f"Modal deploy failed: {text[-4000:] or 'unknown error'}")

        urls = _URL_RE.findall(text)
        def _find(suffix):

            return next((u for u in urls if f"{suffix}.modal.run" in u), None)
        train_url = _find("-train")
        checkpoint_url = _find("-request-checkpoint")
        check_cached_url = _find("-check-model-cached")
        upload_model_url = _find("-upload-model")
        download_output_url = _find("-download-output")
        if not all([train_url, checkpoint_url, check_cached_url, upload_model_url, download_output_url]):
            log.warning("modal_provision: could not find all endpoint URLs in deploy output: %s", text[-2000:])
            raise ModalProvisionError("Modal deployed but its endpoint URLs couldn't be parsed from the output — "
                                     "check the story-game logs.")

        CFG["modal_train_url"] = train_url
        CFG["modal_checkpoint_url"] = checkpoint_url
        CFG["modal_check_cached_url"] = check_cached_url
        CFG["modal_upload_model_url"] = upload_model_url
        CFG["modal_download_output_url"] = download_output_url
        CFG["modal_shared_secret"] = shared_secret
        await db.set_settings({"modal_train_url": train_url, "modal_checkpoint_url": checkpoint_url,
                               "modal_check_cached_url": check_cached_url,
                               "modal_upload_model_url": upload_model_url,
                               "modal_download_output_url": download_output_url,
                               "modal_shared_secret": shared_secret})
        log.info("modal_provision: deployed — train=%s checkpoint=%s check_cached=%s upload=%s download=%s",
                 train_url, checkpoint_url, check_cached_url, upload_model_url, download_output_url)
