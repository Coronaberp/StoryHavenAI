import pytest

pytestmark = pytest.mark.asyncio

async def test_list_jobs_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.lora_training import list_lora_training_jobs
    with pytest.raises(HTTPException) as exc_info:
        await list_lora_training_jobs(current_user={"role": "member", "username": "tester"})
    assert exc_info.value.status_code == 403

async def test_list_jobs_allowed_with_capability(db_conn):
    from backend.routers import lora_training
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "lora_training.view")
    result = await lora_training.list_lora_training_jobs(current_user={"role": "member", "username": "tester"})
    assert result is not None

async def test_delete_job_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.lora_training import delete_lora_training_job
    with pytest.raises(HTTPException) as exc_info:
        await delete_lora_training_job("jid1", current_user={"role": "member", "username": "tester"})
    assert exc_info.value.status_code == 403

async def test_delete_job_allowed_with_capability(db_conn):
    from backend.routers import lora_training
    from backend.repositories import role_capabilities as rc
    from backend.repositories import lora_training as lora_training_repo
    await rc.grant("member", "lora_training.manage")
    job = await lora_training_repo.create_job(
        "u1", "job", "sks", "ckpt.safetensors", 512, 16, 16, 0.0001, 1000, 1, 5)
    result = await lora_training.delete_lora_training_job(job["id"], current_user={"role": "member", "username": "tester"})
    assert result is not None

async def test_abort_job_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.lora_training import abort_lora_training_job
    with pytest.raises(HTTPException) as exc_info:
        await abort_lora_training_job("jid1", current_user={"role": "member", "username": "tester"})
    assert exc_info.value.status_code == 403

async def test_abort_job_allowed_with_capability(db_conn):
    from backend.routers import lora_training
    from backend.repositories import role_capabilities as rc
    from backend.repositories import lora_training as lora_training_repo
    await rc.grant("member", "lora_training.manage")
    job = await lora_training_repo.create_job(
        "u1", "job", "sks", "ckpt.safetensors", 512, 16, 16, 0.0001, 1000, 1, 5)
    result = await lora_training.abort_lora_training_job(job["id"], current_user={"role": "member", "username": "tester"})
    assert result is not None

async def test_list_local_checkpoints_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.lora_training import list_local_checkpoints
    with pytest.raises(HTTPException) as exc_info:
        await list_local_checkpoints(current_user={"role": "member", "username": "tester"})
    assert exc_info.value.status_code == 403

async def test_list_local_checkpoints_allowed_with_capability(db_conn):
    from backend.routers import lora_training
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "lora_training.view")
    result = await lora_training.list_local_checkpoints(current_user={"role": "member", "username": "tester"})
    assert result is not None

async def test_list_job_checkpoints_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.lora_training import list_job_checkpoints
    with pytest.raises(HTTPException) as exc_info:
        await list_job_checkpoints("jid1", current_user={"role": "member", "username": "tester"})
    assert exc_info.value.status_code == 403

async def test_list_job_checkpoints_allowed_with_capability(db_conn):
    from backend.routers import lora_training
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "lora_training.view")
    result = await lora_training.list_job_checkpoints("jid1", current_user={"role": "member", "username": "tester"})
    assert result is not None

async def test_request_lora_checkpoint_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.lora_training import request_lora_checkpoint
    with pytest.raises(HTTPException) as exc_info:
        await request_lora_checkpoint("jid1", current_user={"role": "member", "username": "tester"})
    assert exc_info.value.status_code == 403

async def test_request_lora_checkpoint_allowed_with_capability(db_conn):
    from backend.routers import lora_training
    from backend.repositories import role_capabilities as rc
    from backend.repositories import lora_training as lora_training_repo
    await rc.grant("member", "lora_training.view")
    job = await lora_training_repo.create_job(
        "u1", "job", "sks", "ckpt.safetensors", 512, 16, 16, 0.0001, 1000, 1, 5)
    await lora_training_repo.update_job(job["id"], status="training")
    with pytest.raises(Exception) as exc_info:
        await lora_training.request_lora_checkpoint(job["id"], current_user={"role": "member", "username": "tester"})
    assert getattr(exc_info.value, "status_code", None) != 403

async def test_delete_job_checkpoint_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.lora_training import delete_job_checkpoint
    with pytest.raises(HTTPException) as exc_info:
        await delete_job_checkpoint("cid1", current_user={"role": "member", "username": "tester"})
    assert exc_info.value.status_code == 403

async def test_delete_job_checkpoint_allowed_with_capability(db_conn):
    from backend.routers import lora_training
    from backend.repositories import role_capabilities as rc
    from backend.repositories import lora_training as lora_training_repo
    await rc.grant("member", "lora_training.manage")
    job = await lora_training_repo.create_job(
        "u1", "job", "sks", "ckpt.safetensors", 512, 16, 16, 0.0001, 1000, 1, 5)
    ckpt = await lora_training_repo.create_checkpoint(job["id"], "checkpoint.safetensors")
    result = await lora_training.delete_job_checkpoint(ckpt["id"], current_user={"role": "member", "username": "tester"})
    assert result is not None

async def test_create_and_stream_lora_training_job_denied_without_capability(db_conn):
    from fastapi import HTTPException
    from backend.routers.lora_training import create_and_stream_lora_training_job
    with pytest.raises(HTTPException) as exc_info:
        await create_and_stream_lora_training_job(
            name="test", trigger_word="sks", local_checkpoint="ckpt.safetensors",
            architecture="sdxl", resolution=512, rank=16, alpha=16,
            learning_rate=0.0001, steps=1000, batch_size=1,
            resume_from_lora=None, captions="[]",
            noise_offset=0.0, network_dropout=0.0,
            images=[],
            current_user={"role": "member", "username": "tester"},
            _feature_ok=None,
        )
    assert exc_info.value.status_code == 403

async def test_create_and_stream_lora_training_job_allowed_with_capability(db_conn):
    from backend.routers import lora_training
    from backend.repositories import role_capabilities as rc
    await rc.grant("member", "lora_training.start")
    with pytest.raises(Exception) as exc_info:
        await lora_training.create_and_stream_lora_training_job(
            name="test", trigger_word="sks", local_checkpoint="ckpt.safetensors",
            architecture="sdxl", resolution=512, rank=16, alpha=16,
            learning_rate=0.0001, steps=1000, batch_size=1,
            resume_from_lora=None, captions="[]",
            noise_offset=0.0, network_dropout=0.0,
            images=[],
            current_user={"role": "member", "username": "tester"},
            _feature_ok=None,
        )
    assert getattr(exc_info.value, "status_code", None) != 403
