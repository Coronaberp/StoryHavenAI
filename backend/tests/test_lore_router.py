import pytest

pytestmark = pytest.mark.asyncio

async def test_preview_chunks_short_content_returns_one_chunk():
    from backend.routers.lore import preview_lore_chunks
    from backend.schemas import LoreChunkPreviewIn
    result = await preview_lore_chunks(LoreChunkPreviewIn(content="A short entry."))
    assert result == {"chunks": ["A short entry."]}

async def test_preview_chunks_long_content_returns_multiple():
    from backend.routers.lore import preview_lore_chunks
    from backend.schemas import LoreChunkPreviewIn
    paragraph = ("This is a long sentence about the ancient kingdom. " * 20).strip()
    content = "\n\n".join([paragraph] * 6)
    result = await preview_lore_chunks(LoreChunkPreviewIn(content=content))
    assert len(result["chunks"]) > 1
    for chunk in result["chunks"]:
        assert isinstance(chunk, str)

async def test_preview_chunks_response_has_no_extra_metadata():
    from backend.routers.lore import preview_lore_chunks
    from backend.schemas import LoreChunkPreviewIn
    result = await preview_lore_chunks(LoreChunkPreviewIn(content="short"))
    assert set(result.keys()) == {"chunks"}

async def test_delete_lore_removes_orphaned_chunks(db_conn, monkeypatch):
    from backend.routers.lore import delete_lore
    from backend.repositories import lore
    from backend.repositories import lore_chunks as lore_chunks_repo

    async def fake_embed(*args, **kwargs):
        return [0.1] * 1024

    monkeypatch.setattr("backend.llm.embed", fake_embed)
    from backend import vectors
    vectors._build_tables(768)

    owner_id = "user-delete-lore-1"
    paragraph = ("This is a long sentence about the ancient kingdom. " * 20).strip()
    content = "\n\n".join([paragraph] * 6)
    lid = await lore.create(None, ["kingdom"], content, False, owner_id=owner_id)
    from backend.retrieval import index_lore
    await index_lore(lid, None, content, "Kingdom", "")
    assert len(await lore_chunks_repo.chunks_for(lid)) > 1

    current_user = {"id": owner_id, "is_admin": False, "username": "tester"}
    await delete_lore(lid, current_user=current_user)

    assert await lore_chunks_repo.chunks_for(lid) == []
