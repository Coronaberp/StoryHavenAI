import os

import pytest

from backend import chat_service, memory_service
from backend.memory_service import present_participants, _transcript
from backend.repositories import chat_sessions, characters, memory_facts, personas, session_participants as sp

pytestmark = pytest.mark.asyncio

_EMBED_DIM = int(os.environ.get("EMBED_DIM", "768"))

@pytest.fixture(autouse=True)
def _ensure_memory_facts_table():
    memory_facts.build_tables(_EMBED_DIM)

@pytest.fixture(autouse=True)
def _stub_memory_extraction(monkeypatch):
    async def _noop_maybe_extract(*args, **kwargs):
        return None
    monkeypatch.setattr(memory_service, "maybe_extract", _noop_maybe_extract)

@pytest.fixture(autouse=True)
def _stub_embed(monkeypatch):
    async def _no_embed(*args, **kwargs):
        raise RuntimeError("embed endpoint unreachable in tests")
    monkeypatch.setattr(chat_service.llm, "embed", _no_embed)

async def test_solo_session_ownership_unaffected_by_multiplayer_code(db_conn):
    sid = await chat_sessions.create("char-1", None, "Solo", "You", user_id="owner-1")
    session = await chat_service._own_session(sid, {"id": "owner-1"})
    assert session["id"] == sid
    assert await sp.list_for_session(sid) == []

async def test_solo_memory_extraction_shape_unaffected(db_conn):
    batch = [
        ({"content": "I look around.", "sender_user_id": None},
         {"content": "Dust hangs in still air.", "char_id": None}),
    ]
    transcript = _transcript(batch, "Narrator", "You")
    assert transcript == "You: I look around.\nNarrator: Dust hangs in still air."
    participants = present_participants("Narrator", ["You"], [], transcript)
    assert participants == ["You", "Narrator"]

async def test_run_tags_each_user_message_with_speaker_name_for_llm(db_conn, monkeypatch):
    captured = {}

    async def fake_chat_stream(messages, *args, **kwargs):
        captured["messages"] = messages
        return
        yield

    monkeypatch.setattr(chat_service.llm, "chat_stream", fake_chat_stream)
    char = await characters.create({"owner_id": "owner-1", "name": "Narrator", "mode": "rpg"})
    sid = await chat_sessions.create(char["id"], None, "Party", "Host", user_id="owner-1")
    await sp.add(sid, "owner-1", None, "host")
    await sp.add(sid, "friend-1", None, "member")
    await chat_sessions.add_message(sid, "user", "I look around.", user_name="Tanaki", sender_user_id="friend-1")
    await chat_sessions.add_message(sid, "assistant", "The room is quiet.")
    await chat_service._run(sid, user_content="I nod.", current_user={"id": "owner-1"})
    await chat_service._active_gen[sid].task
    user_contents = [m["content"] for m in captured["messages"] if m["role"] == "user"]
    assert any(c.startswith("[Tanaki] ") for c in user_contents)

async def test_run_bans_voicing_other_players_persona_in_system_prompt(db_conn, monkeypatch):
    captured = {}

    async def fake_chat_stream(messages, *args, **kwargs):
        captured["messages"] = messages
        return
        yield

    monkeypatch.setattr(chat_service.llm, "chat_stream", fake_chat_stream)
    char = await characters.create({"owner_id": "owner-1", "name": "Narrator", "mode": "rpg"})
    sid = await chat_sessions.create(char["id"], None, "Party", "Host", user_id="owner-1")
    host_persona = await personas.create({"name": "Tarion Bluerose"}, user_id="owner-1")
    friend_persona = await personas.create({"name": "Tanaki Honezuki"}, user_id="friend-1")
    await sp.add(sid, "owner-1", host_persona["id"], "host")
    await sp.add(sid, "friend-1", friend_persona["id"], "member")
    await chat_service._run(sid, user_content="I sigh and hand her a sealed envelope.",
                            current_user={"id": "owner-1"})
    await chat_service._active_gen[sid].task
    system_content = captured["messages"][0]["content"]
    assert "Other real players in this scene control: Tanaki Honezuki" in system_content
    assert "never write their dialogue" in system_content.lower()

async def test_run_solo_session_does_not_tag_speaker_name(db_conn, monkeypatch):
    captured = {}

    async def fake_chat_stream(messages, *args, **kwargs):
        captured["messages"] = messages
        return
        yield

    monkeypatch.setattr(chat_service.llm, "chat_stream", fake_chat_stream)
    char = await characters.create({"owner_id": "owner-1", "name": "Narrator", "mode": "rpg"})
    sid = await chat_sessions.create(char["id"], None, "Solo", "You", user_id="owner-1")
    await chat_service._run(sid, user_content="I look around.", current_user={"id": "owner-1"})
    await chat_service._active_gen[sid].task
    user_contents = [m["content"] for m in captured["messages"] if m["role"] == "user"]
    assert all(not c.startswith("[") for c in user_contents)
