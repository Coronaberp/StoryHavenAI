import pytest

from backend import memory_extraction as me

GOOD = ('{"facts": [{"text": "Mira was stabbed.", "fact_type": "state", "participants": ["Mira"], '
        '"importance": 5, "valence": -2}], "char_state": {"doing": "", "location": "", "npcs": []}}')


def _fake_stream(replies):
    calls = []

    async def fake(messages, model, *a, **kw):
        calls.append(messages)
        reply = replies[min(len(calls) - 1, len(replies) - 1)]
        yield "content", reply

    return fake, calls


@pytest.mark.asyncio
async def test_run_extract_happy_path(monkeypatch):
    fake, calls = _fake_stream([GOOD])
    monkeypatch.setattr(me.llm, "chat_stream", fake)
    facts, char_state = await me.run_extract("t", "Kael", "Alice", "English", "m")
    assert len(facts) == 1 and len(calls) == 1
    assert char_state == me.CharStateDraft()


@pytest.mark.asyncio
async def test_run_extract_retries_once_with_error_feedback(monkeypatch):
    fake, calls = _fake_stream(["not json at all", GOOD])
    monkeypatch.setattr(me.llm, "chat_stream", fake)
    facts, char_state = await me.run_extract("t", "Kael", "Alice", "English", "m")
    assert len(facts) == 1 and len(calls) == 2
    assert "Your previous reply was invalid" in calls[1][-1]["content"]


@pytest.mark.asyncio
async def test_run_extract_gives_up_after_second_failure(monkeypatch):
    fake, calls = _fake_stream(["junk", "more junk"])
    monkeypatch.setattr(me.llm, "chat_stream", fake)
    facts, char_state = await me.run_extract("t", "Kael", "Alice", "English", "m")
    assert facts == [] and char_state == me.CharStateDraft() and len(calls) == 2


@pytest.mark.asyncio
async def test_run_reconcile_falls_back_to_add(monkeypatch):
    fake, calls = _fake_stream(["junk", "junk"])
    monkeypatch.setattr(me.llm, "chat_stream", fake)
    drafts, _ = me.parse_extract_response(GOOD)
    decisions = await me.run_reconcile(drafts, [[{"id": "mf_a", "text": "x"}]], "m")
    assert [d.action for d in decisions] == ["add"]


@pytest.mark.asyncio
async def test_run_reconcile_happy_path(monkeypatch):
    fake, calls = _fake_stream(['[{"index": 0, "action": "reinforce", "target_id": "mf_a"}]'])
    monkeypatch.setattr(me.llm, "chat_stream", fake)
    drafts, _ = me.parse_extract_response(GOOD)
    decisions = await me.run_reconcile(drafts, [[{"id": "mf_a", "text": "x"}]], "m")
    assert decisions[0].action == "reinforce"
