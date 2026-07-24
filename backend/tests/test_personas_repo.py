import pytest

from backend.repositories import personas

pytestmark = pytest.mark.asyncio

async def _make_persona(db_conn, name="Test Persona", user_id="user-a", **extra):
    return await personas.create({"name": name, "description": "desc", **extra}, user_id)

async def test_create_and_get(db_conn):
    p = await _make_persona(db_conn, name="Alice")
    fetched = await personas.get(p["id"])
    assert fetched["id"] == p["id"]
    assert fetched["name"] == "Alice"
    assert fetched["description"] == "desc"

async def test_get_missing_returns_none(db_conn):
    assert await personas.get("nonexistent") is None

async def test_list_own_excludes_drafts_and_source_char(db_conn):
    own = await _make_persona(db_conn, name="Own", user_id="user-a")
    draft = await _make_persona(db_conn, name="Draft", user_id="user-a", is_draft=True)
    rows = await personas.list_own(user_id="user-a")
    ids = {r["id"] for r in rows}
    assert own["id"] in ids
    assert draft["id"] not in ids

async def test_list_own_excludes_session_exclusive(db_conn):
    global_persona = await _make_persona(db_conn, name="Global", user_id="user-a")
    session_persona = await _make_persona(db_conn, name="SessionOnly", user_id="user-a", session_id="sess-1")
    rows = await personas.list_own(user_id="user-a")
    ids = {r["id"] for r in rows}
    assert global_persona["id"] in ids
    assert session_persona["id"] not in ids

async def test_list_own_for_session_includes_global_and_matching_session(db_conn):
    global_persona = await _make_persona(db_conn, name="Global", user_id="user-a")
    session_persona = await _make_persona(db_conn, name="SessionOnly", user_id="user-a", session_id="sess-1")
    other_session_persona = await _make_persona(db_conn, name="OtherSession", user_id="user-a", session_id="sess-2")
    rows = await personas.list_own_for_session("user-a", "sess-1")
    ids = {r["id"] for r in rows}
    assert global_persona["id"] in ids
    assert session_persona["id"] in ids
    assert other_session_persona["id"] not in ids

async def test_list_drafts(db_conn):
    draft = await _make_persona(db_conn, name="Draft", user_id="user-a", is_draft=True)
    rows = await personas.list_drafts(user_id="user-a")
    ids = {r["id"] for r in rows}
    assert draft["id"] in ids

async def test_default_persona_only_default(db_conn):
    await _make_persona(db_conn, name="NonDefault", user_id="user-a")
    default = await _make_persona(db_conn, name="Default", user_id="user-a", is_default=True)
    result = await personas.default(user_id="user-a")
    assert result["id"] == default["id"]

async def test_update(db_conn):
    p = await _make_persona(db_conn, name="Before")
    updated = await personas.update(p["id"], {"name": "After"}, user_id="user-a")
    assert updated["name"] == "After"

async def test_update_missing_returns_none(db_conn):
    assert await personas.update("nonexistent", {"name": "x"}, user_id="user-a") is None

async def test_delete(db_conn):
    p = await _make_persona(db_conn, name="ToDelete")
    await personas.delete(p["id"])
    assert await personas.get(p["id"]) is None

async def test_create_persists_avatar(db_conn):
    p = await _make_persona(db_conn, name="Avatar Test", avatar="/media/p.png")
    fetched = await personas.get(p["id"])
    assert fetched["avatar"] == "/media/p.png"

async def test_update_persists_avatar(db_conn):
    p = await _make_persona(db_conn, name="No Avatar")
    updated = await personas.update(p["id"], {"avatar": "/media/new.png"}, user_id="user-a")
    assert updated["avatar"] == "/media/new.png"

async def test_get_or_create_from_lore_dedups_per_owner(db_conn):
    entry = {"id": "lore-1", "name": "Urabel", "content": "An alchemist.", "image": "/media/u.png"}
    first = await personas.get_or_create_from_lore(entry, user_id="user-a")
    second = await personas.get_or_create_from_lore(entry, user_id="user-a")
    assert first["id"] == second["id"]
    assert first["name"] == "Urabel"
    assert first["avatar"] == "/media/u.png"
    assert first["description"] == "An alchemist."

async def test_get_or_create_from_lore_separate_per_owner(db_conn):
    entry = {"id": "lore-2", "name": "Urabel", "content": "An alchemist.", "image": ""}
    mine = await personas.get_or_create_from_lore(entry, user_id="user-a")
    theirs = await personas.get_or_create_from_lore(entry, user_id="user-b")
    assert mine["id"] != theirs["id"]
