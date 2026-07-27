from __future__ import annotations

from sqlalchemy import select

from backend.db import (
    checkpoint_previews, _q1, _w, pg_insert,
    _list_model_previews, _set_model_preview_image, _clear_model_preview_image, _set_model_meta,
)
from backend.state import log

async def list_previews() -> dict:
    return await _list_model_previews(checkpoint_previews, checkpoint_previews.c.checkpoint_name)

async def get_display_name(checkpoint_name: str) -> str | None:
    r = await _q1(select(checkpoint_previews.c.display_name)
                 .where(checkpoint_previews.c.checkpoint_name == checkpoint_name))
    return (r["display_name"] if r else None) or None

def _image_column(nsfw: bool):
    return checkpoint_previews.c.image_nsfw if nsfw else checkpoint_previews.c.image

async def get_preview(name: str, nsfw: bool = False) -> str | None:
    column = _image_column(nsfw)
    r = await _q1(select(column).where(checkpoint_previews.c.checkpoint_name == name))
    return r[column.name] if r else None

async def set_preview(name: str, image: str, nsfw: bool = False):
    await _set_model_preview_image(checkpoint_previews, checkpoint_previews.c.checkpoint_name,
                                   name, image, column=_image_column(nsfw).name)
    log.info("checkpoints: preview set name=%s nsfw=%s", name, nsfw)

async def delete_preview(name: str, nsfw: bool = False):
    await _clear_model_preview_image(checkpoint_previews, checkpoint_previews.c.checkpoint_name,
                                     name, column=_image_column(nsfw).name)
    log.info("checkpoints: preview cleared name=%s nsfw=%s", name, nsfw)

async def set_meta(name: str, display_name: str | None, description: str | None,
                    model_type: str | None = None, default_steps: int | None = None,
                    anima_clip_name: str | None = None, anima_vae_name: str | None = None,
                    default_sampler: str | None = None, default_scheduler: str | None = None,
                    default_cfg: float | None = None, default_positive: str | None = None,
                    default_negative: str | None = None,
                    model_category: list[str] | None = None):

    await _set_model_meta(checkpoint_previews, checkpoint_previews.c.checkpoint_name, name,
                          display_name, description, model_type, default_steps,
                          default_sampler, default_scheduler, default_cfg,
                          default_positive, default_negative,
                          model_category=model_category)
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
