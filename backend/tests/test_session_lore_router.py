import os

import pytest
from fastapi import HTTPException

from backend import ai_helpers, llm
from backend.repositories import chat_sessions, characters as characters_repo, lore, lore_secrets as ls, memory_facts
from backend.schemas import SessionLoreOverrideIn

pytestmark = pytest.mark.asyncio

_EMBED_DIM = int(os.environ.get("EMBED_DIM", "1024"))

@pytest.fixture(autouse=True)
def _ensure_memory_facts_table():
    memory_facts.build_tables(_EMBED_DIM)

async def _fake_secrets(monkeypatch, facts):
    async def fake_extract(content, chat_model, chat_base=None, chat_key=None):
        return facts
    monkeypatch.setattr(ai_helpers, "extract_lore_secrets", fake_extract)

async def _fake_embed(monkeypatch):
    async def fake(text, model, base_url=None, api_key=None):
        return [0.1] * _EMBED_DIM
    monkeypatch.setattr(llm, "embed", fake)

async def _make_session(db_conn, hidden_content="she likes sweets but hates cake"):
    char = await characters_repo.create({"owner_id": "user-a", "name": "Char A"})
    visible_id = await lore.create(char["id"], [], "always visible", always=False, name="Visible", hidden=False)
    hidden_id = await lore.create(char["id"], [], hidden_content, always=False, name="Hidden", hidden=True)
    sid = await chat_sessions.create(char["id"], None, "Chat", "You", user_id="user-a")
    return char, sid, visible_id, hidden_id

async def test_list_session_lore_excludes_unrevealed_hidden(db_conn):
    from backend.routers.session_lore import list_session_lore

    char, sid, visible_id, hidden_id = await _make_session(db_conn)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}

    entries = await list_session_lore(sid, current_user=owner)
    ids = {e["id"] for e in entries}
    assert visible_id in ids
    assert hidden_id not in ids

async def test_list_hidden_session_lore_shows_name_never_content(db_conn, monkeypatch):
    from backend.routers.session_lore import list_hidden_session_lore

    await _fake_secrets(monkeypatch, ["a secret"])
    char, sid, visible_id, hidden_id = await _make_session(db_conn, hidden_content="the raw secret prose")
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}

    hidden = await list_hidden_session_lore(sid, current_user=owner)
    assert len(hidden) == 1
    assert hidden[0]["id"] == hidden_id
    assert set(hidden[0].keys()) == {"id", "name", "category"}
    assert "the raw secret prose" not in str(hidden[0])

async def test_get_secrets_never_sends_unrevealed_text(db_conn, monkeypatch):
    from backend.routers.session_lore import get_lore_secrets

    await _fake_secrets(monkeypatch, ["She has a sweet tooth", "She dislikes cake"])
    char, sid, visible_id, hidden_id = await _make_session(db_conn)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}

    secrets = await get_lore_secrets(sid, hidden_id, current_user=owner)
    assert len(secrets) == 2
    assert all(s["revealed"] is False for s in secrets)
    assert all(s["text"] is None for s in secrets)

async def test_reveal_one_secret_does_not_reveal_the_other(db_conn, monkeypatch):
    from backend.routers.session_lore import get_lore_secrets, reveal_lore_secret, list_session_lore

    await _fake_secrets(monkeypatch, ["She has a sweet tooth", "She dislikes cake"])
    char, sid, visible_id, hidden_id = await _make_session(db_conn)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}

    secrets = await get_lore_secrets(sid, hidden_id, current_user=owner)
    sweet_tooth_id = next(s["id"] for s in secrets)

    await reveal_lore_secret(sid, hidden_id, sweet_tooth_id, current_user=owner)
    after = await get_lore_secrets(sid, hidden_id, current_user=owner)
    revealed = [s for s in after if s["revealed"]]
    unrevealed = [s for s in after if not s["revealed"]]
    assert len(revealed) == 1
    assert revealed[0]["text"] == "She has a sweet tooth"
    assert len(unrevealed) == 1
    assert unrevealed[0]["text"] is None

    entries = await list_session_lore(sid, current_user=owner)
    hidden_entry = next(e for e in entries if e["id"] == hidden_id)
    assert "She has a sweet tooth" in hidden_entry["content"]
    assert "cake" not in hidden_entry["content"].lower()

async def test_reveal_rejects_secret_from_different_entry(db_conn, monkeypatch):
    from backend.routers.session_lore import get_lore_secrets, reveal_lore_secret

    await _fake_secrets(monkeypatch, ["fact one"])
    char, sid, visible_id, hidden_id = await _make_session(db_conn)
    other_hidden_id = await lore.create(char["id"], [], "other secret", always=False, name="Other", hidden=True)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}

    secrets = await get_lore_secrets(sid, hidden_id, current_user=owner)
    real_secret_id = secrets[0]["id"]

    with pytest.raises(HTTPException) as exc_info:
        await reveal_lore_secret(sid, other_hidden_id, real_secret_id, current_user=owner)
    assert exc_info.value.status_code == 404

async def test_reveal_rejects_wrong_owner(db_conn, monkeypatch):
    from backend.routers.session_lore import get_lore_secrets, reveal_lore_secret

    await _fake_secrets(monkeypatch, ["fact one"])
    char, sid, visible_id, hidden_id = await _make_session(db_conn)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}
    stranger = {"id": "user-b", "username": "user-b", "is_admin": False}

    secrets = await get_lore_secrets(sid, hidden_id, current_user=owner)
    real_secret_id = secrets[0]["id"]

    with pytest.raises(HTTPException) as exc_info:
        await reveal_lore_secret(sid, hidden_id, real_secret_id, current_user=stranger)
    assert exc_info.value.status_code == 404

async def test_override_works_regardless_of_memory_v2_flag(db_conn, monkeypatch):
    from backend.state import CFG
    from backend.routers.session_lore import set_session_lore_override

    async def fake_embed(*args, **kwargs):
        return [0.1] * 1024
    monkeypatch.setattr("backend.llm.embed", fake_embed)

    char, sid, visible_id, hidden_id = await _make_session(db_conn)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}
    original = CFG.get("memory_v2")
    CFG["memory_v2"] = False
    try:
        result = await set_session_lore_override(
            sid, visible_id, SessionLoreOverrideIn(content="new text"), current_user=owner)
        assert result == {"content": "new text"}
    finally:
        CFG["memory_v2"] = original

async def test_override_creates_pinned_fact_when_memory_v2_on(db_conn, monkeypatch):
    from backend.state import CFG
    from backend.repositories import memory_facts, session_lore_state as sls
    from backend.routers.session_lore import set_session_lore_override

    char, sid, visible_id, hidden_id = await _make_session(db_conn)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}
    original = CFG.get("memory_v2")
    CFG["memory_v2"] = True
    await _fake_embed(monkeypatch)
    try:
        result = await set_session_lore_override(sid, visible_id, SessionLoreOverrideIn(content="new text"),
                                                  current_user=owner)
        assert result["content"] == "new text"
        state = await sls.get_state(sid, visible_id)
        reserved = await memory_facts.reserved(sid)
        assert any(r["id"] == state["override_fact_id"] for r in reserved)
    finally:
        CFG["memory_v2"] = original

async def test_override_clear_expires_not_deletes(db_conn, monkeypatch):
    from backend.state import CFG
    from backend.repositories import session_lore_state as sls
    from backend.routers.session_lore import set_session_lore_override

    char, sid, visible_id, hidden_id = await _make_session(db_conn)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}
    original = CFG.get("memory_v2")
    CFG["memory_v2"] = True
    await _fake_embed(monkeypatch)
    try:
        await set_session_lore_override(sid, visible_id, SessionLoreOverrideIn(content="new text"),
                                        current_user=owner)
        result = await set_session_lore_override(sid, visible_id, SessionLoreOverrideIn(content=None),
                                                  current_user=owner)
        assert result["content"] is None
        state = await sls.get_state(sid, visible_id)
        assert state["override_fact_id"] is None
    finally:
        CFG["memory_v2"] = original

async def test_reveal_records_memory_fact_when_memory_v2_on(db_conn, monkeypatch):
    from backend.state import CFG
    from backend.repositories import memory_facts
    from backend.routers.session_lore import get_lore_secrets, reveal_lore_secret

    await _fake_secrets(monkeypatch, ["She has a sweet tooth"])
    await _fake_embed(monkeypatch)
    char, sid, visible_id, hidden_id = await _make_session(db_conn)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}
    original = CFG.get("memory_v2")
    CFG["memory_v2"] = True
    try:
        secrets = await get_lore_secrets(sid, hidden_id, current_user=owner)
        await reveal_lore_secret(sid, hidden_id, secrets[0]["id"], current_user=owner)
        candidates = await memory_facts.similar_live(sid, [0.1] * _EMBED_DIM, 10)
        assert any("sweet tooth" in c["text"] for c in candidates)
    finally:
        CFG["memory_v2"] = original

async def test_reveal_does_not_require_memory_v2(db_conn, monkeypatch):
    from backend.state import CFG
    from backend.routers.session_lore import get_lore_secrets, reveal_lore_secret

    await _fake_secrets(monkeypatch, ["fact one"])
    char, sid, visible_id, hidden_id = await _make_session(db_conn)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}
    original = CFG.get("memory_v2")
    CFG["memory_v2"] = False
    try:
        secrets = await get_lore_secrets(sid, hidden_id, current_user=owner)
        result = await reveal_lore_secret(sid, hidden_id, secrets[0]["id"], current_user=owner)
        assert result["revealed"] is True
    finally:
        CFG["memory_v2"] = original
