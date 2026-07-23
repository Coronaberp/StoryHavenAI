import pytest

from backend import ai_helpers

pytestmark = pytest.mark.asyncio


async def test_extract_lore_secrets_parses_numbered_list(monkeypatch):
    async def fake_chat_stream(*args, **kwargs):
        for c in ["1. She has a sweet tooth\n", "2. She dislikes cake\n"]:
            yield ("content", c)
    monkeypatch.setattr(ai_helpers.llm, "chat_stream", fake_chat_stream)
    result = await ai_helpers.extract_lore_secrets("She secretly likes sweets but hates cake", "test-model")
    assert result == ["She has a sweet tooth", "She dislikes cake"]


async def test_extract_lore_secrets_empty_response_returns_empty_list(monkeypatch):
    async def fake_chat_stream(*args, **kwargs):
        return
        yield
    monkeypatch.setattr(ai_helpers.llm, "chat_stream", fake_chat_stream)
    result = await ai_helpers.extract_lore_secrets("some content", "test-model")
    assert result == []
