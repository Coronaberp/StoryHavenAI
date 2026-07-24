import pytest
from cryptography.fernet import Fernet

from backend import db
from backend.repositories import password_reset_requests as password_reset_request_repo

pytestmark = pytest.mark.asyncio

@pytest.fixture(autouse=True)
def _ensure_fernet():
    if db._fernet is None:
        db._fernet = Fernet(Fernet.generate_key())

async def test_password_reset_request_create_get_list_set_status(db_conn):
    rid = await password_reset_request_repo.create("user-1", "someuser")
    entry = await password_reset_request_repo.get(rid)
    assert entry["id"] == rid
    assert entry["username"] == "someuser"
    assert entry["status"] == "pending"

    rows = await password_reset_request_repo.list(pending_only=True)
    assert any(r["id"] == rid for r in rows)

    await password_reset_request_repo.set_status(rid, "approved")
    updated = await password_reset_request_repo.get(rid)
    assert updated["status"] == "approved"
    assert await password_reset_request_repo.get("nonexistent") is None
