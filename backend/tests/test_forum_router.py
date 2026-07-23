import pytest
import pytest_asyncio
from fastapi import HTTPException

from backend import db
from backend.repositories import forum as forum_thread_repo
from backend.routers.forum import vote_forum_thread_route
from backend.schemas import ForumVoteIn

pytestmark = pytest.mark.asyncio

CLAUDE_ID = "u016863391b2a"
TEST_ID = "ucb203e5d3fe9"


@pytest_asyncio.fixture(autouse=True)
async def _ensure_fernet():
    if db._fernet is None:
        await db.init()


async def test_author_cannot_vote_on_own_thread(db_conn):
    tid = await forum_thread_repo.create(CLAUDE_ID, "Self Vote Thread", "Body", "general")
    author = {"id": CLAUDE_ID, "username": "claude", "is_admin": True}

    with pytest.raises(HTTPException) as exc_info:
        await vote_forum_thread_route(tid, ForumVoteIn(value=1), current_user=author)

    assert exc_info.value.status_code == 403


async def test_other_user_can_vote_on_thread(db_conn):
    tid = await forum_thread_repo.create(CLAUDE_ID, "Votable Thread", "Body", "general")
    voter = {"id": TEST_ID, "username": "test", "is_admin": False}

    result = await vote_forum_thread_route(tid, ForumVoteIn(value=1), current_user=voter)

    assert result["score"] == 1
