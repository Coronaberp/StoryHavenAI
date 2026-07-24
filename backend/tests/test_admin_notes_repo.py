import pytest
import pytest_asyncio

from backend import db
from backend.repositories import admin_notes as admin_note_repo

pytestmark = pytest.mark.asyncio

CLAUDE_ID = "u016863391b2a"
TEST_ID = "ucb203e5d3fe9"

@pytest_asyncio.fixture(autouse=True)
async def _ensure_fernet():
    if db._fernet is None:
        await db.init()

async def test_admin_note_create_list_delete(db_conn):
    note = await admin_note_repo.create(TEST_ID, CLAUDE_ID, "flagged for review")
    assert note["note"] == "flagged for review"

    notes = await admin_note_repo.list_for_user(TEST_ID)
    assert any(n["id"] == note["id"] for n in notes)
    found = next(n for n in notes if n["id"] == note["id"])
    assert found["author_username"] == "claude"

    await admin_note_repo.delete(note["id"])
    notes = await admin_note_repo.list_for_user(TEST_ID)
    assert not any(n["id"] == note["id"] for n in notes)
