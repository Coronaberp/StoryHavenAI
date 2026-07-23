import pytest

from backend.repositories import characters
from backend.repositories import chat_sessions
from backend.repositories import session_characters as session_char_repo
from backend.routers.sessions import list_sessions

pytestmark = pytest.mark.asyncio


async def test_list_sessions_attaches_cast_avatars(db_conn):
    owner = "user-cast-1"
    char_a = await characters.create({
        "name": "Aurelia", "avatar": "http://x/a.png",
        "owner_id": owner, "is_public": True,
    })
    char_b = await characters.create({
        "name": "Bram", "avatar": "http://x/b.png",
        "owner_id": owner, "is_public": True,
    })
    group_sid = await chat_sessions.create_group(owner, "Test Group", [char_a["id"], char_b["id"]])
    await session_char_repo.set_cast(group_sid, [
        {"char_id": char_a["id"]},
        {"char_id": char_b["id"]},
    ])
    solo_sid = await chat_sessions.create(char_a["id"], None, "Solo", "You", user_id=owner)

    result = await list_sessions(limit=40, char_id=None, current_user={"id": owner, "is_admin": False})

    group_row = next(s for s in result if s["id"] == group_sid)
    solo_row = next(s for s in result if s["id"] == solo_sid)

    assert len(group_row["cast_avatars"]) == 2
    names = {m["name"] for m in group_row["cast_avatars"]}
    assert names == {"Aurelia", "Bram"}
    for member in group_row["cast_avatars"]:
        assert member["avatar"]

    assert not solo_row.get("cast_avatars")


async def test_list_sessions_excludes_narrator_from_cast_avatars(db_conn):
    owner = "user-cast-2"
    char_a = await characters.create({
        "name": "Corvin", "avatar": "http://x/c.png",
        "owner_id": owner, "is_public": True,
    })
    char_b = await characters.create({
        "name": "Delia", "avatar": "http://x/d.png",
        "owner_id": owner, "is_public": True,
    })
    char_narrator = await characters.create({
        "name": "Narrator", "avatar": "http://x/n.png",
        "owner_id": owner, "is_public": True,
    })
    group_sid = await chat_sessions.create_group(owner, "Narrator Group", [char_a["id"], char_b["id"], char_narrator["id"]])
    await session_char_repo.set_cast(group_sid, [
        {"char_id": char_a["id"]},
        {"char_id": char_b["id"]},
        {"char_id": char_narrator["id"], "is_narrator": True},
    ])

    result = await list_sessions(limit=40, char_id=None, current_user={"id": owner, "is_admin": False})

    group_row = next(s for s in result if s["id"] == group_sid)
    assert len(group_row["cast_avatars"]) == 2
    names = {m["name"] for m in group_row["cast_avatars"]}
    assert names == {"Corvin", "Delia"}


async def test_list_sessions_caps_cast_avatars_at_four(db_conn):
    owner = "user-cast-3"
    chars = []
    for index in range(5):
        char = await characters.create({
            "name": f"Member{index}", "avatar": f"http://x/m{index}.png",
            "owner_id": owner, "is_public": True,
        })
        chars.append(char)
    group_sid = await chat_sessions.create_group(owner, "Big Group", [c["id"] for c in chars])
    await session_char_repo.set_cast(group_sid, [{"char_id": c["id"]} for c in chars])

    result = await list_sessions(limit=40, char_id=None, current_user={"id": owner, "is_admin": False})

    group_row = next(s for s in result if s["id"] == group_sid)
    assert len(group_row["cast_avatars"]) == 4
