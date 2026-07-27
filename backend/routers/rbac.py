from fastapi import Depends

from backend.state import api, log
from backend.auth import get_dev
from backend.repositories import role_permissions as role_permissions_repo
from backend.schemas import RolePermissionsBatchIn

@api.get("/admin/rbac/matrix")
async def list_matrix(current_user: dict = Depends(get_dev)):
    return await role_permissions_repo.list_all()

@api.put("/admin/rbac/matrix")
async def update_matrix(body: RolePermissionsBatchIn, current_user: dict = Depends(get_dev)):
    for entry in body.entries:
        await role_permissions_repo.set(entry.role, entry.resource,
                                        entry.can_read, entry.can_write, entry.can_execute)
    log.info("rbac: matrix updated by=%s entries=%d", current_user["username"], len(body.entries))
    return {"updated": len(body.entries)}
