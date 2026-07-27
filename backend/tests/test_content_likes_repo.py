import pytest
import pytest_asyncio

from backend import db
from backend.repositories import content_likes as content_like_repo

pytestmark = pytest.mark.asyncio

CLAUDE_ID = "u016863391b2a"
TEST_ID = "ucb203e5d3fe9"

@pytest_asyncio.fixture(autouse=True)
async def _ensure_fernet():
    if db._fernet is None:
        await db.init()

async def test_like_unlike_and_count(db_conn):
    assert await content_like_repo.like_count("character", "char-like-1") == 0

    await content_like_repo.like("character", "char-like-1", TEST_ID)
    assert await content_like_repo.like_count("character", "char-like-1") == 1
    await content_like_repo.like("character", "char-like-1", TEST_ID)
    assert await content_like_repo.like_count("character", "char-like-1") == 1

    await content_like_repo.unlike("character", "char-like-1", TEST_ID)
    assert await content_like_repo.like_count("character", "char-like-1") == 0

async def test_has_liked(db_conn):
    assert await content_like_repo.has_liked("group", "grp-like-1", TEST_ID) is False
    await content_like_repo.like("group", "grp-like-1", TEST_ID)
    assert await content_like_repo.has_liked("group", "grp-like-1", TEST_ID) is True
    assert await content_like_repo.has_liked("group", "grp-like-1", CLAUDE_ID) is False

async def test_like_is_scoped_by_target_type(db_conn):
    await content_like_repo.like("character", "shared-id", TEST_ID)
    assert await content_like_repo.has_liked("image", "shared-id", TEST_ID) is False
    assert await content_like_repo.like_count("image", "shared-id") == 0

async def test_list_liked_by_user(db_conn):
    await content_like_repo.like("character", "char-like-2", TEST_ID)
    await content_like_repo.like("image", "img-like-2", TEST_ID)
    await content_like_repo.like("group", "grp-like-2", CLAUDE_ID)

    all_likes = await content_like_repo.list_liked_by_user(TEST_ID)
    target_ids = {(r["target_type"], r["target_id"]) for r in all_likes}
    assert ("character", "char-like-2") in target_ids
    assert ("image", "img-like-2") in target_ids
    assert ("group", "grp-like-2") not in target_ids

    only_images = await content_like_repo.list_liked_by_user(TEST_ID, target_type="image")
    assert len(only_images) == 1
    assert only_images[0]["target_id"] == "img-like-2"

async def test_unlike_missing_like_is_noop(db_conn):
    await content_like_repo.unlike("character", "never-liked", TEST_ID)
    assert await content_like_repo.like_count("character", "never-liked") == 0
