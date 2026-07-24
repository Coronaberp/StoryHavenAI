import asyncio

import pytest

from backend import classify
from backend.state import CFG

pytestmark = pytest.mark.asyncio

PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d"
    "49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082")

async def test_classify_skips_llm_when_disabled(monkeypatch):
    monkeypatch.setitem(CFG, "nsfw_classification", False)

    async def must_not_run(*args, **kwargs):
        raise AssertionError("classifier called while disabled")

    monkeypatch.setattr(classify.llm, "classify_image_explicit", must_not_run)
    explicit, confidence = await classify.classify_image_nsfw(PNG_BYTES, "image/png", "u1", False)
    assert explicit is False
    assert confidence == 0

async def test_background_classify_noop_when_disabled(monkeypatch):
    monkeypatch.setitem(CFG, "nsfw_classification", False)
    applied = []
    done = []

    async def apply():
        applied.append(True)

    async def on_done(explicit):
        done.append(explicit)

    classify.classify_image_background(PNG_BYTES, "image/png", "u1", False, apply, on_done=on_done)
    await asyncio.sleep(0.05)
    assert applied == []
    assert done == [False]

async def test_classify_runs_when_enabled(monkeypatch):
    monkeypatch.setitem(CFG, "nsfw_classification", True)
    calls = []

    async def fake_classifier(data_url, model, base_url=None, api_key=None):
        calls.append(data_url[:20])
        return True, 95, "explicit"

    monkeypatch.setattr(classify.llm, "classify_image_explicit", fake_classifier)
    explicit, confidence = await classify.classify_image_nsfw(PNG_BYTES, "image/png", "u1", False)
    assert explicit is True
    assert confidence == 95
    assert len(calls) == 1
