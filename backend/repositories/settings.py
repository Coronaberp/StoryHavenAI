from __future__ import annotations
import json

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from backend import db
from backend.db import settings, _q, _encrypt_secret, _decrypt_secret
from backend.state import log

_SECRET_KEYS = {"api_key", "embed_api_key", "modal_shared_secret"}

def _encrypt_value(key: str, value):
    if key in _SECRET_KEYS:
        return _encrypt_secret(value or "")
    if key == "model_request_hosts" and isinstance(value, list):
        return [{**host, "api_key": _encrypt_secret(host.get("api_key") or "")}
                if isinstance(host, dict) else host for host in value]
    return value

def _decrypt_value(key: str, value):
    if key in _SECRET_KEYS:
        return _decrypt_secret(value or "")
    if key == "model_request_hosts" and isinstance(value, list):
        return [{**host, "api_key": _decrypt_secret(host.get("api_key") or "")}
                if isinstance(host, dict) else host for host in value]
    return value

async def all_settings() -> dict:
    out = {}
    for r in await _q(select(settings.c.key, settings.c.value)):
        try:
            out[r["key"]] = _decrypt_value(r["key"], json.loads(r["value"]))
        except Exception:
            log.debug("global settings: value for key=%s is not JSON, using raw string", r["key"])
            out[r["key"]] = r["value"]
    return out

async def set_settings(items: dict):
    async with db._engine.begin() as conn:
        for k, v in items.items():
            stmt = pg_insert(settings).values(key=k, value=json.dumps(_encrypt_value(k, v)))
            stmt = stmt.on_conflict_do_update(
                index_elements=["key"], set_={"value": stmt.excluded.value})
            await conn.execute(stmt)
    log.info(f"global settings updated keys={sorted(items.keys())}")
