import pytest
import pytest_asyncio

from backend import db
from backend.repositories import standalone_images as standalone_image_repo

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture(autouse=True)
async def _ensure_fernet():
    """These tests exercise _decrypt_secret (owner display names) against real
    encrypted rows already in the live DB — db._fernet is only populated by
    db.init(), which the conftest db_conn fixture intentionally skips (it
    swaps in its own per-test engine instead, see conftest.py)."""
    if db._fernet is None:
        await db.init()


async def _make_image(db_conn, user_id="test-user", **overrides):
    kwargs = dict(positive="a cat", negative="blurry")
    kwargs.update(overrides)
    return await standalone_image_repo.create(user_id, "/media/test.png", **kwargs)


async def test_create_and_get(db_conn):
    img = await _make_image(db_conn)
    assert img["positive"] == "a cat"
    assert img["is_public"] is False

    fetched = await standalone_image_repo.get(img["id"])
    assert fetched["id"] == img["id"]
    assert fetched["negative"] == "blurry"


async def test_get_missing_returns_none(db_conn):
    assert await standalone_image_repo.get("nonexistent") is None


async def test_list_for_user(db_conn):
    await _make_image(db_conn, user_id="user-a")
    await _make_image(db_conn, user_id="user-a")
    await _make_image(db_conn, user_id="user-b")
    images = await standalone_image_repo.list_for_user("user-a")
    assert len(images) == 2
    assert all(i["id"] for i in images)


async def test_set_public_share_and_unshare(db_conn):
    img = await _make_image(db_conn, user_id="user-a")
    shared = await standalone_image_repo.set_public(img["id"], "user-a", True, True)
    assert shared["is_public"] is True
    assert shared["is_explicit"] is True

    unshared = await standalone_image_repo.set_public(img["id"], "user-a", False)
    assert unshared["is_public"] is False
    assert unshared["is_explicit"] is True


async def test_set_public_wrong_owner_returns_none(db_conn):
    img = await _make_image(db_conn, user_id="user-a")
    assert await standalone_image_repo.set_public(img["id"], "user-b", True) is None


async def test_list_community_only_public_and_excludes_hidden(db_conn):
    # list_community inner-joins against the users table, so the owner id
    # must be a real user — this uses the two fixed test accounts from CLAUDE.md.
    visible = await _make_image(db_conn, user_id="u016863391b2a")
    hidden = await _make_image(db_conn, user_id="ucb203e5d3fe9")
    private = await _make_image(db_conn, user_id="u016863391b2a")
    await standalone_image_repo.set_public(visible["id"], "u016863391b2a", True)
    await standalone_image_repo.set_public(hidden["id"], "ucb203e5d3fe9", True)

    community = await standalone_image_repo.list_community({"ucb203e5d3fe9"})
    ids = {i["id"] for i in community}
    assert visible["id"] in ids
    assert hidden["id"] not in ids
    assert private["id"] not in ids


async def test_set_explicit_and_mark_classified(db_conn):
    img = await _make_image(db_conn)
    await standalone_image_repo.set_explicit(img["id"], True, human_reviewed=True)
    await standalone_image_repo.mark_classified(img["id"])
    fetched = await standalone_image_repo.get(img["id"])
    assert fetched["is_explicit"] is True
    assert fetched["human_reviewed"] is True
    assert fetched["classified"] is True


async def test_delete(db_conn):
    img = await _make_image(db_conn, user_id="user-a")
    url = await standalone_image_repo.delete(img["id"], "user-a")
    assert url == "/media/test.png"
    assert await standalone_image_repo.get(img["id"]) is None


async def test_delete_wrong_owner_returns_none(db_conn):
    img = await _make_image(db_conn, user_id="user-a")
    assert await standalone_image_repo.delete(img["id"], "user-b") is None
    assert await standalone_image_repo.get(img["id"]) is not None


async def test_new_media_columns_default(db_conn):
    img = await _make_image(db_conn)
    fetched = await standalone_image_repo.get(img["id"])
    assert fetched["media_type"] == "image"
    assert fetched["source_image_id"] is None
    assert fetched["fps"] == 0
    assert fetched["frame_count"] == 0
    assert fetched["duration_s"] == 0


async def test_create_inpaint_variant_with_source_image(db_conn):
    original = await _make_image(db_conn, user_id="user-a")
    variant = await standalone_image_repo.create(
        "user-a", "/media/inpaint.png", positive="a dog", negative="blurry",
        media_type="image", source_image_id=original["id"], is_img2img=True)
    assert variant["media_type"] == "image"
    assert variant["source_image_id"] == original["id"]

    fetched = await standalone_image_repo.get(variant["id"])
    assert fetched["source_image_id"] == original["id"]


async def test_create_video(db_conn):
    video = await standalone_image_repo.create(
        "user-a", "/media/clip.mp4", positive="a dog running", negative="",
        media_type="video", is_explicit=True, fps=16, frame_count=48, duration_s=3.0)
    assert video["media_type"] == "video"
    assert video["fps"] == 16
    assert video["frame_count"] == 48
    assert video["duration_s"] == 3.0
    assert video["is_explicit"] is True

    fetched = await standalone_image_repo.get(video["id"])
    assert fetched["media_type"] == "video"
    assert fetched["fps"] == 16


async def test_create_defaults_classified_false(db_conn):
    img = await _make_image(db_conn)
    assert img["classified"] is False

    fetched = await standalone_image_repo.get(img["id"])
    assert fetched["classified"] is False


async def test_create_video_with_classified_true(db_conn):
    video = await standalone_image_repo.create(
        "user-a", "/media/clip.mp4", positive="a dog running", negative="",
        media_type="video", is_explicit=True, fps=16, frame_count=48,
        duration_s=3.0, classified=True)
    assert video["classified"] is True

    fetched = await standalone_image_repo.get(video["id"])
    assert fetched["classified"] is True
