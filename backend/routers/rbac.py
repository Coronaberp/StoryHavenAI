from fastapi import Depends, HTTPException

from backend.state import api, log
from backend.auth import get_dev, CAPABILITY_REGISTRY
from backend.repositories import roles as roles_repo
from backend.repositories import role_capabilities as role_capabilities_repo
from backend.schemas import RoleCreateIn, RoleCapabilitiesBatchIn

@api.get("/admin/rbac/roles")
async def list_roles(current_user: dict = Depends(get_dev)):
    return await roles_repo.list_all()

@api.post("/admin/rbac/roles")
async def create_role(body: RoleCreateIn, current_user: dict = Depends(get_dev)):
    try:
        await roles_repo.create(body.name, body.label)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    log.info("rbac: role created name=%s by=%s", body.name, current_user["username"])
    return await roles_repo.get(body.name)

@api.delete("/admin/rbac/roles/{name}")
async def delete_role(name: str, current_user: dict = Depends(get_dev)):
    try:
        await roles_repo.delete(name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    log.info("rbac: role deleted name=%s by=%s", name, current_user["username"])
    return {"deleted": True}

@api.get("/admin/rbac/capabilities")
async def list_capabilities(current_user: dict = Depends(get_dev)):
    return [{"key": k, "namespace": k.split(".")[0], "description": v}
            for k, v in sorted(CAPABILITY_REGISTRY.items())]

@api.get("/admin/rbac/roles/{name}/capabilities")
async def get_role_capabilities(name: str, current_user: dict = Depends(get_dev)):
    return await role_capabilities_repo.list_for_role(name)

@api.put("/admin/rbac/roles/{name}/capabilities")
async def set_role_capabilities(name: str, body: RoleCapabilitiesBatchIn, current_user: dict = Depends(get_dev)):
    await role_capabilities_repo.set_all(name, body.capabilities)
    log.info("rbac: capabilities set role=%s count=%d by=%s", name, len(body.capabilities), current_user["username"])
    return {"role": name, "capabilities": body.capabilities}
