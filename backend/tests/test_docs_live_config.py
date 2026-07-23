import pytest

from backend.routers import misc as misc_router

pytestmark = pytest.mark.asyncio

_ALLOWED_KEYS = {
    "memory_v2_budget_tokens", "memory_batch_size", "history_turns",
    "top_k_memory", "top_k_lore", "mem_max_dist", "lore_max_dist",
}


async def test_live_config_returns_whitelisted_numbers():
    cfg = await misc_router.docs_live_config(_user={"id": "u1", "username": "u", "is_admin": False})
    assert cfg["memory_v2_budget_tokens"] > 0
    assert cfg["memory_batch_size"] > 0
    assert all(isinstance(v, (int, float)) for v in cfg.values())


async def test_live_config_only_exposes_numeric_whitelisted_values():
    cfg = await misc_router.docs_live_config(_user={"id": "u1", "username": "u", "is_admin": False})
    assert set(cfg) <= _ALLOWED_KEYS
    for value in cfg.values():
        assert isinstance(value, (int, float)) and not isinstance(value, bool)
