import pytest

pytestmark = pytest.mark.asyncio

async def test_list_roles_returns_seeded_builtins(db_conn):
    from backend.routers import rbac
    from backend.repositories import roles as roles_repo
    await roles_repo.seed_builtins()
    result = await rbac.list_roles(current_user={"role": "dev", "username": "devuser"})
    assert {"guest", "member", "admin"} <= {r["name"] for r in result}

async def test_create_role(db_conn):
    from backend.routers import rbac
    from backend.schemas import RoleCreateIn
    result = await rbac.create_role(RoleCreateIn(name="moderator", label="Moderator"),
                                     current_user={"role": "dev", "username": "devuser"})
    assert result == {"name": "moderator", "label": "Moderator", "is_builtin": False}

async def test_create_role_rejects_duplicate(db_conn):
    from fastapi import HTTPException
    from backend.routers import rbac
    from backend.schemas import RoleCreateIn
    await rbac.create_role(RoleCreateIn(name="moderator", label="Moderator"),
                            current_user={"role": "dev", "username": "devuser"})
    with pytest.raises(HTTPException) as exc_info:
        await rbac.create_role(RoleCreateIn(name="moderator", label="Moderator Again"),
                                current_user={"role": "dev", "username": "devuser"})
    assert exc_info.value.status_code == 400

async def test_delete_role_rejects_builtin(db_conn):
    from fastapi import HTTPException
    from backend.routers import rbac
    from backend.repositories import roles as roles_repo
    await roles_repo.seed_builtins()
    with pytest.raises(HTTPException):
        await rbac.delete_role("member", current_user={"role": "dev", "username": "devuser"})

async def test_list_capabilities_reflects_registry(db_conn):
    from backend.routers import rbac
    from backend.auth import require_capability
    require_capability("test_ns.rbac_router_check", "Used only by this test.")
    result = await rbac.list_capabilities(current_user={"role": "dev", "username": "devuser"})
    assert any(c["key"] == "test_ns.rbac_router_check" and c["namespace"] == "test_ns" for c in result)

async def test_set_and_get_role_capabilities(db_conn):
    from backend.routers import rbac
    from backend.schemas import RoleCapabilitiesBatchIn
    await rbac.set_role_capabilities("member", RoleCapabilitiesBatchIn(capabilities=["comments.delete_any"]),
                                      current_user={"role": "dev", "username": "devuser"})
    result = await rbac.get_role_capabilities("member", current_user={"role": "dev", "username": "devuser"})
    assert result == ["comments.delete_any"]
