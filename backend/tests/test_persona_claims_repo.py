import pytest

pytestmark = pytest.mark.asyncio

async def test_session_persona_claims_table_exists():
    from backend.db import session_persona_claims
    assert session_persona_claims.name == "session_persona_claims"
    cols = {c.name for c in session_persona_claims.columns}
    assert cols == {"session_id", "persona_id", "user_id", "status", "claimed_at", "vacated_at"}

async def test_claim_creates_a_claimed_row(db_conn):
    from backend.repositories import persona_claims
    await persona_claims.claim("sess-1", "persona-a", "user-1")
    row = await persona_claims.get_claim_for_user("sess-1", "user-1")
    assert row["persona_id"] == "persona-a"
    assert row["status"] == "claimed"
    assert row["vacated_at"] is None

async def test_claim_vacates_this_users_previous_claim_in_the_same_session(db_conn):
    from backend.repositories import persona_claims
    await persona_claims.claim("sess-2", "persona-a", "user-1")
    await persona_claims.claim("sess-2", "persona-b", "user-1")
    claimed = await persona_claims.list_claimed("sess-2")
    assert len(claimed) == 1
    assert claimed[0]["persona_id"] == "persona-b"

async def test_vacate_by_user_flips_status_and_sets_timestamp(db_conn):
    from backend.repositories import persona_claims
    await persona_claims.claim("sess-3", "persona-a", "user-1")
    await persona_claims.vacate_by_user("sess-3", "user-1")
    assert await persona_claims.get_claim_for_user("sess-3", "user-1") is None
    assert await persona_claims.list_claimed("sess-3") == []

async def test_vacate_by_user_with_no_claim_is_a_noop(db_conn):
    from backend.repositories import persona_claims
    await persona_claims.vacate_by_user("sess-4", "user-nobody")
    assert await persona_claims.get_claim_for_user("sess-4", "user-nobody") is None

async def test_restore_on_rejoin_reactivates_the_most_recent_vacated_claim(db_conn):
    from backend.repositories import persona_claims
    await persona_claims.claim("sess-5", "persona-a", "user-1")
    await persona_claims.vacate_by_user("sess-5", "user-1")
    restored = await persona_claims.restore_on_rejoin("sess-5", "user-1")
    assert restored is True
    row = await persona_claims.get_claim_for_user("sess-5", "user-1")
    assert row["persona_id"] == "persona-a"
    assert row["status"] == "claimed"
    assert row["vacated_at"] is None

async def test_restore_on_rejoin_with_nothing_to_restore_returns_false(db_conn):
    from backend.repositories import persona_claims
    restored = await persona_claims.restore_on_rejoin("sess-6", "user-nobody")
    assert restored is False

async def test_list_protected_names_excludes_vacated_and_excluded_persona(db_conn):
    from backend.repositories import personas as personas_repo
    from backend.repositories import persona_claims
    p_a = await personas_repo.create({"name": "Anna", "session_id": "sess-7"}, "user-1")
    p_b = await personas_repo.create({"name": "Beth", "session_id": "sess-7"}, "user-2")
    p_c = await personas_repo.create({"name": "Cara", "session_id": "sess-7"}, "user-3")
    await persona_claims.claim("sess-7", p_a["id"], "user-1")
    await persona_claims.claim("sess-7", p_b["id"], "user-2")
    await persona_claims.vacate_by_user("sess-7", "user-2")
    names = await persona_claims.list_protected_names("sess-7", exclude_persona_id=p_c["id"])
    assert names == ["Anna"]

async def test_list_absent_names_returns_only_vacated(db_conn):
    from backend.repositories import personas as personas_repo
    from backend.repositories import persona_claims
    p_a = await personas_repo.create({"name": "Anna", "session_id": "sess-8"}, "user-1")
    p_b = await personas_repo.create({"name": "Beth", "session_id": "sess-8"}, "user-2")
    await persona_claims.claim("sess-8", p_a["id"], "user-1")
    await persona_claims.claim("sess-8", p_b["id"], "user-2")
    await persona_claims.vacate_by_user("sess-8", "user-2")
    assert await persona_claims.list_absent_names("sess-8") == ["Beth"]
