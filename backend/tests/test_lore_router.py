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
