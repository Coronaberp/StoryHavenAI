import pytest

from backend.repositories import party_chat

pytestmark = pytest.mark.asyncio


async def test_add_and_list_recent(db_conn):
    await party_chat.add("sess-1", "user-a", "go ahead, I'm typing")
    await party_chat.add("sess-1", "user-b", "ok waiting")
    msgs = await party_chat.list_recent("sess-1")
    assert [m["content"] for m in msgs] == ["go ahead, I'm typing", "ok waiting"]
    assert msgs[0]["sender_user_id"] == "user-a"


async def test_list_recent_scoped_to_session(db_conn):
    await party_chat.add("sess-2", "user-a", "in session 2")
    await party_chat.add("sess-3", "user-a", "in session 3")
    msgs = await party_chat.list_recent("sess-2")
    assert [m["content"] for m in msgs] == ["in session 2"]


async def test_add_with_image_attachment(db_conn):
    msg = await party_chat.add("sess-5", "user-a", "", image="/media/gif1.gif", attachment_kind="image")
    assert msg["image"] == "/media/gif1.gif"
    assert msg["attachment_kind"] == "image"
    msgs = await party_chat.list_recent("sess-5")
    assert msgs[0]["image"] == "/media/gif1.gif"


async def test_list_recent_respects_limit(db_conn):
    for i in range(5):
        await party_chat.add("sess-4", "user-a", f"message {i}")
    msgs = await party_chat.list_recent("sess-4", limit=2)
    assert [m["content"] for m in msgs] == ["message 3", "message 4"]
