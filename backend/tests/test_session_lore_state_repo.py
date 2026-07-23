import pytest

from backend.repositories import lore, session_lore_state as sls

pytestmark = pytest.mark.asyncio


async def _make_lore(db_conn, name="a"):
    return await lore.create(None, [], "content", always=False, name=name)


async def test_get_state_missing_returns_none(db_conn):
    a = await _make_lore(db_conn)
    assert await sls.get_state("sess-1", a) is None


async def test_set_override_creates_state(db_conn):
    a = await _make_lore(db_conn)
    await sls.set_override("sess-1", a, "new content", "mf-123")
    state = await sls.get_state("sess-1", a)
    assert state["override_content"] == "new content"
    assert state["override_fact_id"] == "mf-123"


async def test_set_override_updates_existing_state(db_conn):
    a = await _make_lore(db_conn)
    await sls.set_override("sess-1", a, "first", "mf-1")
    await sls.set_override("sess-1", a, "second", "mf-1")
    state = await sls.get_state("sess-1", a)
    assert state["override_content"] == "second"


async def test_clear_override_returns_fact_id_and_clears(db_conn):
    a = await _make_lore(db_conn)
    await sls.set_override("sess-1", a, "content", "mf-123")
    cleared = await sls.clear_override("sess-1", a)
    assert cleared == "mf-123"
    state = await sls.get_state("sess-1", a)
    assert state["override_content"] is None
    assert state["override_fact_id"] is None


async def test_clear_override_missing_returns_none(db_conn):
    a = await _make_lore(db_conn)
    assert await sls.clear_override("sess-1", a) is None


async def test_override_scoped_to_session(db_conn):
    a = await _make_lore(db_conn)
    await sls.set_override("sess-1", a, "content", "mf-1")
    assert await sls.get_state("sess-2", a) is None


async def test_get_all_overrides_for_session_returns_only_active_overrides(db_conn):
    await sls.set_override("sess-bulk", "lore-a", "override A", "mf-a")
    await sls.set_override("sess-bulk", "lore-b", "override B", "mf-b")
    await sls.clear_override("sess-bulk", "lore-b")
    result = await sls.get_all_overrides_for_session("sess-bulk")
    assert result == {"lore-a": "override A"}
