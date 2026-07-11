"""Checkpoint preview images, display metadata, and Anima CLIP/VAE overrides."""
from __future__ import annotations

from sqlalchemy import select

from backend.db import (
    checkpoint_previews, _q1, _w, pg_insert,
    _list_model_previews, _set_model_preview_image, _clear_model_preview_image, _set_model_meta,
)
from backend.state import log


async def list_previews() -> dict:
    return await _list_model_previews(checkpoint_previews, checkpoint_previews.c.checkpoint_name)


async def get_preview(name: str) -> str | None:
    r = await _q1(select(checkpoint_previews.c.image)
                  .where(checkpoint_previews.c.checkpoint_name == name))
    return r["image"] if r else None


async def set_preview(name: str, image: str):
    await _set_model_preview_image(checkpoint_previews, checkpoint_previews.c.checkpoint_name, name, image)
    log.info("checkpoints: preview set name=%s", name)


async def delete_preview(name: str):
    await _clear_model_preview_image(checkpoint_previews, checkpoint_previews.c.checkpoint_name, name)
    log.info("checkpoints: preview cleared name=%s", name)


async def set_meta(name: str, display_name: str | None, description: str | None,
                    model_type: str | None = None, default_steps: int | None = None,
                    anima_clip_name: str | None = None, anima_vae_name: str | None = None):
    # model_category intentionally never touched here — checkpoints classify
    # architecture only via the free-text Type field now; whatever category
    # a checkpoint already had from before is left exactly as-is.
    await _set_model_meta(checkpoint_previews, checkpoint_previews.c.checkpoint_name, name,
                          display_name, description, model_type, default_steps)
    stmt = pg_insert(checkpoint_previews).values(
        checkpoint_name=name, anima_clip_name=anima_clip_name, anima_vae_name=anima_vae_name)
    stmt = stmt.on_conflict_do_update(
        index_elements=[checkpoint_previews.c.checkpoint_name.name],
        set_={"anima_clip_name": stmt.excluded.anima_clip_name,
              "anima_vae_name": stmt.excluded.anima_vae_name})
    await _w(stmt)
    log.info("checkpoints: meta set name=%s", name)


async def get_anima_overrides(name: str) -> tuple[str | None, str | None]:
    r = await _q1(select(checkpoint_previews.c.anima_clip_name, checkpoint_previews.c.anima_vae_name)
                  .where(checkpoint_previews.c.checkpoint_name == name))
    if not r:
        return None, None
    return r["anima_clip_name"], r["anima_vae_name"]
