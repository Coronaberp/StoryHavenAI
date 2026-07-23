import pytest
import pytest_asyncio

from backend import db
from backend.repositories import forum as forum_thread_repo
from backend.repositories import comments as comment_repo

pytestmark = pytest.mark.asyncio

# list_all/get inner-join against the users table (see
# ForumThreadRepository), so author ids must be real users.
CLAUDE_ID = "u016863391b2a"
TEST_ID = "ucb203e5d3fe9"


@pytest_asyncio.fixture(autouse=True)
async def _ensure_fernet():
    if db._fernet is None:
        await db.init()


async def test_create_and_get(db_conn):
    tid = await forum_thread_repo.create(CLAUDE_ID, "Hello Thread", "Body text", "general")
    thread = await forum_thread_repo.get(tid)
    assert thread["title"] == "Hello Thread"
    assert thread["content"] == "Body text"
    assert thread["category"] == "general"
    assert thread["score"] == 0
    assert thread["reply_count"] == 0


async def test_get_missing_returns_none(db_conn):
    assert await forum_thread_repo.get("nonexistent") is None


async def test_list_all_category_filter_and_sort(db_conn):
    t1 = await forum_thread_repo.create(CLAUDE_ID, "General A", "body", "general")
    t2 = await forum_thread_repo.create(CLAUDE_ID, "Other B", "body", "other")

    general_only = await forum_thread_repo.list_all(set(), category="general")
    ids = {t["id"] for t in general_only}
    assert t1 in ids
    assert t2 not in ids


async def test_list_all_excludes_hidden_authors(db_conn):
    visible = await forum_thread_repo.create(CLAUDE_ID, "Visible", "body")
    hidden = await forum_thread_repo.create(TEST_ID, "Hidden", "body")

    threads = await forum_thread_repo.list_all({TEST_ID})
    ids = {t["id"] for t in threads}
    assert visible in ids
    assert hidden not in ids


async def test_vote_unvote(db_conn):
    tid = await forum_thread_repo.create(CLAUDE_ID, "Votable", "body")
    await forum_thread_repo.vote(tid, TEST_ID, 1)
    thread = await forum_thread_repo.get(tid, viewer_id=TEST_ID)
    assert thread["score"] == 1
    assert thread["my_vote"] == 1

    await forum_thread_repo.vote(tid, TEST_ID, -1)  # changes the same vote, doesn't stack
    thread = await forum_thread_repo.get(tid, viewer_id=TEST_ID)
    assert thread["score"] == -1
    assert thread["my_vote"] == -1

    await forum_thread_repo.unvote(tid, TEST_ID)
    thread = await forum_thread_repo.get(tid, viewer_id=TEST_ID)
    assert thread["score"] == 0
    assert thread["my_vote"] == 0


async def test_reply_count_via_comments(db_conn):
    tid = await forum_thread_repo.create(CLAUDE_ID, "With replies", "body")
    await comment_repo.create("thread", tid, TEST_ID, None, "a reply")
    thread = await forum_thread_repo.get(tid)
    assert thread["reply_count"] == 1


async def test_delete_cascades_replies_and_likes(db_conn):
    tid = await forum_thread_repo.create(CLAUDE_ID, "To delete", "body")
    cid = await comment_repo.create("thread", tid, TEST_ID, None, "reply")
    await forum_thread_repo.vote(tid, TEST_ID, 1)

    await forum_thread_repo.delete(tid)
    assert await forum_thread_repo.get(tid) is None
    assert await comment_repo.get(cid) is None
