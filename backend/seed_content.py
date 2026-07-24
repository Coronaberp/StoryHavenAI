import json
import os
import shutil

from backend.repositories import characters as chars_repo
from backend.repositories import lore as lore_repo
from backend.repositories import personas as personas_repo
from backend.state import MEDIA_DIR, log

SEED_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "seed_content")
SEED_MARKER = "__SEED__/"


def _resolve_avatar(avatar: str) -> str:
    if not avatar.startswith(SEED_MARKER):
        return avatar
    filename = avatar[len(SEED_MARKER):]
    source = os.path.join(SEED_DIR, filename)
    if not os.path.isfile(source):
        log.warning("seed: avatar file missing %s", filename)
        return ""
    dest_name = f"seed_{filename}"
    shutil.copy(source, os.path.join(MEDIA_DIR, dest_name))
    return f"/media/{dest_name}"


async def _seed_character(payload: dict, owner_id: str) -> None:
    data = dict(payload["character"])
    data["owner_id"] = owner_id
    data["is_public"] = True
    data["avatar"] = _resolve_avatar(data.get("avatar") or "")
    char = await chars_repo.create(data)
    for entry in payload.get("lore", []):
        await lore_repo.create(
            char["id"], entry.get("keys") or [], entry.get("content") or "",
            always=bool(entry.get("always")), image=entry.get("image") or "",
            category=entry.get("category") or "", hidden=bool(entry.get("hidden")),
            name=entry.get("name") or "",
            appearance_tags=entry.get("appearance_tags") or "",
            appearance_tags_negative=entry.get("appearance_tags_negative") or "")
    log.info("seed: character created name=%s lore=%d", data.get("name"), len(payload.get("lore", [])))


async def _seed_persona(payload: dict, owner_id: str) -> None:
    data = dict(payload["persona"])
    data["avatar"] = _resolve_avatar(data.get("avatar") or "")
    await personas_repo.create(data, user_id=owner_id)
    log.info("seed: persona created name=%s", data.get("name"))


async def seed_default_content(owner_id: str) -> int:
    if not os.path.isdir(SEED_DIR):
        return 0
    created = 0
    for filename in sorted(os.listdir(SEED_DIR)):
        if not filename.endswith(".json"):
            continue
        with open(os.path.join(SEED_DIR, filename), encoding="utf-8") as fh:
            payload = json.load(fh)
        try:
            if payload.get("type") == "character":
                await _seed_character(payload, owner_id)
            elif payload.get("type") == "persona":
                await _seed_persona(payload, owner_id)
            else:
                continue
            created += 1
        except Exception as e:
            log.error("seed: failed for %s: %s: %s", filename, type(e).__name__, e)
    return created
