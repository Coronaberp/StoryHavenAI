import inspect

import pytest

pytestmark = pytest.mark.asyncio


def _capability_dependency(fn, param_name="current_user"):
    sig = inspect.signature(fn)
    return sig.parameters[param_name].default.dependency


async def test_list_jobs_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.lora_training import list_lora_training_jobs
    dep = _capability_dependency(list_lora_training_jobs)
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member", "username": "tester"})
    assert exc_info.value.status_code == 403

async def test_list_jobs_allowed_with_capability(db_conn):
    from backend.routers import lora_training
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "lora_training.view")
    dep = _capability_dependency(lora_training.list_lora_training_jobs)
    result = await dep(current_user={"role": "member", "username": "tester"})
    assert result is not None

async def test_delete_job_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.lora_training import delete_lora_training_job
    dep = _capability_dependency(delete_lora_training_job)
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member", "username": "tester"})
    assert exc_info.value.status_code == 403

async def test_delete_job_allowed_with_capability(db_conn):
    from backend.routers import lora_training
    from backend.repositories import role_capabilities as rc
    from backend.repositories import lora_training as lora_training_repo
    await rc.grant("member", "lora_training.manage")
    job = await lora_training_repo.create_job(
        "u1", "job", "sks", "ckpt.safetensors", 512, 16, 16, 0.0001, 1000, 1, 5)
    dep = _capability_dependency(lora_training.delete_lora_training_job)
    result = await dep(current_user={"role": "member", "username": "tester"})
    assert result is not None

async def test_abort_job_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.lora_training import abort_lora_training_job
    dep = _capability_dependency(abort_lora_training_job)
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member", "username": "tester"})
    assert exc_info.value.status_code == 403

async def test_abort_job_allowed_with_capability(db_conn):
    from backend.routers import lora_training
    from backend.repositories import role_capabilities as rc
    from backend.repositories import lora_training as lora_training_repo
    await rc.grant("member", "lora_training.manage")
    job = await lora_training_repo.create_job(
        "u1", "job", "sks", "ckpt.safetensors", 512, 16, 16, 0.0001, 1000, 1, 5)
    dep = _capability_dependency(lora_training.abort_lora_training_job)
    result = await dep(current_user={"role": "member", "username": "tester"})
    assert result is not None

async def test_list_local_checkpoints_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.lora_training import list_local_checkpoints
    dep = _capability_dependency(list_local_checkpoints)
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member", "username": "tester"})
    assert exc_info.value.status_code == 403

async def test_list_local_checkpoints_allowed_with_capability(db_conn):
    from backend.routers import lora_training
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "lora_training.view")
    dep = _capability_dependency(lora_training.list_local_checkpoints)
    result = await dep(current_user={"role": "member", "username": "tester"})
    assert result is not None

async def test_list_job_checkpoints_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.lora_training import list_job_checkpoints
    dep = _capability_dependency(list_job_checkpoints)
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member", "username": "tester"})
    assert exc_info.value.status_code == 403

async def test_list_job_checkpoints_allowed_with_capability(db_conn):
    from backend.routers import lora_training
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "lora_training.view")
    dep = _capability_dependency(lora_training.list_job_checkpoints)
    result = await dep(current_user={"role": "member", "username": "tester"})
    assert result is not None

async def test_request_lora_checkpoint_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.lora_training import request_lora_checkpoint
    dep = _capability_dependency(request_lora_checkpoint)
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member", "username": "tester"})
    assert exc_info.value.status_code == 403

async def test_request_lora_checkpoint_allowed_with_capability(db_conn):
    from backend.routers import lora_training
    from backend.repositories import role_capabilities as rc
    from backend.repositories import lora_training as lora_training_repo
    await rc.grant("member", "lora_training.view")
    job = await lora_training_repo.create_job(
        "u1", "job", "sks", "ckpt.safetensors", 512, 16, 16, 0.0001, 1000, 1, 5)
    await lora_training_repo.update_job(job["id"], status="training")
    dep = _capability_dependency(lora_training.request_lora_checkpoint)
    result = await dep(current_user={"role": "member", "username": "tester"})
    assert result is not None

async def test_delete_job_checkpoint_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.lora_training import delete_job_checkpoint
    dep = _capability_dependency(delete_job_checkpoint)
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member", "username": "tester"})
    assert exc_info.value.status_code == 403

async def test_delete_job_checkpoint_allowed_with_capability(db_conn):
    from backend.routers import lora_training
    from backend.repositories import role_capabilities as rc
    from backend.repositories import lora_training as lora_training_repo
    await rc.grant("member", "lora_training.manage")
    job = await lora_training_repo.create_job(
        "u1", "job", "sks", "ckpt.safetensors", 512, 16, 16, 0.0001, 1000, 1, 5)
    ckpt = await lora_training_repo.create_checkpoint(job["id"], "checkpoint.safetensors")
    dep = _capability_dependency(lora_training.delete_job_checkpoint)
    result = await dep(current_user={"role": "member", "username": "tester"})
    assert result is not None

async def test_create_and_stream_lora_training_job_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.lora_training import create_and_stream_lora_training_job
    dep = _capability_dependency(create_and_stream_lora_training_job)
    with pytest.raises(HTTPException) as exc_info:
        await dep(current_user={"role": "member", "username": "tester"})
    assert exc_info.value.status_code == 403

async def test_create_and_stream_lora_training_job_allowed_with_capability(db_conn):
    from backend.routers import lora_training
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "lora_training.start")
    dep = _capability_dependency(lora_training.create_and_stream_lora_training_job)
    result = await dep(current_user={"role": "member", "username": "tester"})
    assert result is not None
