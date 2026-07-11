import pytest
import pytest_asyncio

from backend import db
from backend.repositories import emojis as custom_emoji_repo

pytestmark = pytest.mark.asyncio

CLAUDE_ID = "u016863391b2a"
TEST_ID = "ucb203e5d3fe9"


@pytest_asyncio.fixture(autouse=True)
async def _ensure_fernet():
    if db._fernet is None:
        await db.init()


async def test_create_and_get(db_conn):
    row = await custom_emoji_repo.create("cooldude", "/media/e1.png", "emoji", CLAUDE_ID)
    assert row["shortcode"] == "cooldude"
    fetched = await custom_emoji_repo.get(row["id"])
    assert fetched["id"] == row["id"]


async def test_create_invalid_shortcode_returns_none(db_conn):
    assert await custom_emoji_repo.create("A!", "/media/e2.png", "emoji", CLAUDE_ID) is None


async def test_create_rejects_shortcode_owned_by_another_user(db_conn):
    await custom_emoji_repo.create("claimed", "/media/e3.png", "emoji", CLAUDE_ID)
    assert await custom_emoji_repo.create("claimed", "/media/e4.png", "emoji", TEST_ID) is None


async def test_create_same_uploader_upserts(db_conn):
    first = await custom_emoji_repo.create("mine", "/media/e5.png", "emoji", CLAUDE_ID)
    second = await custom_emoji_repo.create("mine", "/media/e5b.png", "sticker", CLAUDE_ID)
    assert second["id"] == first["id"]
    assert second["image"] == "/media/e5b.png"
    assert second["kind"] == "sticker"


async def test_set_explicit_and_approve(db_conn):
    row = await custom_emoji_repo.create("gifone", "/media/e6.gif", "sticker", CLAUDE_ID,
                                         is_explicit=True, preview_image="/media/e6_prev.webp")
    assert row["is_explicit"] is True or row["is_explicit"] == 1

    public = await custom_emoji_repo.get(row["id"])
    assert public["image"] == "/media/e6_prev.webp"

    admin_view = await custom_emoji_repo.get(row["id"], admin_view=True)
    assert admin_view["image"] == "/media/e6.gif"

    await custom_emoji_repo.approve(row["id"])
    public = await custom_emoji_repo.get(row["id"])
    assert public["image"] == "/media/e6.gif"


async def test_update_shortcode_and_kind(db_conn):
    row = await custom_emoji_repo.create("oldcode", "/media/e7.png", "emoji", CLAUDE_ID)
    updated = await custom_emoji_repo.update(row["id"], "newcode", "sticker")
    assert updated["shortcode"] == "newcode"
    assert updated["kind"] == "sticker"


async def test_update_missing_returns_none(db_conn):
    assert await custom_emoji_repo.update("nonexistent", "x", None) is None


async def test_update_rejects_taken_shortcode(db_conn):
    a = await custom_emoji_repo.create("codea", "/media/e8.png", "emoji", CLAUDE_ID)
    await custom_emoji_repo.create("codeb", "/media/e9.png", "emoji", CLAUDE_ID)
    assert await custom_emoji_repo.update(a["id"], "codeb", None) is None


async def test_list_all_filters_by_kind(db_conn):
    await custom_emoji_repo.create("elistone", "/media/e10.png", "emoji", CLAUDE_ID)
    await custom_emoji_repo.create("elisttwo", "/media/e11.png", "sticker", CLAUDE_ID)
    stickers = await custom_emoji_repo.list_all(kind="sticker")
    assert any(r["shortcode"] == "elisttwo" for r in stickers)
    assert not any(r["shortcode"] == "elistone" for r in stickers)


async def test_get_sticker_by_image(db_conn):
    row = await custom_emoji_repo.create("stick1", "/media/e12.png", "sticker", CLAUDE_ID)
    found = await custom_emoji_repo.get_sticker_by_image("/media/e12.png")
    assert found["id"] == row["id"]
    assert await custom_emoji_repo.get_sticker_by_image("/media/nonexistent.png") is None


async def test_delete(db_conn):
    row = await custom_emoji_repo.create("todelete", "/media/e13.png", "emoji", CLAUDE_ID)
    await custom_emoji_repo.delete(row["id"])
    assert await custom_emoji_repo.get(row["id"]) is None
