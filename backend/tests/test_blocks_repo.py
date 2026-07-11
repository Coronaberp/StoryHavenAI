import pytest

from backend.repositories import users as user_repo
from backend.repositories import blocks as block_repo

pytestmark = pytest.mark.asyncio


async def test_block_and_unblock_user(db_conn):
    a = await user_repo.create_user("repo_test_blocker_1", "s3cret-password")
    b = await user_repo.create_user("repo_test_blocked_1", "s3cret-password")

    await block_repo.block_user(a["id"], b["id"], "spamming")
    assert await block_repo.has_blocked(a["id"], b["id"]) is True
    assert await block_repo.has_blocked(b["id"], a["id"]) is False

    await block_repo.unblock_user(a["id"], b["id"])
    assert await block_repo.has_blocked(a["id"], b["id"]) is False


async def test_block_user_upserts_reason_on_reblock(db_conn):
    a = await user_repo.create_user("repo_test_blocker_2", "s3cret-password")
    b = await user_repo.create_user("repo_test_blocked_2", "s3cret-password")

    await block_repo.block_user(a["id"], b["id"], "first reason")
    await block_repo.block_user(a["id"], b["id"], "updated reason")

    listed = await block_repo.list_blocked(a["id"])
    entry = next(r for r in listed if r["id"] == b["id"])
    assert entry["reason"] == "updated reason"


async def test_is_block_between_is_symmetric(db_conn):
    a = await user_repo.create_user("repo_test_blocker_3", "s3cret-password")
    b = await user_repo.create_user("repo_test_blocked_3", "s3cret-password")

    await block_repo.block_user(a["id"], b["id"])
    assert await block_repo.is_block_between(a["id"], b["id"]) is True
    assert await block_repo.is_block_between(b["id"], a["id"]) is True


async def test_blocked_ids_and_hidden_user_ids(db_conn):
    a = await user_repo.create_user("repo_test_blocker_4", "s3cret-password")
    b = await user_repo.create_user("repo_test_blocked_4", "s3cret-password")
    c = await user_repo.create_user("repo_test_blocked_5", "s3cret-password")

    await block_repo.block_user(a["id"], b["id"])
    await block_repo.block_user(c["id"], a["id"])

    assert await block_repo.blocked_ids(a["id"]) == {b["id"]}
    assert await block_repo.hidden_user_ids(a["id"]) == {b["id"], c["id"]}


async def test_list_blocked_returns_user_details(db_conn):
    a = await user_repo.create_user("repo_test_blocker_6", "s3cret-password")
    b = await user_repo.create_user("repo_test_blocked_6", "s3cret-password")

    await block_repo.block_user(a["id"], b["id"], "reason text")
    listed = await block_repo.list_blocked(a["id"])
    entry = next(r for r in listed if r["id"] == b["id"])
    assert entry["username"] == "repo_test_blocked_6"
    assert entry["reason"] == "reason text"
