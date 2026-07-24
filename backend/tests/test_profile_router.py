import io

import pytest
from fastapi import HTTPException, UploadFile

from backend.repositories import users as user_repo
from backend.routers import profile
from backend.schemas import BlockIn, ProfileIn

pytestmark = pytest.mark.asyncio

_PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000002000000020802000000fdd49a73"
    "0000001649444154789c63fccfc0c0c0c0c0c4c0c0c0c0c000000d1d01036ac29be"
    "90000000049454e44ae426082")

def _upload(filename="avatar.png", data=_PNG_BYTES):
    return UploadFile(file=io.BytesIO(data), filename=filename)

def _as_user(row):
    return {"id": row["id"], "username": row["username"], "is_admin": bool(row["is_admin"]),
            "role": "admin" if row["is_admin"] else "user", "tier": row.get("tier", "full")}

async def test_public_profile_returns_expected_fields(db_conn):
    owner = await user_repo.create_user("profile_test_owner_1", "s3cret-password")

    result = await profile.public_profile(owner["username"], current_user=None)

    assert result["username"] == "profile_test_owner_1"
    assert result["blocked_by_viewer"] is False
    assert result["following"] is False
    assert "characters" in result

async def test_public_profile_missing_user_404s(db_conn):
    with pytest.raises(HTTPException) as exc_info:
        await profile.public_profile("does-not-exist-user", current_user=None)

    assert exc_info.value.status_code == 404

async def test_public_profile_hidden_between_blocked_users(db_conn):
    from backend.repositories import blocks as block_repo
    owner = await user_repo.create_user("profile_test_owner_2", "s3cret-password")
    viewer = await user_repo.create_user("profile_test_viewer_2", "s3cret-password")
    await block_repo.block_user(owner["id"], viewer["id"])

    with pytest.raises(HTTPException) as exc_info:
        await profile.public_profile(owner["username"], current_user=_as_user(viewer))

    assert exc_info.value.status_code == 404

async def test_update_my_profile_updates_display_name_and_bio(db_conn):
    user = await user_repo.create_user("profile_test_update_1", "s3cret-password")
    body = ProfileIn(display_name="  New Name  ", bio="  A short bio.  ")

    result = await profile.update_my_profile(body, current_user=_as_user(user))

    assert result["display_name"] == "New Name"
    assert result["bio"] == "A short bio."

async def test_update_my_profile_rejects_invalid_hex_color(db_conn):
    user = await user_repo.create_user("profile_test_update_2", "s3cret-password")
    body = ProfileIn(banner_color="not-a-color")

    with pytest.raises(HTTPException) as exc_info:
        await profile.update_my_profile(body, current_user=_as_user(user))

    assert exc_info.value.status_code == 400

async def test_update_my_profile_accepts_valid_hex_color(db_conn):
    user = await user_repo.create_user("profile_test_update_3", "s3cret-password")
    body = ProfileIn(banner_color="#aabbcc")

    result = await profile.update_my_profile(body, current_user=_as_user(user))

    assert result["banner_color"] == "#aabbcc"

async def test_update_my_profile_filters_social_links_to_known_keys(db_conn):
    user = await user_repo.create_user("profile_test_update_4", "s3cret-password")
    body = ProfileIn(social_links={"twitter": "@me", "not_a_real_platform": "x"})

    result = await profile.update_my_profile(body, current_user=_as_user(user))

    import json
    links = json.loads(result["social_links"]) if isinstance(result["social_links"], str) else result["social_links"]
    assert "twitter" in links
    assert "not_a_real_platform" not in links

async def test_update_my_profile_requires_share_placeholder_in_profile_html(db_conn):
    user = await user_repo.create_user("profile_test_update_5", "s3cret-password")
    body = ProfileIn(profile_html="<div>no placeholders here</div>")

    with pytest.raises(HTTPException) as exc_info:
        await profile.update_my_profile(body, current_user=_as_user(user))

    assert exc_info.value.status_code == 400

async def test_update_my_profile_accepts_profile_html_with_all_placeholders(db_conn):
    user = await user_repo.create_user("profile_test_update_6", "s3cret-password")
    html = "{{share}}{{edit}}{{comments}}{{block}}{{report}}{{follow}}"
    body = ProfileIn(profile_html=html)

    result = await profile.update_my_profile(body, current_user=_as_user(user))

    assert result["profile_html"] == html

async def test_update_my_profile_title_with_html_rejected(db_conn):
    user = await user_repo.create_user("profile_test_update_7", "s3cret-password")
    body = ProfileIn(title="<b>bold</b>")

    with pytest.raises(HTTPException) as exc_info:
        await profile.update_my_profile(body, current_user=_as_user(user))

    assert exc_info.value.status_code == 400

async def test_update_my_profile_new_title_goes_pending(db_conn):
    user = await user_repo.create_user("profile_test_update_8", "s3cret-password")
    body = ProfileIn(title="Storyteller")

    result = await profile.update_my_profile(body, current_user=_as_user(user))

    assert result["title_status"] == "pending"

async def test_upload_my_avatar_saves_and_returns_url(db_conn, monkeypatch):
    from backend import classify
    monkeypatch.setattr(classify, "classify_image_background", lambda *a, **k: None)
    monkeypatch.setattr(profile, "classify_image_background", lambda *a, **k: None)
    user = await user_repo.create_user("profile_test_avatar_1", "s3cret-password")

    result = await profile.upload_my_avatar(file=_upload(), current_user=_as_user(user))

    assert result["avatar"].startswith(f"/media/u_{user['id']}")
    updated = await user_repo.get_user_by_id(user["id"])
    assert updated["avatar"] == result["avatar"]

async def test_upload_my_banner_saves_and_returns_url(db_conn, monkeypatch):
    monkeypatch.setattr(profile, "classify_image_background", lambda *a, **k: None)
    user = await user_repo.create_user("profile_test_banner_1", "s3cret-password")

    result = await profile.upload_my_banner(file=_upload(), current_user=_as_user(user))

    assert result["banner_img"].startswith(f"/media/ub_{user['id']}")

async def test_upload_my_chat_background_saves_and_returns_url(db_conn, monkeypatch):
    monkeypatch.setattr(profile, "classify_image_background", lambda *a, **k: None)
    user = await user_repo.create_user("profile_test_chatbg_1", "s3cret-password")

    result = await profile.upload_my_chat_background(file=_upload(), current_user=_as_user(user))

    assert result["chat_background_img"].startswith(f"/media/ucb_{user['id']}")

async def test_block_user_route_rejects_self_block(db_conn):
    user = await user_repo.create_user("profile_test_block_1", "s3cret-password")
    body = BlockIn(reason="testing")

    with pytest.raises(HTTPException) as exc_info:
        await profile.block_user_route(user["username"], body, current_user=_as_user(user))

    assert exc_info.value.status_code == 400

async def test_block_user_route_blocks_other_user(db_conn):
    a = await user_repo.create_user("profile_test_block_2", "s3cret-password")
    b = await user_repo.create_user("profile_test_block_3", "s3cret-password")
    body = BlockIn(reason="spamming")

    result = await profile.block_user_route(b["username"], body, current_user=_as_user(a))

    assert result["blocked"] is True
    from backend.repositories import blocks as block_repo
    assert await block_repo.has_blocked(a["id"], b["id"]) is True

async def test_block_user_route_missing_user_404s(db_conn):
    user = await user_repo.create_user("profile_test_block_4", "s3cret-password")
    body = BlockIn(reason="")

    with pytest.raises(HTTPException) as exc_info:
        await profile.block_user_route("no-such-user-anywhere", body, current_user=_as_user(user))

    assert exc_info.value.status_code == 404

async def test_unblock_user_route(db_conn):
    a = await user_repo.create_user("profile_test_unblock_1", "s3cret-password")
    b = await user_repo.create_user("profile_test_unblock_2", "s3cret-password")
    from backend.repositories import blocks as block_repo
    await block_repo.block_user(a["id"], b["id"])

    result = await profile.unblock_user_route(b["username"], current_user=_as_user(a))

    assert result == {"blocked": False}
    assert await block_repo.has_blocked(a["id"], b["id"]) is False

async def test_my_blocked_lists_blocked_users(db_conn):
    a = await user_repo.create_user("profile_test_myblocked_1", "s3cret-password")
    b = await user_repo.create_user("profile_test_myblocked_2", "s3cret-password")
    from backend.repositories import blocks as block_repo
    await block_repo.block_user(a["id"], b["id"], "reason")

    result = await profile.my_blocked(current_user=_as_user(a))

    assert any(r["id"] == b["id"] for r in result)

async def test_follow_user_route_rejects_self_follow(db_conn):
    user = await user_repo.create_user("profile_test_follow_1", "s3cret-password")

    with pytest.raises(HTTPException) as exc_info:
        await profile.follow_user_route(user["username"], current_user=_as_user(user))

    assert exc_info.value.status_code == 400

async def test_follow_user_route_rejects_when_blocked(db_conn):
    a = await user_repo.create_user("profile_test_follow_2", "s3cret-password")
    b = await user_repo.create_user("profile_test_follow_3", "s3cret-password")
    from backend.repositories import blocks as block_repo
    await block_repo.block_user(a["id"], b["id"])

    with pytest.raises(HTTPException) as exc_info:
        await profile.follow_user_route(b["username"], current_user=_as_user(a))

    assert exc_info.value.status_code == 403

async def test_follow_user_route_follows_and_unfollow(db_conn):
    a = await user_repo.create_user("profile_test_follow_4", "s3cret-password")
    b = await user_repo.create_user("profile_test_follow_5", "s3cret-password")

    result = await profile.follow_user_route(b["username"], current_user=_as_user(a))
    assert result["following"] is True
    assert result["follower_count"] == 1

    result = await profile.unfollow_user_route(b["username"], current_user=_as_user(a))
    assert result["following"] is False
    assert result["follower_count"] == 0

async def test_user_followers_missing_user_404s(db_conn):
    with pytest.raises(HTTPException) as exc_info:
        await profile.user_followers("no-such-user-followers", current_user=None)

    assert exc_info.value.status_code == 404

async def test_user_followers_returns_list(db_conn):
    a = await user_repo.create_user("profile_test_followers_1", "s3cret-password")
    b = await user_repo.create_user("profile_test_followers_2", "s3cret-password")
    from backend.repositories import follows as follow_repo
    await follow_repo.follow(a["id"], b["id"])

    result = await profile.user_followers(b["username"], current_user=None)

    assert any(r["username"] == a["username"] for r in result)

async def test_list_public_users_hides_blocked(db_conn):
    a = await user_repo.create_user("profile_test_listusers_1", "s3cret-password")
    b = await user_repo.create_user("profile_test_listusers_2", "s3cret-password")
    from backend.repositories import blocks as block_repo
    await block_repo.block_user(a["id"], b["id"])

    result = await profile.list_public_users(q=None, current_user=_as_user(a))

    assert all(r.get("username") != "profile_test_listusers_2" for r in result)
