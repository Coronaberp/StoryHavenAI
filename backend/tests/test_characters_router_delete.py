import pytest

from backend.routers import characters as characters_router
from backend import vectors

pytestmark = pytest.mark.asyncio


@pytest.fixture()
def wired(monkeypatch):
    calls = {}

    async def fake_get(cid):
        return {"id": cid, "owner_id": "u1"}

    async def fake_delete(cid):
        calls["deleted_char"] = cid

    async def fake_purge_char(cid):
        calls["purged_memory"] = cid

    async def fake_delete_lore_vectors_by_char(char_id):
        calls["deleted_lore_vectors"] = char_id

    monkeypatch.setattr(characters_router.characters, "get", fake_get)
    monkeypatch.setattr(characters_router.characters, "delete", fake_delete)
    monkeypatch.setattr(characters_router.memory_facts, "purge_char", fake_purge_char)
    monkeypatch.setattr(vectors, "delete_lore_vectors_by_char", fake_delete_lore_vectors_by_char)
    return calls


async def test_delete_character_removes_lore_vectors(wired):
    result = await characters_router.delete_character("char1", current_user={"id": "u1", "is_admin": False})
    assert result == {"deleted": True}
    assert wired["deleted_char"] == "char1"
    assert wired["purged_memory"] == "char1"
    assert wired["deleted_lore_vectors"] == "char1"


async def test_delete_character_forbidden_for_non_owner_non_admin(wired):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        await characters_router.delete_character("char1", current_user={"id": "other", "is_admin": False})
    assert exc_info.value.status_code == 403
    assert "deleted_lore_vectors" not in wired
