import pytest

pytestmark = pytest.mark.asyncio

async def test_role_permissions_table_exists():
    from backend.db import role_permissions
    assert role_permissions.name == "role_permissions"
    cols = {c.name for c in role_permissions.columns}
    assert cols == {"role", "resource", "can_read", "can_write", "can_execute"}

from backend.repositories import role_permissions as rp

async def test_set_and_get(db_conn):
    await rp.set("member", "chat", True, True, False)
    row = await rp.get("member", "chat")
    assert row == {"can_read": True, "can_write": True, "can_execute": False}

async def test_get_missing_row_returns_none(db_conn):
    assert await rp.get("guest", "lora_training_admin") is None

async def test_set_upserts(db_conn):
    await rp.set("admin", "server_logs", True, False, False)
    await rp.set("admin", "server_logs", True, True, True)
    row = await rp.get("admin", "server_logs")
    assert row == {"can_read": True, "can_write": True, "can_execute": True}

async def test_list_all_returns_every_row(db_conn):
    await rp.set("member", "forum", True, True, False)
    await rp.set("admin", "forum", True, True, True)
    rows = await rp.list_all()
    pairs = {(r["role"], r["resource"]) for r in rows}
    assert ("member", "forum") in pairs
    assert ("admin", "forum") in pairs

async def test_seed_defaults_does_not_overwrite_existing_row(db_conn):
    await rp.set("member", "chat", False, False, False)
    await rp.seed_defaults()
    row = await rp.get("member", "chat")
    assert row == {"can_read": False, "can_write": False, "can_execute": False}

async def test_seed_defaults_creates_member_feature_key_rows(db_conn):
    await rp.seed_defaults()
    row = await rp.get("member", "personas")
    assert row == {"can_read": True, "can_write": True, "can_execute": False}

async def test_seed_defaults_guest_only_has_chat(db_conn):
    await rp.seed_defaults()
    chat = await rp.get("guest", "chat")
    assert chat == {"can_read": True, "can_write": True, "can_execute": False}
    other = await rp.get("guest", "personas")
    assert other is None or other == {"can_read": False, "can_write": False, "can_execute": False}

async def test_seed_defaults_admin_has_execute_on_admin_resources(db_conn):
    await rp.seed_defaults()
    row = await rp.get("admin", "user_management")
    assert row == {"can_read": True, "can_write": True, "can_execute": True}
