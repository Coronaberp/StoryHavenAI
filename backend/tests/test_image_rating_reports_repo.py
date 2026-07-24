import pytest
import pytest_asyncio

from backend import db
from backend.repositories import standalone_images as standalone_image_repo
from backend.repositories import image_rating_reports as image_rating_report_repo

pytestmark = pytest.mark.asyncio

@pytest_asyncio.fixture(autouse=True)
async def _ensure_fernet():
    if db._fernet is None:
        await db.init()

async def _make_image(db_conn, user_id="test-user", **overrides):
    kwargs = dict(positive="a cat", negative="blurry")
    kwargs.update(overrides)
    return await standalone_image_repo.create(user_id, "/media/test.png", **kwargs)

async def test_rating_report_create_get_list_resolve(db_conn):
    img = await _make_image(db_conn, user_id="user-a")
    report = await image_rating_report_repo.create(img["id"], "user-b", True, note="looks off")
    assert report["status"] == "pending"

    fetched = await image_rating_report_repo.get(report["id"])
    assert fetched["note"] == "looks off"
    assert fetched["claimed_explicit"] is True

    pending = await image_rating_report_repo.list(pending_only=True)
    assert any(r["id"] == report["id"] for r in pending)

    await image_rating_report_repo.resolve(report["id"], "reviewed, fine")
    resolved = await image_rating_report_repo.get(report["id"])
    assert resolved["status"] == "resolved"
    assert resolved["admin_note"] == "reviewed, fine"

    pending_after = await image_rating_report_repo.list(pending_only=True)
    assert not any(r["id"] == report["id"] for r in pending_after)
