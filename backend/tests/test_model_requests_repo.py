import pytest
from cryptography.fernet import Fernet

from backend import db
from backend.repositories import model_requests as model_request_repo

pytestmark = pytest.mark.asyncio

@pytest.fixture(autouse=True)
def _ensure_fernet():
    if db._fernet is None:
        db._fernet = Fernet(Fernet.generate_key())

async def test_model_request_create_get_list_set_status(db_conn):
    req = await model_request_repo.create("user-1", "cool-model", "http://host/model.safetensors", "please")
    rid = req["id"]
    assert req["status"] == "pending"

    fetched = await model_request_repo.get(rid)
    assert fetched["model_name"] == "cool-model"
    assert fetched["note"] == "please"

    rows = await model_request_repo.list(user_id="user-1")
    assert any(r["id"] == rid for r in rows)

    pending_rows = await model_request_repo.list(pending_only=True)
    assert any(r["id"] == rid for r in pending_rows)

    await model_request_repo.set_status(rid, "approved")
    updated = await model_request_repo.get(rid)
    assert updated["status"] == "approved"
    assert updated["resolved"] is not None
    assert await model_request_repo.get("nonexistent") is None

async def test_model_request_implemented_is_a_distinct_terminal_status(db_conn):
    req = await model_request_repo.create("user-1", "some-lora", "http://host/lora.safetensors", "")
    rid = req["id"]
    await model_request_repo.set_status(rid, "approved")
    await model_request_repo.set_status(rid, "implemented")
    updated = await model_request_repo.get(rid)
    assert updated["status"] == "implemented"
    assert updated["status"] != "rejected"
