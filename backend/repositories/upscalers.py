"""Upscaler preview images and display metadata."""
from __future__ import annotations

from sqlalchemy import select

from backend.db import (
    upscaler_previews, _q1,
    _list_model_previews, _set_model_preview_image, _clear_model_preview_image, _set_model_meta,
)
from backend.state import log


async def list_previews() -> dict:
    return await _list_model_previews(upscaler_previews, upscaler_previews.c.upscaler_name)


async def get_preview(name: str) -> str | None:
    r = await _q1(select(upscaler_previews.c.image).where(upscaler_previews.c.upscaler_name == name))
    return r["image"] if r else None


async def set_preview(name: str, image: str):
    await _set_model_preview_image(upscaler_previews, upscaler_previews.c.upscaler_name, name, image)
    log.info("upscalers: preview set name=%s", name)


async def delete_preview(name: str):
    await _clear_model_preview_image(upscaler_previews, upscaler_previews.c.upscaler_name, name)
    log.info("upscalers: preview cleared name=%s", name)


async def set_meta(name: str, display_name: str | None, description: str | None):
    await _set_model_meta(upscaler_previews, upscaler_previews.c.upscaler_name, name, display_name, description)
    log.info("upscalers: meta set name=%s", name)
