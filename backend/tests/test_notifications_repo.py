import pytest
import pytest_asyncio

from backend import db
from backend.repositories import notifications as notification_repo
from backend.repositories import users as user_repo

pytestmark = pytest.mark.asyncio

CLAUDE_ID = "u016863391b2a"


@pytest_asyncio.fixture(autouse=True)
async def _ensure_fernet():
    if db._fernet is None:
        await db.init()


@pytest_asyncio.fixture(autouse=True)
async def _test_id(db_conn):
    global TEST_ID
    user = await user_repo.create_user(f"repo_test_notify_user_{db.nid()}", "s3cret-password")
    TEST_ID = user["id"]


async def test_create_and_list(db_conn):
    nt = await notification_repo.create(TEST_ID, "comment", "New comment", "someone replied", "/c/1")
    notes = await notification_repo.list_for_user(TEST_ID)
    assert any(n["id"] == nt for n in notes)
    found = next(n for n in notes if n["id"] == nt)
    assert found["title"] == "New comment"
    assert found["body"] == "someone replied"
    assert found["read"] is False


async def test_list_unread_only(db_conn):
    await notification_repo.create(TEST_ID, "comment", "One", "body1")
    read_one = await notification_repo.create(TEST_ID, "comment", "Two", "body2")
    await notification_repo.mark_read(read_one, TEST_ID)

    unread = await notification_repo.list_for_user(TEST_ID, unread_only=True)
    assert all(n["id"] != read_one for n in unread)


async def test_mark_read_and_mark_all_read(db_conn):
    n1 = await notification_repo.create(TEST_ID, "comment", "A", "b")
    n2 = await notification_repo.create(TEST_ID, "comment", "C", "d")

    await notification_repo.mark_read(n1, TEST_ID)
    notes = {n["id"]: n for n in await notification_repo.list_for_user(TEST_ID)}
    assert notes[n1]["read"] is True
    assert notes[n2]["read"] is False

    await notification_repo.mark_all_read(TEST_ID)
    notes = {n["id"]: n for n in await notification_repo.list_for_user(TEST_ID)}
    assert notes[n2]["read"] is True


async def test_mark_read_wrong_user_is_noop(db_conn):
    nt = await notification_repo.create(TEST_ID, "comment", "A", "b")
    await notification_repo.mark_read(nt, CLAUDE_ID)
    notes = {n["id"]: n for n in await notification_repo.list_for_user(TEST_ID)}
    assert notes[nt]["read"] is False


async def test_delete_all(db_conn):
    await notification_repo.create(TEST_ID, "comment", "A", "b")
    await notification_repo.create(TEST_ID, "comment", "C", "d")
    await notification_repo.delete_all(TEST_ID)
    assert await notification_repo.list_for_user(TEST_ID) == []


async def test_unread_count(db_conn):
    n1 = await notification_repo.create(TEST_ID, "comment", "A", "b")
    await notification_repo.create(TEST_ID, "comment", "C", "d")
    assert await notification_repo.unread_count(TEST_ID) == 2
    await notification_repo.mark_read(n1, TEST_ID)
    assert await notification_repo.unread_count(TEST_ID) == 1


async def test_exists(db_conn):
    assert await notification_repo.exists(TEST_ID, "milestone", "char-1:10") is False
    await notification_repo.create(TEST_ID, "milestone", "Milestone!", "body", related_id="char-1:10")
    assert await notification_repo.exists(TEST_ID, "milestone", "char-1:10") is True


async def test_notify_admins_sends_to_all_admins_and_dedupes(db_conn):
    sent = await notification_repo.notify_admins(
        "admin_test", "Something happened", "details", related_id="thing-1")
    assert sent >= 1

    sent_again = await notification_repo.notify_admins(
        "admin_test", "Something happened", "details", related_id="thing-1")
    assert sent_again == 0


async def test_notify_admins_excludes_user(db_conn):
    sent = await notification_repo.notify_admins(
        "admin_test2", "Excluded test", "details", exclude_user_id=CLAUDE_ID)
    notes = await notification_repo.list_for_user(CLAUDE_ID)
    assert not any(n["title"] == "Excluded test" for n in notes)


async def test_notify_all_users_sends_to_active_non_dev(db_conn):
    notifs_before = await notification_repo.list_for_user(TEST_ID)
    sent = await notification_repo.notify_all_users(
        "feature_disabled", "Chat is down", "back soon", related_id="chat")
    assert sent >= 1
    notifs_after = await notification_repo.list_for_user(TEST_ID)
    assert len(notifs_after) == len(notifs_before) + 1


async def test_notify_all_users_excludes_dev(db_conn):
    dev_user = await user_repo.create_user("repo_test_notify_dev_1", "s3cret-password", is_admin=True)
    await user_repo.set_dev_role(dev_user["id"], True)

    sent = await notification_repo.notify_all_users(
        "feature_disabled", "Dev exclusion test", "back soon", related_id="chat-dev-exclusion")

    dev_notes = await notification_repo.list_for_user(dev_user["id"])
    assert not any(n["title"] == "Dev exclusion test" for n in dev_notes)

    test_notes = await notification_repo.list_for_user(TEST_ID)
    assert any(n["title"] == "Dev exclusion test" for n in test_notes)
    assert sent >= 1
