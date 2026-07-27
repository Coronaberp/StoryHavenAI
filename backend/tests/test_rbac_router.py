import pytest

pytestmark = pytest.mark.asyncio

async def test_list_matrix_returns_seeded_rows(db_conn):
    from backend.routers import rbac
    from backend.repositories import role_permissions as role_permissions_repo
    await role_permissions_repo.seed_defaults()
    result = await rbac.list_matrix(current_user={"role": "dev"})
    assert any(r["role"] == "member" and r["resource"] == "chat" for r in result)

async def test_update_matrix_applies_every_entry(db_conn):
    from backend.routers import rbac
    from backend.schemas import RolePermissionsBatchIn, RolePermissionEntryIn
    from backend.repositories import role_permissions as role_permissions_repo
    body = RolePermissionsBatchIn(entries=[
        RolePermissionEntryIn(role="member", resource="chat", can_read=True, can_write=False, can_execute=False),
    ])
    await rbac.update_matrix(body, current_user={"id": "dev1", "username": "devuser", "role": "dev"})
    row = await role_permissions_repo.get("member", "chat")
    assert row == {"can_read": True, "can_write": False, "can_execute": False}
