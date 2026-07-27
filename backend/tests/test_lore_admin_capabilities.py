import pytest

pytestmark = pytest.mark.asyncio


async def test_reindex_denied_without_capability(db_conn):
    import inspect
    from fastapi import HTTPException
    from backend.routers.lore import reindex_lore
    dependency = inspect.signature(reindex_lore).parameters["current_user"].default.dependency
    with pytest.raises(HTTPException) as exc_info:
        await dependency(current_user={"role": "member"})
    assert exc_info.value.status_code == 403


async def test_reindex_allowed_with_capability(db_conn, monkeypatch):
    from backend.routers import lore
    from backend.repositories import lore as lore_repo
    from backend.repositories import role_capabilities as rc

    async def _fake_index_lore(*args, **kwargs):
        return None

    async def _fake_count_lore_vectors(*args, **kwargs):
        return 0

    monkeypatch.setattr(lore, "index_lore", _fake_index_lore)
    monkeypatch.setattr(lore.vectors, "count_lore_vectors", _fake_count_lore_vectors)

    await rc.grant("member", "system_settings.edit")
    lid = await lore_repo.create(None, "keyword", "some lore content", always=False)
    result = await lore.reindex_lore(lid, current_user={"role": "member", "username": "u1"})
    assert result is not None
    assert result["id"] == lid
