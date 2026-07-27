import pytest
from fastapi import HTTPException

pytestmark = pytest.mark.asyncio

async def test_dev_always_allowed_even_with_no_matrix_row(db_conn):
    from backend.auth import require_permission
    check = require_permission("user_management", "execute")
    user = {"id": "u1", "role": "dev"}
    result = await check(current_user=user)
    assert result is user

async def test_allowed_when_matrix_row_grants_it(db_conn):
    from backend.auth import require_permission
    from backend.repositories import role_permissions as rp
    await rp.set("member", "chat", True, True, False)
    check = require_permission("chat", "write")
    user = {"id": "u2", "role": "member"}
    result = await check(current_user=user)
    assert result is user

async def test_denied_when_matrix_row_lacks_the_bit(db_conn):
    from backend.auth import require_permission
    from backend.repositories import role_permissions as rp
    await rp.set("member", "chat", True, False, False)
    check = require_permission("chat", "write")
    user = {"id": "u3", "role": "member"}
    with pytest.raises(HTTPException) as exc:
        await check(current_user=user)
    assert exc.value.status_code == 403

async def test_denied_when_no_row_exists_fail_closed(db_conn):
    from backend.auth import require_permission
    check = require_permission("lora_training_admin", "read")
    user = {"id": "u4", "role": "guest"}
    with pytest.raises(HTTPException) as exc:
        await check(current_user=user)
    assert exc.value.status_code == 403
