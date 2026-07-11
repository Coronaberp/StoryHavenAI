import pytest
from cryptography.fernet import Fernet

from backend import db
from backend.repositories import content_reports as content_report_repo

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _ensure_fernet():
    if db._fernet is None:
        db._fernet = Fernet(Fernet.generate_key())


async def test_content_report_create_get_list_resolve(db_conn):
    rep = await content_report_repo.create("character", "some char", "char-1", "", "user-1", "note text")
    rid = rep["id"]
    assert rep["status"] == "pending"

    fetched = await content_report_repo.get(rid)
    assert fetched["kind"] == "character"

    pending = await content_report_repo.get_pending_for("user-1", "character", "char-1")
    assert pending["id"] == rid

    rows = await content_report_repo.list(pending_only=True)
    assert any(r["id"] == rid for r in rows)

    await content_report_repo.resolve(rid)
    resolved = await content_report_repo.get(rid)
    assert resolved["status"] == "resolved"
    assert resolved["resolved_at"] is not None

    assert await content_report_repo.get_pending_for("user-1", "character", "char-1") is None
    assert await content_report_repo.get("nonexistent") is None
