"""Auto-provisions the Modal LoRA-training app (modal_app/lora_train.py) the
first time it's needed, instead of an admin ever running `modal deploy` or
pasting endpoint URLs/secrets into Settings by hand.

Auth to Modal itself comes from MODAL_TOKEN_ID/MODAL_TOKEN_SECRET env vars on
this container — infra credentials, same treatment as DATABASE_URL or
SECRET_ENCRYPTION_KEY, not a Settings field an admin edits through the UI.
Get a token pair from `modal token new` or the Modal dashboard's Settings ->
API Tokens page.
"""
import asyncio
import os
import re
import secrets

import httpx

from backend import db
from backend.state import CFG, log

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_URL_RE = re.compile(r"https://\S+\.modal\.run")
# run.sh execs uvicorn via its absolute venv path rather than activating the
# venv, so the process's own PATH never includes venv/bin — plain "modal"
# resolves nowhere via asyncio.create_subprocess_exec. Under --reload the
# actual worker runs inside a multiprocessing-spawned child where
# sys.executable loses its directory (resolves to a bare "python3"), so
# derive the venv path from REPO_ROOT (__file__-based, always reliable)
# instead of sys.executable.
MODAL_BIN = os.path.join(REPO_ROOT, "venv", "bin", "modal")

_provisioning_lock = asyncio.Lock()


class ModalProvisionError(RuntimeError):
    pass


async def _is_alive(checkpoint_url: str, shared_secret: str) -> bool:
    """Hits the lightweight (no-GPU) request_checkpoint endpoint to check the
    cached deployment is actually still serving requests, not just that we
    have URLs cached for it — an app stopped from the Modal dashboard (or
    torn down for any other reason) keeps its URL "valid" forever as far as
    CFG is concerned, so without this check every training request would
    just fail against a dead endpoint until someone noticed and manually
    cleared modal_train_url/etc. in Settings."""
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.post(checkpoint_url, headers={"Authorization": f"Bearer {shared_secret}"},
                                     json={"job_id": ""})
        # A live app responds with real JSON (400 "job_id required" here,
        # since we deliberately sent an empty one) — a stopped/missing app's
        # 404 comes from Modal's own edge proxy instead ("modal-http: app for
        # invoked web endpoint is stopped"), not this function's code at all.
        return resp.status_code in (200, 400, 401)
    except httpx.HTTPError:
        return False


async def ensure_deployed(on_log=None):
    """No-op if modal_train_url/modal_checkpoint_url/modal_shared_secret are
    already cached in CFG AND that deployment is confirmed still alive;
    otherwise runs `modal deploy` and caches the result. Concurrent callers
    (two admins starting jobs at once on a cold start) share one in-flight
    deploy instead of racing two.

    on_log, if given, is awaited with each line of the deploy's own output as
    it happens — the deploy can take a couple minutes, and blocking on
    proc.communicate() until it's all over left the caller's progress display
    (and the DB row it persists into for refresh-recovery) frozen on
    "Checking Modal deployment…" the whole time, indistinguishable from being
    stuck; a reload mid-deploy showed the same stale text instead of real
    progress."""
    def _all_cached():
        return (CFG.get("modal_train_url") and CFG.get("modal_checkpoint_url")
                and CFG.get("modal_check_cached_url") and CFG.get("modal_upload_model_url")
                and CFG.get("modal_download_output_url") and CFG.get("modal_shared_secret"))
    checkpoint_url_before = CFG.get("modal_checkpoint_url")
    if _all_cached() and await _is_alive(checkpoint_url_before, CFG["modal_shared_secret"]):
        return
    async with _provisioning_lock:
        # Only trust the cache here if it changed while we were waiting for
        # the lock — that means a concurrent caller just finished a real
        # redeploy. If it's the *same* (already confirmed-dead) URL as
        # before, this must be the caller that lost the aliveness check
        # above, and needs to actually redeploy, not bail out early again —
        # that early-return used to fire unconditionally on mere presence,
        # silently skipping every redeploy this whole aliveness check was
        # supposed to force.
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
            # 500 chars routinely landed mid-line inside verbose pip install
            # output, hiding the actual "Error" box further down (as happened
            # with the RTX4090-isn't-a-valid-GPU-type failure) — 4000 is
            # comfortably past any single dependency install's tail.
            raise ModalProvisionError(f"Modal deploy failed: {text[-4000:] or 'unknown error'}")

        # Modal slugifies each function's name into its endpoint URL (e.g.
        # request_checkpoint -> ...-request-checkpoint.modal.run) — matching
        # by exact suffix rather than a loose substring is what keeps
        # check_model_cached's URL from being mistaken for
        # request_checkpoint's (both would match a naive "checkpoint" check).
        urls = _URL_RE.findall(text)
        def _find(suffix):
            # The URL ends in ".modal.run", not the function-name suffix
            # itself — checking endswith(suffix) directly never matches
            # anything, since ".modal.run" is always the last several chars.
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
