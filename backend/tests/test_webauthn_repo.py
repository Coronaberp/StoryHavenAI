import pytest

from backend.repositories import webauthn_credentials as creds

pytestmark = pytest.mark.asyncio


async def _make(db_conn, user_id="user-a", credential_id="cred-1"):
    return await creds.create(user_id, credential_id, "pubkey-b64", 0, "internal", "aaguid-1", "My phone")


async def test_create_and_list(db_conn):
    cid = await _make(db_conn)
    rows = await creds.list_for_user("user-a")
    assert [r["id"] for r in rows] == [cid]
    assert rows[0]["nickname"] == "My phone"
    assert rows[0]["sign_count"] == 0


async def test_get_by_credential_id(db_conn):
    await _make(db_conn, credential_id="cred-xyz")
    found = await creds.get_by_credential_id("cred-xyz")
    assert found and found["user_id"] == "user-a"
    assert await creds.get_by_credential_id("nope") is None


async def test_mark_used_updates_sign_count_and_last_used(db_conn):
    cid = await _make(db_conn)
    await creds.mark_used(cid, 7)
    row = (await creds.list_for_user("user-a"))[0]
    assert row["sign_count"] == 7
    assert row["last_used"] is not None


async def test_delete_scoped_to_owner(db_conn):
    cid = await _make(db_conn)
    assert await creds.delete(cid, "user-b") is False
    assert await creds.delete(cid, "user-a") is True
    assert await creds.list_for_user("user-a") == []


async def test_count_for_user(db_conn):
    await _make(db_conn, credential_id="c1")
    await _make(db_conn, credential_id="c2")
    assert await creds.count_for_user("user-a") == 2
    assert await creds.count_for_user("user-b") == 0
