import pytest

from backend import seed_content
from backend.repositories import characters as chars_repo
from backend.repositories import personas as personas_repo

pytestmark = pytest.mark.asyncio


async def test_seed_creates_bundled_content(db_conn, tmp_path, monkeypatch):
    monkeypatch.setattr(seed_content, "MEDIA_DIR", str(tmp_path))
    created = await seed_content.seed_default_content("admin-user")
    assert created == 3
    chars = await chars_repo.list_all(user_id="admin-user", is_admin=True)
    names = {c["name"] for c in chars}
    assert "Luna" in names
    assert "Magic Academy RPG" in names
    luna = next(c for c in chars if c["name"] == "Luna")
    assert luna["is_public"] is True
    assert luna["mode"] == "character"
    academy = next(c for c in chars if c["name"] == "Magic Academy RPG")
    assert academy["mode"] == "rpg"
    personas = await personas_repo.list_own(user_id="admin-user")
    assert "Tarion Bluerose" in {p["name"] for p in personas}


async def test_seed_copies_avatars_into_media(db_conn, tmp_path, monkeypatch):
    monkeypatch.setattr(seed_content, "MEDIA_DIR", str(tmp_path))
    await seed_content.seed_default_content("admin-user")
    chars = await chars_repo.list_all(user_id="admin-user", is_admin=True)
    luna = next(c for c in chars if c["name"] == "Luna")
    assert luna["avatar"].startswith("/media/seed_")
    fname = luna["avatar"].split("/media/", 1)[1]
    assert (tmp_path / fname).exists()


async def test_seed_attaches_lore(db_conn, tmp_path, monkeypatch):
    from backend.repositories import lore as lore_repo

    monkeypatch.setattr(seed_content, "MEDIA_DIR", str(tmp_path))
    await seed_content.seed_default_content("admin-user")
    chars = await chars_repo.list_all(user_id="admin-user", is_admin=True)
    academy = next(c for c in chars if c["name"] == "Magic Academy RPG")
    entries = await lore_repo.list_for_character(academy["id"], viewer_id="admin-user")
    assert len(entries) > 40
