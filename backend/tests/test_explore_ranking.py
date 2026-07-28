import pytest
import pytest_asyncio

from backend import db
from backend import explore_ranking
from backend.repositories import characters
from backend.repositories import chat_sessions
from backend.repositories import content_likes as content_like_repo
from backend.repositories import follows as follows_repo

pytestmark = pytest.mark.asyncio

TEST_ID = "ucb203e5d3fe9"
CLAUDE_ID = "u016863391b2a"
NO_SIGNAL_USER_ID = "u-explore-ranking-fresh-test-user"

@pytest_asyncio.fixture(autouse=True)
async def _ensure_fernet():
    if db._fernet is None:
        await db.init()

async def _make_character(owner_id=None, genre=None, **extra):
    data = {"name": "Ranking Test Character", "persona": "p", "owner_id": owner_id,
            "genre": genre, "is_public": True, **extra}
    return await characters.create(data)

async def test_build_user_signals_no_signal(db_conn):
    signals = await explore_ranking.build_user_signals(NO_SIGNAL_USER_ID)
    assert signals["has_signal"] is False

async def test_build_user_signals_from_like(db_conn):
    c = await _make_character(owner_id=CLAUDE_ID, genre="Fantasy")
    await content_like_repo.like("character", c["id"], TEST_ID)
    signals = await explore_ranking.build_user_signals(TEST_ID)
    assert signals["has_signal"] is True
    assert CLAUDE_ID in signals["liked_creator_ids"]
    assert "Fantasy" in signals["affinity_genres"]

async def test_build_user_signals_from_chat_history(db_conn):
    c = await _make_character(owner_id=CLAUDE_ID, genre="Horror")
    await chat_sessions.create(c["id"], None, "Chat", "You", user_id=TEST_ID)
    signals = await explore_ranking.build_user_signals(TEST_ID)
    assert signals["has_signal"] is True
    assert c["id"] in signals["chatted_char_ids"]
    assert CLAUDE_ID in signals["chatted_creator_ids"]
    assert "Horror" in signals["affinity_genres"]

async def test_build_user_signals_from_follow(db_conn):
    await follows_repo.follow(TEST_ID, CLAUDE_ID)
    signals = await explore_ranking.build_user_signals(TEST_ID)
    assert signals["has_signal"] is True
    assert CLAUDE_ID in signals["followed_creator_ids"]

async def test_score_for_you_treats_exact_chat_history_as_a_minor_signal(db_conn):
    # Exact chat history is intentionally a small nudge, not a dominant signal -
    # "For You" is a discovery feed, so it shouldn't just resurface what you've
    # already chatted with above genuinely new-to-you matches.
    chatted = await _make_character(owner_id=CLAUDE_ID, genre="Horror")
    liked_creator_char = await _make_character(owner_id="some-other-owner", genre="Comedy")
    signals = {
        "chatted_char_ids": {chatted["id"]},
        "chatted_creator_ids": {CLAUDE_ID},
        "liked_creator_ids": {"some-other-owner"},
        "affinity_genres": {"Fantasy"},
        "followed_creator_ids": set(),
        "has_signal": True,
    }
    chat_score = explore_ranking.score_for_you(chatted, signals)
    like_score = explore_ranking.score_for_you(liked_creator_char, signals)
    assert chat_score == explore_ranking.WEIGHT_CHAT_HISTORY_EXACT
    assert chat_score < like_score

async def test_rank_for_you_falls_back_to_input_order_when_no_signal(db_conn):
    candidates = [{"id": "a", "owner_id": None, "genre": None, "created": 1},
                  {"id": "b", "owner_id": None, "genre": None, "created": 2}]
    ranked, personalized = await explore_ranking.rank_for_you(candidates, NO_SIGNAL_USER_ID)
    assert personalized is False
    assert ranked == candidates

async def test_rank_for_you_boosts_chatted_character(db_conn):
    chatted = await _make_character(owner_id=CLAUDE_ID, genre="Fantasy")
    other = await _make_character(owner_id="unrelated-owner", genre="Comedy")
    await chat_sessions.create(chatted["id"], None, "Chat", "You", user_id=TEST_ID)
    ranked, personalized = await explore_ranking.rank_for_you([other, chatted], TEST_ID)
    assert personalized is True
    assert ranked[0]["id"] == chatted["id"]

async def test_rank_featured_orders_by_likes_then_recency(db_conn):
    popular = await _make_character(genre="Fantasy", created=1000.0)
    unpopular = await _make_character(genre="Fantasy", created=1000.0)
    await content_like_repo.like("character", popular["id"], TEST_ID)
    await content_like_repo.like("character", popular["id"], CLAUDE_ID)
    ranked = await explore_ranking.rank_featured([unpopular, popular])
    assert ranked[0]["id"] == popular["id"]

async def test_rank_featured_is_not_personalized(db_conn):
    c = await _make_character(genre="Fantasy")
    ranked_for_test = await explore_ranking.rank_featured([c])
    ranked_for_claude = await explore_ranking.rank_featured([c])
    assert ranked_for_test == ranked_for_claude
