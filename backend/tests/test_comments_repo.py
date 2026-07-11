import pytest
import pytest_asyncio

from backend import db
from backend.repositories import comments as comment_repo

pytestmark = pytest.mark.asyncio

# comments/list_for_target and get_view inner-join against the users table
# (see CommentRepository.list_for_target), so author ids must be real
# users — these are the two fixed test accounts from CLAUDE.md.
CLAUDE_ID = "u016863391b2a"
TEST_ID = "ucb203e5d3fe9"


@pytest_asyncio.fixture(autouse=True)
async def _ensure_fernet():
    if db._fernet is None:
        await db.init()


async def test_create_get_update(db_conn):
    cid = await comment_repo.create("character", "char-1", CLAUDE_ID, None, "hello world")
    c = await comment_repo.get(cid)
    assert c["content"] == "hello world"
    assert c["target_type"] == "character"

    edited_at = await comment_repo.update(cid, "edited text")
    c = await comment_repo.get(cid)
    assert c["content"] == "edited text"
    assert c["edited_at"] == edited_at


async def test_get_missing_returns_none(db_conn):
    assert await comment_repo.get("nonexistent") is None


async def test_list_for_target_and_replies(db_conn):
    root = await comment_repo.create("character", "char-2", CLAUDE_ID, None, "root comment")
    reply = await comment_repo.create("character", "char-2", TEST_ID, root, "a reply")

    top = await comment_repo.list_for_target("character", "char-2")
    assert len(top) == 1
    assert top[0]["id"] == root
    assert top[0]["reply_count"] == 1
    assert top[0]["replies"][0]["id"] == reply


async def test_list_for_target_excludes_blocked_authors(db_conn):
    await comment_repo.create("character", "char-3", CLAUDE_ID, None, "visible")
    await comment_repo.create("character", "char-3", TEST_ID, None, "hidden")

    visible = await comment_repo.list_for_target("character", "char-3", blocked={TEST_ID})
    assert len(visible) == 1
    assert visible[0]["author_id"] == CLAUDE_ID


async def test_get_view(db_conn):
    cid = await comment_repo.create("character", "char-4", CLAUDE_ID, None, "view me")
    view = await comment_repo.get_view(cid, viewer_id=TEST_ID)
    assert view["id"] == cid
    assert view["liked_by_me"] is False
    assert view["like_count"] == 0


async def test_set_explicit(db_conn):
    cid = await comment_repo.create("character", "char-5", CLAUDE_ID, None, "img comment", image="/media/x.png")
    await comment_repo.set_explicit(cid)
    c = await comment_repo.get(cid)
    assert bool(c["image_is_explicit"]) is True


async def test_delete_cascades_to_replies_and_likes(db_conn):
    root = await comment_repo.create("character", "char-6", CLAUDE_ID, None, "root")
    reply = await comment_repo.create("character", "char-6", TEST_ID, root, "reply")
    await comment_repo.like(root, TEST_ID)

    await comment_repo.delete(root)
    assert await comment_repo.get(root) is None
    assert await comment_repo.get(reply) is None


async def test_like_unlike_and_count(db_conn):
    cid = await comment_repo.create("character", "char-7", CLAUDE_ID, None, "like target")
    assert await comment_repo.like_count(cid) == 0

    await comment_repo.like(cid, TEST_ID)
    assert await comment_repo.like_count(cid) == 1
    await comment_repo.like(cid, TEST_ID)  # idempotent
    assert await comment_repo.like_count(cid) == 1

    await comment_repo.unlike(cid, TEST_ID)
    assert await comment_repo.like_count(cid) == 0


async def test_react_and_unreact(db_conn):
    cid = await comment_repo.create("character", "char-8", CLAUDE_ID, None, "react target")
    await comment_repo.react(cid, TEST_ID, "👍", is_super=False)
    view = await comment_repo.get_view(cid, viewer_id=TEST_ID)
    assert view["reactions"]["👍"] == 1
    assert "👍" in view["my_reactions"]
    assert view["reaction_supers"]["👍"] is False

    await comment_repo.react(cid, TEST_ID, "👍", is_super=True)
    view = await comment_repo.get_view(cid, viewer_id=TEST_ID)
    assert view["reaction_supers"]["👍"] is True

    await comment_repo.unreact(cid, TEST_ID, "👍")
    view = await comment_repo.get_view(cid, viewer_id=TEST_ID)
    assert view["reactions"] == {}


async def test_react_blank_emoji_is_noop(db_conn):
    cid = await comment_repo.create("character", "char-9", CLAUDE_ID, None, "noop target")
    await comment_repo.react(cid, TEST_ID, "   ")
    view = await comment_repo.get_view(cid, viewer_id=TEST_ID)
    assert view["reactions"] == {}


async def test_delete_by_author_on_owner(db_conn):
    char_id = await db._q1(db.select(db.characters.c.id).where(db.characters.c.owner_id == CLAUDE_ID))
    if char_id is None:
        pytest.skip("no character owned by claude test account available")
    char_id = char_id["id"]
    cid = await comment_repo.create("character", char_id, TEST_ID, None, "should be removed")
    removed = await comment_repo.delete_by_author_on_owner(TEST_ID, CLAUDE_ID, "claude")
    assert removed >= 1
    assert await comment_repo.get(cid) is None
