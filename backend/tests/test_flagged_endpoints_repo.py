import pytest
from cryptography.fernet import Fernet

from backend import db
from backend.repositories import flagged_endpoints as flagged_endpoint_repo

pytestmark = pytest.mark.asyncio

@pytest.fixture(autouse=True)
def _ensure_fernet():
    if db._fernet is None:
        db._fernet = Fernet(Fernet.generate_key())

async def test_flagged_endpoint_create_get_list_set_status(db_conn):
    fid = await flagged_endpoint_repo.create("user-1", "http://example.com", "secret-key", "suspicious", "detail text")
    entry = await flagged_endpoint_repo.get(fid)
    assert entry["id"] == fid
    assert entry["url"] == "http://example.com"
    assert entry["api_key"] == "secret-key"
    assert entry["reason"] == "suspicious"
    assert entry["status"] == "pending"

    rows = await flagged_endpoint_repo.list(pending_only=True)
    assert any(r["id"] == fid for r in rows)
    listed = next(r for r in rows if r["id"] == fid)
    assert "api_key" not in listed
    assert listed["has_api_key"] is True

    await flagged_endpoint_repo.set_status(fid, "blocked")
    updated = await flagged_endpoint_repo.get(fid)
    assert updated["status"] == "blocked"
    assert await flagged_endpoint_repo.get("nonexistent") is None
