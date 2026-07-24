import pytest
from fastapi import HTTPException

from backend.routers import groups as groups_router
from backend.routers import characters as characters_router
from backend.schemas import GroupPublishIn, GroupEditIn
from backend.repositories import characters, chat_sessions, session_characters
from backend.repositories import groups as groups_repo
from backend.repositories import blocks

pytestmark = pytest.mark.asyncio

async def test_publish_blocks_owned_private_char(db_conn):
    owner = "gtest_owner1"
    priv = await characters.create({"name": "Secret1", "is_public": False, "owner_id": owner})
    pub = await characters.create({"name": "Open1", "is_public": True, "owner_id": owner})
    sid = await chat_sessions.create_group(owner, "G1", [priv["id"], pub["id"]],
                                            persona_id=None, user_name="You", mode="roleplay")
    await session_characters.set_cast(sid, [{"char_id": priv["id"]}, {"char_id": pub["id"]}])
    with pytest.raises(HTTPException) as exc:
        await groups_router.publish_group(
            GroupPublishIn(session_id=sid),
            current_user={"id": owner, "username": "t", "is_admin": False})
    assert exc.value.status_code == 400
    assert priv["id"] in exc.value.detail

async def test_publish_succeeds_when_owned_chars_public(db_conn):
    owner = "gtest_owner2"
    a = await characters.create({"name": "A2", "is_public": True, "owner_id": owner})
    b = await characters.create({"name": "B2", "is_public": True, "owner_id": owner})
    sid = await chat_sessions.create_group(owner, "Duo2", [a["id"], b["id"]],
                                            persona_id=None, user_name="You", mode="chat")
    await session_characters.set_cast(sid, [{"char_id": a["id"]}, {"char_id": b["id"]}])
    result = await groups_router.publish_group(
        GroupPublishIn(session_id=sid),
        current_user={"id": owner, "username": "t", "is_admin": False})
    assert result["id"].startswith("g")

async def test_get_detail_visibility_and_cast(db_conn):
    owner = "gtest_owner3"
    a = await characters.create({"name": "A3", "is_public": True, "owner_id": owner})
    b = await characters.create({"name": "B3", "is_public": True, "owner_id": owner})
    sid = await chat_sessions.create_group(owner, "Vis3", [a["id"], b["id"]],
                                            persona_id=None, user_name="You", mode="roleplay")
    await session_characters.set_cast(sid, [{"char_id": a["id"]}, {"char_id": b["id"]}])
    current_user = {"id": owner, "username": "t", "is_admin": False}
    result = await groups_router.publish_group(GroupPublishIn(session_id=sid), current_user=current_user)
    gid = result["id"]
    detail = await groups_router.get_group(gid, current_user=current_user)
    assert detail["name"] == "Vis3"
    assert detail["is_owner"] is True
    assert {m["char_id"] for m in detail["cast"]} == {a["id"], b["id"]}
    assert all(m["linkable"] for m in detail["cast"])
    with pytest.raises(HTTPException) as exc:
        await groups_router.get_group("gdoesnotexist", current_user=None)
    assert exc.value.status_code == 404

async def test_get_detail_hides_private_group_from_non_owner(db_conn):
    owner = "gtest_owner7"
    a = await characters.create({"name": "A7", "is_public": True, "owner_id": owner})
    b = await characters.create({"name": "B7", "is_public": True, "owner_id": owner})
    sid = await chat_sessions.create_group(owner, "Priv7", [a["id"], b["id"]],
                                            persona_id=None, user_name="You", mode="roleplay")
    await session_characters.set_cast(sid, [{"char_id": a["id"]}, {"char_id": b["id"]}])
    owner_user = {"id": owner, "username": "t", "is_admin": False}
    result = await groups_router.publish_group(GroupPublishIn(session_id=sid), current_user=owner_user)
    gid = result["id"]
    await groups_repo.set_public(gid, 0)
    with pytest.raises(HTTPException) as exc:
        await groups_router.get_group(
            gid, current_user={"id": "gtest_stranger7", "username": "x", "is_admin": False})
    assert exc.value.status_code == 404
    detail = await groups_router.get_group(gid, current_user=owner_user)
    assert detail["is_owner"] is True

async def test_edit_revalidates_and_updates(db_conn):
    owner = "gtest_owner4"
    a = await characters.create({"name": "Ae", "is_public": True, "owner_id": owner})
    b = await characters.create({"name": "Be", "is_public": True, "owner_id": owner})
    d = await characters.create({"name": "De", "is_public": True, "owner_id": owner})
    sid = await chat_sessions.create_group(owner, "E", [a["id"], b["id"]],
                                            persona_id=None, user_name="You", mode="roleplay")
    await session_characters.set_cast(sid, [{"char_id": a["id"]}, {"char_id": b["id"]}])
    current_user = {"id": owner, "username": "t", "is_admin": False}
    result = await groups_router.publish_group(GroupPublishIn(session_id=sid), current_user=current_user)
    gid = result["id"]
    ok = await groups_router.edit_group(
        gid, GroupEditIn(name="E2", opening="o", char_ids=[a["id"], b["id"], d["id"]], mode="chat"),
        current_user=current_user)
    assert ok == {"ok": True}
    detail = await groups_router.get_group(gid, current_user=current_user)
    assert detail["name"] == "E2" and detail["group_mode"] == "chat"
    assert len(detail["cast"]) == 3
    with pytest.raises(HTTPException) as exc:
        await groups_router.edit_group(
            gid, GroupEditIn(name="E2", opening="o", char_ids=[a["id"]], mode="chat"),
            current_user=current_user)
    assert exc.value.status_code == 400

async def test_start_chat_from_template(db_conn):
    owner = "gtest_owner6"
    a = await characters.create({"name": "A6", "is_public": True, "owner_id": owner})
    b = await characters.create({"name": "B6", "is_public": True, "owner_id": owner})
    sid0 = await chat_sessions.create_group(owner, "Tmpl", [a["id"], b["id"]],
                                            persona_id=None, user_name="You", mode="roleplay")
    await session_characters.set_cast(sid0, [{"char_id": a["id"]}, {"char_id": b["id"]}])
    current_user = {"id": owner, "username": "t", "is_admin": False}
    result = await groups_router.publish_group(GroupPublishIn(session_id=sid0), current_user=current_user)
    gid = result["id"]
    r = await groups_router.start_group_chat(gid, current_user=current_user)
    assert r["session_id"]
    cast = await session_characters.list_cast(r["session_id"])
    assert {m["char_id"] for m in cast} == {a["id"], b["id"]}

async def test_delete_owner_only(db_conn):
    owner = "gtest_owner5"
    a = await characters.create({"name": "Ad", "is_public": True, "owner_id": owner})
    b = await characters.create({"name": "Bd", "is_public": True, "owner_id": owner})
    sid = await chat_sessions.create_group(owner, "D", [a["id"], b["id"]],
                                            persona_id=None, user_name="You", mode="roleplay")
    await session_characters.set_cast(sid, [{"char_id": a["id"]}, {"char_id": b["id"]}])
    current_user = {"id": owner, "username": "t", "is_admin": False}
    result = await groups_router.publish_group(GroupPublishIn(session_id=sid), current_user=current_user)
    gid = result["id"]
    ok = await groups_router.delete_group(gid, current_user=current_user)
    assert ok == {"ok": True}
    with pytest.raises(HTTPException) as exc:
        await groups_router.get_group(gid, current_user=None)
    assert exc.value.status_code == 404

async def test_community_feed_includes_groups(db_conn):
    owner = "gtest_owner6"
    a = await characters.create({"name": "Af6", "is_public": True, "owner_id": owner})
    b = await characters.create({"name": "Bf6", "is_public": True, "owner_id": owner})
    sid = await chat_sessions.create_group(owner, "FeedG6", [a["id"], b["id"]],
                                            persona_id=None, user_name="You", mode="roleplay")
    await session_characters.set_cast(sid, [{"char_id": a["id"]}, {"char_id": b["id"]}])
    current_user = {"id": owner, "username": "t", "is_admin": False}
    result = await groups_router.publish_group(GroupPublishIn(session_id=sid), current_user=current_user)
    gid = result["id"]
    feed = await characters_router.list_characters(scope="community", current_user=current_user)
    groups_in = [x for x in feed if x.get("kind") == "group"]
    assert gid in [x["id"] for x in groups_in]
    one = next(x for x in groups_in if x["id"] == gid)
    assert one["name"] == "FeedG6"
    assert len(one["cast_preview"]) == 2

async def test_char_featuring_groups(db_conn):
    owner = "gtest_owner7"
    a = await characters.create({"name": "Ag7", "is_public": True, "owner_id": owner})
    b = await characters.create({"name": "Bg7", "is_public": True, "owner_id": owner})
    sid = await chat_sessions.create_group(owner, "FeatG7", [a["id"], b["id"]],
                                            persona_id=None, user_name="You", mode="roleplay")
    await session_characters.set_cast(sid, [{"char_id": a["id"]}, {"char_id": b["id"]}])
    current_user = {"id": owner, "username": "t", "is_admin": False}
    result = await groups_router.publish_group(GroupPublishIn(session_id=sid), current_user=current_user)
    gid = result["id"]
    featuring = await characters_router.character_groups(a["id"], current_user=None)
    assert gid in [x["id"] for x in featuring]

async def test_community_feed_unauth_includes_groups(db_conn):
    owner = "gtest_owner8"
    a = await characters.create({"name": "Ag8", "is_public": True, "owner_id": owner})
    b = await characters.create({"name": "Bg8", "is_public": True, "owner_id": owner})
    sid = await chat_sessions.create_group(owner, "FeedG8", [a["id"], b["id"]],
                                            persona_id=None, user_name="You", mode="roleplay")
    await session_characters.set_cast(sid, [{"char_id": a["id"]}, {"char_id": b["id"]}])
    current_user = {"id": owner, "username": "t", "is_admin": False}
    result = await groups_router.publish_group(GroupPublishIn(session_id=sid), current_user=current_user)
    gid = result["id"]
    feed = await characters_router.list_characters(scope="community", current_user=None)
    groups_in = [x for x in feed if x.get("kind") == "group"]
    assert gid in [x["id"] for x in groups_in]

async def test_start_chat_drops_inaccessible_cast(db_conn):
    owner1 = "gtest_leak_owner1"
    owner2 = "gtest_leak_owner2"
    a = await characters.create({"name": "LeakA", "is_public": True, "owner_id": owner1})
    b = await characters.create({"name": "LeakB", "is_public": True, "owner_id": owner1})
    sid0 = await chat_sessions.create_group(owner1, "LeakTmpl", [a["id"], b["id"]],
                                            persona_id=None, user_name="You", mode="roleplay")
    await session_characters.set_cast(sid0, [{"char_id": a["id"]}, {"char_id": b["id"]}])
    owner1_user = {"id": owner1, "username": "t1", "is_admin": False}
    result = await groups_router.publish_group(GroupPublishIn(session_id=sid0), current_user=owner1_user)
    gid = result["id"]
    await characters.update(a["id"], {"name": a["name"], "owner_id": owner1, "is_public": False})
    updated_a = await characters.get(a["id"])
    assert not updated_a.get("is_public")
    owner2_user = {"id": owner2, "username": "t2", "is_admin": False}
    with pytest.raises(HTTPException) as exc:
        await groups_router.start_group_chat(gid, current_user=owner2_user)
    assert exc.value.status_code == 400
    r = await groups_router.start_group_chat(gid, current_user=owner1_user)
    assert r["session_id"]
    cast = await session_characters.list_cast(r["session_id"])
    assert {m["char_id"] for m in cast} == {a["id"], b["id"]}

async def test_detail_hides_private_cast_member(db_conn):
    owner1 = "gtest_leak_owner3"
    owner2 = "gtest_leak_owner4"
    a = await characters.create({"name": "LeakDA", "is_public": True, "owner_id": owner1})
    b = await characters.create({"name": "LeakDB", "is_public": True, "owner_id": owner1})
    sid0 = await chat_sessions.create_group(owner1, "LeakDTmpl", [a["id"], b["id"]],
                                            persona_id=None, user_name="You", mode="roleplay")
    await session_characters.set_cast(sid0, [{"char_id": a["id"]}, {"char_id": b["id"]}])
    owner1_user = {"id": owner1, "username": "t1", "is_admin": False}
    result = await groups_router.publish_group(GroupPublishIn(session_id=sid0), current_user=owner1_user)
    gid = result["id"]
    await characters.update(a["id"], {"name": a["name"], "owner_id": owner1, "is_public": False})
    owner2_user = {"id": owner2, "username": "t2", "is_admin": False}
    detail = await groups_router.get_group(gid, current_user=owner2_user)
    entry_a = next(m for m in detail["cast"] if m["char_id"] == a["id"])
    entry_b = next(m for m in detail["cast"] if m["char_id"] == b["id"])
    assert entry_a["hidden"] is True
    assert entry_a["name"] is None
    assert entry_a["avatar"] is None
    assert entry_b["hidden"] is False
    assert entry_b["name"] == "LeakDB"
    detail_owner = await groups_router.get_group(gid, current_user=owner1_user)
    entry_a_owner = next(m for m in detail_owner["cast"] if m["char_id"] == a["id"])
    assert entry_a_owner["hidden"] is False
    assert entry_a_owner["name"] == "LeakDA"

async def test_feed_preview_excludes_private_cast(db_conn):
    owner1 = "gtest_leak_owner5"
    owner2 = "gtest_leak_owner6"
    a = await characters.create({"name": "LeakFA", "is_public": True, "owner_id": owner1})
    b = await characters.create({"name": "LeakFB", "is_public": True, "owner_id": owner1})
    sid0 = await chat_sessions.create_group(owner1, "LeakFTmpl", [a["id"], b["id"]],
                                            persona_id=None, user_name="You", mode="roleplay")
    await session_characters.set_cast(sid0, [{"char_id": a["id"]}, {"char_id": b["id"]}])
    owner1_user = {"id": owner1, "username": "t1", "is_admin": False}
    result = await groups_router.publish_group(GroupPublishIn(session_id=sid0), current_user=owner1_user)
    gid = result["id"]
    await characters.update(a["id"], {"name": a["name"], "owner_id": owner1, "is_public": False})
    owner2_user = {"id": owner2, "username": "t2", "is_admin": False}
    feed = await characters_router.list_characters(scope="community", current_user=owner2_user)
    one = next(x for x in feed if x.get("kind") == "group" and x["id"] == gid)
    preview_ids = {m["char_id"] for m in one["cast_preview"]}
    assert a["id"] not in preview_ids
    assert b["id"] in preview_ids

async def test_community_feed_excludes_blocked_owner_groups(db_conn):
    viewer = "gtest_viewer9"
    owner = "gtest_owner9"
    a = await characters.create({"name": "Ag9", "is_public": True, "owner_id": owner})
    b = await characters.create({"name": "Bg9", "is_public": True, "owner_id": owner})
    sid = await chat_sessions.create_group(owner, "FeedG9", [a["id"], b["id"]],
                                            persona_id=None, user_name="You", mode="roleplay")
    await session_characters.set_cast(sid, [{"char_id": a["id"]}, {"char_id": b["id"]}])
    owner_user = {"id": owner, "username": "t", "is_admin": False}
    result = await groups_router.publish_group(GroupPublishIn(session_id=sid), current_user=owner_user)
    gid = result["id"]
    viewer_user = {"id": viewer, "username": "v", "is_admin": False}
    feed_before = await characters_router.list_characters(scope="community", current_user=viewer_user)
    assert gid in [x["id"] for x in feed_before if x.get("kind") == "group"]
    await blocks.block_user(viewer, owner)
    feed_after = await characters_router.list_characters(scope="community", current_user=viewer_user)
    assert gid not in [x["id"] for x in feed_after if x.get("kind") == "group"]
