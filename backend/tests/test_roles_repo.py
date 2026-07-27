import pytest

pytestmark = pytest.mark.asyncio

async def test_roles_table_exists():
    from backend.db import roles
    assert roles.name == "roles"
    cols = {c.name for c in roles.columns}
    assert cols == {"name", "label", "is_builtin", "capabilities_seeded"}

from backend.repositories import roles as roles_repo

async def test_seed_builtins_creates_guest_member_admin(db_conn):
    await roles_repo.seed_builtins()
    names = {r["name"] for r in await roles_repo.list_all()}
    assert {"guest", "member", "admin"} <= names
    assert "dev" not in names

async def test_seed_builtins_marks_them_builtin(db_conn):
    await roles_repo.seed_builtins()
    guest = await roles_repo.get("guest")
    assert guest["is_builtin"] is True

async def test_seed_builtins_does_not_duplicate(db_conn):
    await roles_repo.seed_builtins()
    await roles_repo.seed_builtins()
    names = [r["name"] for r in await roles_repo.list_all()]
    assert names.count("guest") == 1

async def test_create_custom_role(db_conn):
    await roles_repo.create("moderator", "Moderator")
    row = await roles_repo.get("moderator")
    assert row == {"name": "moderator", "label": "Moderator", "is_builtin": False,
                   "capabilities_seeded": False}

async def test_create_rejects_duplicate_name(db_conn):
    await roles_repo.create("moderator", "Moderator")
    with pytest.raises(ValueError):
        await roles_repo.create("moderator", "Moderator Again")

async def test_create_rejects_dev(db_conn):
    with pytest.raises(ValueError):
        await roles_repo.create("dev", "Dev")

async def test_delete_rejects_builtin(db_conn):
    await roles_repo.seed_builtins()
    with pytest.raises(ValueError):
        await roles_repo.delete("member")

async def test_delete_rejects_role_still_in_use(db_conn):
    from backend.repositories import users as user_repo
    await roles_repo.create("moderator", "Moderator")
    await user_repo.create_user("mod1", "password123")
    await user_repo.set_role((await user_repo.get_user_by_username("mod1"))["id"], "moderator")
    with pytest.raises(ValueError):
        await roles_repo.delete("moderator")

async def test_delete_removes_unused_custom_role(db_conn):
    await roles_repo.create("moderator", "Moderator")
    await roles_repo.delete("moderator")
    assert await roles_repo.get("moderator") is None

async def test_delete_cascades_to_role_capabilities(db_conn):
    from backend.repositories import role_capabilities as role_capabilities_repo
    await roles_repo.create("moderator", "Moderator")
    await role_capabilities_repo.grant("moderator", "users.view")
    await roles_repo.delete("moderator")
    assert await role_capabilities_repo.list_for_role("moderator") == []


async def test_list_all_reports_user_count(db_conn):
    from backend.repositories import users as user_repo
    await roles_repo.seed_builtins()
    await user_repo.create_user("member1", "password123")
    rows = {r["name"]: r["user_count"] for r in await roles_repo.list_all()}
    assert rows["member"] >= 1
