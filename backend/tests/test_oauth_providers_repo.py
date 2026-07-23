import pytest
from sqlalchemy import select

from backend import db
from backend.repositories import oauth_providers as provider_repo

pytestmark = pytest.mark.asyncio


async def test_oauth_providers_table_exists(db_conn):
    result = await db._q(select(db.oauth_providers).limit(0))
    assert result == []


async def test_upsert_and_get(db_conn):
    await provider_repo.upsert("google", "client-123", "secret-abc", True)
    row = await provider_repo.get("google")
    assert row["provider"] == "google"
    assert row["client_id"] == "client-123"
    assert row["client_secret"] == "secret-abc"
    assert row["enabled"] is True


async def test_upsert_overwrites(db_conn):
    await provider_repo.upsert("github", "id-1", "secret-1", True)
    await provider_repo.upsert("github", "id-2", "secret-2", False)
    row = await provider_repo.get("github")
    assert row["client_id"] == "id-2"
    assert row["client_secret"] == "secret-2"
    assert row["enabled"] is False


async def test_upsert_keeps_existing_secret_when_none_passed(db_conn):
    await provider_repo.upsert("discord", "id-1", "secret-1", True)
    await provider_repo.upsert("discord", "id-1-new", None, True)
    row = await provider_repo.get("discord")
    assert row["client_id"] == "id-1-new"
    assert row["client_secret"] == "secret-1"


async def test_upsert_stores_encrypted_secret(db_conn):
    plaintext = "super-secret-value"
    await provider_repo.upsert("google", "client-123", plaintext, True)
    row = await db._q1(select(db.oauth_providers).where(db.oauth_providers.c.provider == "google"))
    raw_secret = dict(row)["client_secret"]
    assert raw_secret.startswith("enc:")
    assert raw_secret != plaintext


async def test_get_missing_returns_none(db_conn):
    assert await provider_repo.get("not-configured") is None


async def test_list_all(db_conn):
    await provider_repo.upsert("google", "id", "secret", True)
    await provider_repo.upsert("github", "id", "secret", False)
    rows = await provider_repo.list_all()
    providers = {r["provider"] for r in rows}
    assert providers == {"google", "github"}


async def test_list_enabled_excludes_disabled(db_conn):
    await provider_repo.upsert("google", "id", "secret", True)
    await provider_repo.upsert("github", "id", "secret", False)
    rows = await provider_repo.list_enabled()
    assert [r["provider"] for r in rows] == ["google"]


async def test_list_enabled_excludes_missing_client_id(db_conn):
    await provider_repo.upsert("google", "", "secret", True)
    rows = await provider_repo.list_enabled()
    assert rows == []


async def test_list_enabled_excludes_missing_secret(db_conn):
    await provider_repo.upsert("google", "client-id", None, True)
    rows = await provider_repo.list_enabled()
    assert rows == []
