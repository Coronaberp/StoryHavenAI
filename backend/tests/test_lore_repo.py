import pytest
from fastapi import HTTPException

from backend.repositories import lore, lore_links
from backend.schemas import LoreIn

pytestmark = pytest.mark.asyncio

async def _make_lore(db_conn, char_id=None, name="test-lore", content="secret content"):
    return await lore.create(char_id, ["alpha", "beta"], content, always=False, name=name)

async def test_create_and_get(db_conn):
    lid = await _make_lore(db_conn)
    entry = await lore.get(lid)
    assert entry["id"] == lid
    assert entry["name"] == "test-lore"
    assert entry["content"] == "secret content"
    assert entry["keys"] == ["alpha", "beta"]
    assert entry["always"] is False
    assert entry["global"] is True

async def test_get_missing_returns_none(db_conn):
    assert await lore.get("nonexistent") is None

async def test_list_for_character_scopes_global_to_viewer(db_conn):
    mine = await lore.create(None, ["k"], "my global", always=False, name="mine", owner_id="user-a")
    theirs = await lore.create(None, ["k"], "their global", always=False, name="theirs", owner_id="user-b")
    ids = {e["id"] for e in await lore.list_for_character("some-char-id", "user-a")}
    assert mine in ids and theirs not in ids

async def test_list_for_character_no_viewer_excludes_global(db_conn):
    lid = await lore.create(None, ["k"], "global", always=False, name="g", owner_id="user-a")
    ids = {e["id"] for e in await lore.list_for_character("some-char-id")}
    assert lid not in ids

async def test_update(db_conn):
    lid = await _make_lore(db_conn, name="before-update")
    ok = await lore.update(lid, ["gamma"], "updated content", always=True, hidden=True)
    assert ok is True
    entry = await lore.get(lid)
    assert entry["content"] == "updated content"
    assert entry["keys"] == ["gamma"]
    assert entry["always"] is True
    assert entry["hidden"] is True
    assert entry["name"] == "before-update"

async def test_update_missing_returns_false(db_conn):
    assert await lore.update("nonexistent", ["k"], "c", always=False) is False

async def test_delete(db_conn):
    lid = await _make_lore(db_conn)
    await lore.delete(lid)
    assert await lore.get(lid) is None

async def test_by_ids(db_conn):
    lid1 = await _make_lore(db_conn, name="one")
    lid2 = await _make_lore(db_conn, name="two")
    entries = await lore.by_ids([lid1, lid2, "nonexistent"])
    ids = {e["id"] for e in entries}
    assert ids == {lid1, lid2}

async def test_by_ids_empty_list(db_conn):
    assert await lore.by_ids([]) == []

async def test_list_mine_scoped_to_owner(db_conn):
    from backend.repositories import characters as characters_repo

    char_a = await characters_repo.create({"owner_id": "user-a", "name": "Char A"})
    char_b = await characters_repo.create({"owner_id": "user-b", "name": "Char B"})
    lid_a1 = await lore.create(char_a["id"], ["k1"], "content a1", always=False, name="a1")
    lid_a2 = await lore.create(char_a["id"], ["k2"], "content a2", always=False, name="a2")
    await lore.create(char_b["id"], ["k3"], "content b1", always=False, name="b1")

    entries = await lore.list_mine("user-a")

    ids = [e["id"] for e in entries]
    assert ids == [lid_a2, lid_a1]
    assert all(e["name"] in ("a1", "a2") for e in entries)

async def test_list_mine_no_characters_returns_empty(db_conn):
    assert await lore.list_mine("nobody") == []

async def test_list_mine_includes_only_own_global_lore(db_conn):
    from backend.repositories import characters as characters_repo

    char = await characters_repo.create({"owner_id": "user-a", "name": "Char A"})
    await lore.create(char["id"], ["k1"], "owned content", always=False, name="owned")
    await lore.create(None, ["k2"], "my global", always=False, name="my-global", owner_id="user-a")
    await lore.create(None, ["k3"], "their global", always=False, name="their-global", owner_id="user-b")
    await lore.create(None, ["k4"], "ownerless global", always=False, name="legacy-global")

    names = [e["name"] for e in await lore.list_mine("user-a")]

    assert "owned" in names and "my-global" in names
    assert "their-global" not in names and "legacy-global" not in names

async def test_add_lore_route_ignores_global_flag(db_conn):
    from backend.repositories import characters as characters_repo
    from backend.routers.lore import add_lore

    char = await characters_repo.create({"owner_id": "user-a", "name": "Char A"})
    body = LoreIn(content="attempted global lore", **{"global": True})
    user = {"id": "user-a", "username": "user-a", "is_admin": False}

    result = await add_lore(char["id"], body, current_user=user)

    entry = await lore.get(result["id"])
    assert entry["global"] is False and entry["char_id"] == char["id"]

async def test_add_global_lore_route_sets_owner(db_conn):
    from backend.routers.lore import add_global_lore

    body = LoreIn(content="my global lore", name="mine")
    user = {"id": "user-a", "username": "user-a", "is_admin": False}

    result = await add_global_lore(body, current_user=user)

    entry = await lore.get(result["id"])
    assert entry["global"] is True and entry["owner_id"] == "user-a"

async def test_global_lore_edit_scoped_to_owner(db_conn):
    from backend.routers.lore import update_lore

    lid = await lore.create(None, ["k"], "global content", always=False, name="g", owner_id="user-a")
    body = LoreIn(content="changed")
    stranger = {"id": "user-b", "username": "user-b", "is_admin": False}

    with pytest.raises(HTTPException) as exc_info:
        await update_lore(lid, body, current_user=stranger)
    assert exc_info.value.status_code == 403

    owner = {"id": "user-a", "username": "user-a", "is_admin": False}
    await update_lore(lid, body, current_user=owner)
    assert (await lore.get(lid))["content"] == "changed"

async def test_usable_as_persona_defaults_false(db_conn):
    lid = await _make_lore(db_conn)
    entry = await lore.get(lid)
    assert entry["usable_as_persona"] is False

async def test_set_usable_as_persona(db_conn):
    lid = await _make_lore(db_conn)
    await lore.set_usable_as_persona(lid, True)
    entry = await lore.get(lid)
    assert entry["usable_as_persona"] is True
    await lore.set_usable_as_persona(lid, False)
    entry = await lore.get(lid)
    assert entry["usable_as_persona"] is False

async def test_set_lore_usable_as_persona_route_permission(db_conn):
    from backend.repositories import characters as characters_repo
    from backend.routers.lore import set_lore_usable_as_persona
    from backend.schemas import LorePersonaToggleIn

    char = await characters_repo.create({"owner_id": "user-a", "name": "Char A"})
    lid = await lore.create(char["id"], [], "content", always=False, name="npc")
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}
    stranger = {"id": "user-b", "username": "user-b", "is_admin": False}

    with pytest.raises(HTTPException) as exc_info:
        await set_lore_usable_as_persona(lid, LorePersonaToggleIn(value=True), current_user=stranger)
    assert exc_info.value.status_code == 403

    result = await set_lore_usable_as_persona(lid, LorePersonaToggleIn(value=True), current_user=owner)
    assert result["usable_as_persona"] is True
    entry = await lore.get(lid)
    assert entry["usable_as_persona"] is True

async def test_become_persona_from_lore_permission_gate(db_conn):
    from backend.repositories import characters as characters_repo
    from backend.routers.lore import become_persona_from_lore

    char = await characters_repo.create({"owner_id": "user-a", "name": "Char A"})
    lid = await lore.create(char["id"], [], "An alchemist NPC.", always=False, name="Urabel",
                            image="/media/urabel.png")
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}
    stranger = {"id": "user-b", "username": "user-b", "is_admin": False}

    with pytest.raises(HTTPException) as exc_info:
        await become_persona_from_lore(lid, current_user=stranger)
    assert exc_info.value.status_code == 403

    owner_persona = await become_persona_from_lore(lid, current_user=owner)
    assert owner_persona["name"] == "Urabel"
    assert owner_persona["avatar"] == "/media/urabel.png"

    await lore.set_usable_as_persona(lid, True)
    stranger_persona = await become_persona_from_lore(lid, current_user=stranger)
    assert stranger_persona["name"] == "Urabel"
    assert stranger_persona["id"] != owner_persona["id"]

async def test_become_persona_from_lore_blocks_hidden_for_non_owner(db_conn):
    from backend.repositories import characters as characters_repo
    from backend.routers.lore import become_persona_from_lore

    char = await characters_repo.create({"owner_id": "user-a", "name": "Char A"})
    lid = await lore.create(char["id"], [], "A secret backstory.", always=False, name="Kestrel",
                            hidden=True)
    await lore.set_usable_as_persona(lid, True)
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}
    stranger = {"id": "user-b", "username": "user-b", "is_admin": False}

    with pytest.raises(HTTPException) as exc_info:
        await become_persona_from_lore(lid, current_user=stranger)
    assert exc_info.value.status_code == 403

    owner_persona = await become_persona_from_lore(lid, current_user=owner)
    assert owner_persona["name"] == "Kestrel"

async def test_delete_cleans_up_links(db_conn):
    a = await lore.create(None, [], "a-content", always=False, name="a")
    b = await lore.create(None, [], "b-content", always=False, name="b")
    await lore_links.set_link(a, b, "lives in")
    await lore.delete(a)
    assert await lore_links.incoming_for(b) == []

async def test_list_lore_route_strips_link_labels_touching_hidden_entries(db_conn):
    from backend.repositories import characters as characters_repo
    from backend.routers.lore import list_lore

    char = await characters_repo.create({"owner_id": "user-a", "name": "Char A"})
    secret = await lore.create(char["id"], [], "The cursed blade's true nature.",
                               always=False, name="Cursed Blade", hidden=True)
    visible = await lore.create(char["id"], [], "A wandering knight.",
                                always=False, name="Knight", hidden=False)
    await lore_links.set_link(visible, secret, "wielder of the cursed blade")
    await lore_links.set_link(secret, visible, "bound to")

    owner = {"id": "user-a", "username": "user-a", "is_admin": False}
    stranger = None

    owner_view = await list_lore(char["id"], current_user=owner)
    owner_knight = next(e for e in owner_view if e["id"] == visible)
    assert owner_knight["outgoing_links"][0]["label"] == "wielder of the cursed blade"

    public_char = await characters_repo.create({"owner_id": "user-a", "name": "Char B", "is_public": True})
    secret2 = await lore.create(public_char["id"], [], "Secret content.", always=False,
                                name="Secret", hidden=True)
    visible2 = await lore.create(public_char["id"], [], "Public content.", always=False,
                                 name="Visible", hidden=False)
    await lore_links.set_link(visible2, secret2, "guards")
    await lore_links.set_link(secret2, visible2, "trusts")

    public_view = await list_lore(public_char["id"], current_user=stranger)
    visible_entry = next(e for e in public_view if e["id"] == visible2)
    secret_entry = next(e for e in public_view if e["id"] == secret2)
    assert visible_entry["outgoing_links"][0]["label"] == ""
    assert secret_entry["outgoing_links"][0]["label"] == ""
    assert visible_entry["outgoing_links"][0]["target_id"] == secret2

async def test_update_deletes_secrets_when_content_changes(db_conn):
    from backend.repositories import lore_secrets as ls

    lid = await lore.create(None, [], "original content", always=False, name="s", hidden=True)
    await ls.set_secrets(lid, ["a secret"])
    await lore.update(lid, [], "new content", always=False)
    assert await ls.secrets_for(lid) == []

async def test_update_keeps_secrets_when_content_unchanged(db_conn):
    from backend.repositories import lore_secrets as ls

    lid = await lore.create(None, [], "same content", always=False, name="s", hidden=True)
    await ls.set_secrets(lid, ["a secret"])
    await lore.update(lid, [], "same content", always=True)
    result = await ls.secrets_for(lid)
    assert len(result) == 1

async def test_create_and_get_persists_require_and_exclude_keys(db_conn):
    lid = await lore.create("char-req-1", ["dragon"], "content", False,
                                 require_keys=["cave"], exclude_keys=["slain"])
    entry = await lore.get(lid)
    assert entry["require_keys"] == ["cave"]
    assert entry["exclude_keys"] == ["slain"]

async def test_update_changes_require_and_exclude_keys(db_conn):
    lid = await lore.create("char-req-2", ["dragon"], "content", False)
    await lore.update(lid, ["dragon"], "content", False,
                           require_keys=["mountain"], exclude_keys=["dead"])
    entry = await lore.get(lid)
    assert entry["require_keys"] == ["mountain"]
    assert entry["exclude_keys"] == ["dead"]
