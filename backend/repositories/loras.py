"""LoRA preview images, display metadata, and self-trained-LoRA visibility gating."""
from __future__ import annotations

import time

from sqlalchemy import select, update, delete

from backend.db import (
    lora_previews, lora_visibility,
    _q, _q1, _w, pg_insert,
    _list_model_previews, _set_model_preview_image, _clear_model_preview_image, _set_model_meta,
)
from backend.state import log


async def list_previews() -> dict:
    return await _list_model_previews(lora_previews, lora_previews.c.lora_name)


async def get_preview(name: str) -> str | None:
    r = await _q1(select(lora_previews.c.image).where(lora_previews.c.lora_name == name))
    return r["image"] if r else None


async def set_preview(name: str, image: str):
    await _set_model_preview_image(lora_previews, lora_previews.c.lora_name, name, image)
    log.info("loras: preview set name=%s", name)


async def delete_preview(name: str):
    await _clear_model_preview_image(lora_previews, lora_previews.c.lora_name, name)
    log.info("loras: preview cleared name=%s", name)


async def set_meta(name: str, display_name: str | None, description: str | None,
                    model_category: list[str] | None = None, keywords: list[str] | None = None):
    await _set_model_meta(lora_previews, lora_previews.c.lora_name, name, display_name, description,
                          model_category=model_category, keywords=keywords)
    log.info("loras: meta set name=%s", name)


async def gate_visibility(name: str, created_by: str):
    stmt = pg_insert(lora_visibility).values(
        lora_name=name, is_published=0, created_by=created_by, created=time.time())
    stmt = stmt.on_conflict_do_nothing(index_elements=[lora_visibility.c.lora_name.name])
    await _w(stmt)
    log.info("loras: visibility gated name=%s created_by=%s", name, created_by)


async def set_published(name: str, published: bool):
    await _w(update(lora_visibility).where(lora_visibility.c.lora_name == name)
             .values(is_published=1 if published else 0,
                    published_at=time.time() if published else None))
    log.info("loras: published name=%s published=%s", name, published)


async def list_unpublished_names() -> set[str]:
    rows = await _q(select(lora_visibility.c.lora_name)
                    .where(lora_visibility.c.is_published == 0))
    return {r["lora_name"] for r in rows}


async def list_all_visibility() -> dict:
    """{lora_name: is_published bool} for every gated (self-trained) LoRA —
    including already-published ones, so the admin UI can tell "not gated at
    all" apart from "gated and published"."""
    rows = await _q(select(lora_visibility))
    return {r["lora_name"]: bool(r["is_published"]) for r in rows}


async def get_visibility(name: str) -> dict | None:
    return await _q1(select(lora_visibility).where(lora_visibility.c.lora_name == name))


async def delete_visibility(name: str):
    await _w(delete(lora_visibility).where(lora_visibility.c.lora_name == name))
    log.info("loras: visibility deleted name=%s", name)
