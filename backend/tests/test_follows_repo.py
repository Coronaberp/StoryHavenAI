import pytest

from backend.repositories import users as user_repo
from backend.repositories import follows as follow_repo

pytestmark = pytest.mark.asyncio


async def test_follow_and_unfollow_user(db_conn):
    a = await user_repo.create_user("repo_test_follower_1", "s3cret-password")
    b = await user_repo.create_user("repo_test_followee_1", "s3cret-password")

    assert await follow_repo.follow(a["id"], b["id"]) is True
    assert await follow_repo.is_following(a["id"], b["id"]) is True
    assert await follow_repo.is_following(b["id"], a["id"]) is False

    await follow_repo.unfollow(a["id"], b["id"])
    assert await follow_repo.is_following(a["id"], b["id"]) is False


async def test_unfollow_when_not_following_is_safe(db_conn):
    a = await user_repo.create_user("repo_test_follower_2", "s3cret-password")
    b = await user_repo.create_user("repo_test_followee_2", "s3cret-password")

    await follow_repo.unfollow(a["id"], b["id"])
    assert await follow_repo.is_following(a["id"], b["id"]) is False


async def test_follow_twice_is_noop(db_conn):
    a = await user_repo.create_user("repo_test_follower_3", "s3cret-password")
    b = await user_repo.create_user("repo_test_followee_3", "s3cret-password")

    assert await follow_repo.follow(a["id"], b["id"]) is True
    assert await follow_repo.follow(a["id"], b["id"]) is False
    assert await follow_repo.follower_count(b["id"]) == 1


async def test_follow_self_is_rejected(db_conn):
    a = await user_repo.create_user("repo_test_follower_4", "s3cret-password")

    assert await follow_repo.follow(a["id"], a["id"]) is False
    assert await follow_repo.is_following(a["id"], a["id"]) is False


async def test_follower_and_following_counts(db_conn):
    a = await user_repo.create_user("repo_test_follower_5", "s3cret-password")
    b = await user_repo.create_user("repo_test_followee_5", "s3cret-password")
    c = await user_repo.create_user("repo_test_followee_6", "s3cret-password")

    assert await follow_repo.follower_count(a["id"]) == 0
    assert await follow_repo.following_count(a["id"]) == 0

    await follow_repo.follow(a["id"], b["id"])
    await follow_repo.follow(a["id"], c["id"])

    assert await follow_repo.following_count(a["id"]) == 2
    assert await follow_repo.follower_count(b["id"]) == 1
    assert await follow_repo.follower_count(c["id"]) == 1


async def test_following_ids_returns_all_followees(db_conn):
    a = await user_repo.create_user("repo_test_follower_6", "s3cret-password")
    b = await user_repo.create_user("repo_test_followee_7", "s3cret-password")
    c = await user_repo.create_user("repo_test_followee_8", "s3cret-password")

    assert await follow_repo.following_ids(a["id"]) == []

    await follow_repo.follow(a["id"], b["id"])
    await follow_repo.follow(a["id"], c["id"])

    assert set(await follow_repo.following_ids(a["id"])) == {b["id"], c["id"]}


async def test_followers_returns_user_details(db_conn):
    a = await user_repo.create_user("repo_test_follower_7", "s3cret-password")
    b = await user_repo.create_user("repo_test_followee_9", "s3cret-password")

    assert await follow_repo.followers(b["id"]) == []

    await follow_repo.follow(a["id"], b["id"])
    listed = await follow_repo.followers(b["id"])

    assert len(listed) == 1
    assert listed[0]["username"] == "repo_test_follower_7"
    assert "display_name" in listed[0]
    assert "avatar" in listed[0]
