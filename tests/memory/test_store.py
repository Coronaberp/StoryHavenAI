import os
import uuid
import pytest
import pytest_asyncio

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="needs DATABASE_URL"),
]

VEC_A = [1.0] + [0.0] * 767
VEC_B = [0.0, 1.0] + [0.0] * 766


def _fact(sid, **kw):
    base = {"session_id": sid, "char_id": "char-test", "text": "Mira was stabbed in the shoulder.",
            "fact_type": "state", "participants": ["Mira"], "importance": 5, "valence": -2, "turn": 10}
    base.update(kw)
    return base


@pytest_asyncio.fixture()
async def store():
    from backend import db
    from backend.state import CFG
    from backend.repositories import memory_facts
    await db.init()
    await memory_facts.ensure_tables(CFG["embed_dim"])
    sid = "test-mem-" + uuid.uuid4().hex[:8]
    yield memory_facts, sid
    await memory_facts.purge_session(sid)


async def test_insert_and_similar_live(store):
    repo, sid = store
    fid = await repo.insert(_fact(sid), VEC_A)
    rows = await repo.similar_live(sid, VEC_A, 5)
    assert [r["id"] for r in rows] == [fid]
    assert rows[0]["distance"] < 0.01
    assert rows[0]["valid_until_turn"] is None
    assert "embedding" not in rows[0]


async def test_reinforce_bumps_counters(store):
    repo, sid = store
    fid = await repo.insert(_fact(sid), VEC_A)
    await repo.reinforce(fid, 20)
    row = (await repo.similar_live(sid, VEC_A, 1))[0]
    assert row["reinforcements"] == 1
    assert row["last_turn"] == 20


async def test_supersede_closes_validity_but_stays_live(store):
    repo, sid = store
    old = await repo.insert(_fact(sid, text="Mira trusts the captain.", fact_type="relationship"), VEC_A)
    new = await repo.supersede(old, _fact(sid, text="Mira despises the captain.",
                                          fact_type="relationship", turn=30), VEC_B, 30)
    rows = {r["id"]: r for r in await repo.similar_live(sid, VEC_A, 5)}
    assert set(rows) == {old, new}
    assert rows[old]["valid_until_turn"] == 30
    assert rows[old]["superseded_by"] == new
    assert rows[old]["expired_ts"] is None
    assert rows[new]["valid_until_turn"] is None


async def test_reserved_returns_open_states_and_pinned_only(store):
    repo, sid = store
    open_state = await repo.insert(_fact(sid), VEC_A)
    closed = await repo.insert(_fact(sid, text="Mira had a fever."), VEC_B)
    await repo.supersede(closed, _fact(sid, text="Mira recovered.", fact_type="event", turn=15), VEC_B, 15)
    await repo.insert(_fact(sid, text="They met at dawn.", fact_type="event"), VEC_B)
    got = {r["id"] for r in await repo.reserved(sid)}
    assert open_state in got
    assert closed not in got


async def test_cursor_roundtrip(store):
    repo, sid = store
    assert await repo.get_cursor(sid) == 0
    await repo.set_cursor(sid, 15)
    assert await repo.get_cursor(sid) == 15
    await repo.set_cursor(sid, 20)
    assert await repo.get_cursor(sid) == 20
