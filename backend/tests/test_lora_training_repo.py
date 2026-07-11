import pytest

from backend.repositories import lora_training as lora_training_repo

pytestmark = pytest.mark.asyncio


async def _make_job(db_conn, name="test-lora"):
    return await lora_training_repo.create_job(
        user_id="test-user", name=name, trigger_word="trg",
        base_checkpoint="base.safetensors", resolution=512, rank=16, alpha=16,
        learning_rate=0.0001, steps=100, batch_size=1, image_count=10)


async def test_create_and_get_job(db_conn):
    job = await _make_job(db_conn)
    assert job["name"] == "test-lora"
    assert job["status"] == "queued"

    fetched = await lora_training_repo.get_job(job["id"])
    assert fetched["id"] == job["id"]
    assert fetched["metrics"] == []


async def test_get_job_missing_returns_none(db_conn):
    assert await lora_training_repo.get_job("nonexistent") is None


async def test_update_job(db_conn):
    job = await _make_job(db_conn)
    await lora_training_repo.update_job(job["id"], status="training", progress=0.5)
    updated = await lora_training_repo.get_job(job["id"])
    assert updated["status"] == "training"
    assert updated["progress"] == 0.5


async def test_update_job_terminal_status_sets_resolved(db_conn):
    job = await _make_job(db_conn)
    await lora_training_repo.update_job(job["id"], status="done")
    updated = await lora_training_repo.get_job(job["id"])
    assert updated["status"] == "done"
    assert updated["resolved"] is not None


async def test_append_metric(db_conn):
    job = await _make_job(db_conn)
    await lora_training_repo.append_metric(job["id"], {"epoch": 1, "loss": 0.5})
    await lora_training_repo.append_metric(job["id"], {"epoch": 2, "loss": 0.3})
    updated = await lora_training_repo.get_job(job["id"])
    assert len(updated["metrics"]) == 2
    assert updated["metrics"][-1]["loss"] == 0.3


async def test_append_metric_missing_job_is_noop(db_conn):
    await lora_training_repo.append_metric("nonexistent", {"epoch": 1})


async def test_list_jobs(db_conn):
    job1 = await _make_job(db_conn, name="job-a")
    job2 = await _make_job(db_conn, name="job-b")
    jobs = await lora_training_repo.list_jobs(user_id="test-user")
    ids = {j["id"] for j in jobs}
    assert job1["id"] in ids
    assert job2["id"] in ids


async def test_delete_job(db_conn):
    job = await _make_job(db_conn)
    await lora_training_repo.delete_job(job["id"])
    assert await lora_training_repo.get_job(job["id"]) is None


async def test_create_list_delete_checkpoint(db_conn):
    job = await _make_job(db_conn)
    ckpt = await lora_training_repo.create_checkpoint(job["id"], "checkpoint_1.safetensors")
    assert ckpt["job_id"] == job["id"]

    checkpoints = await lora_training_repo.list_checkpoints(job["id"])
    assert any(c["id"] == ckpt["id"] for c in checkpoints)

    deleted = await lora_training_repo.delete_checkpoint(ckpt["id"])
    assert deleted["id"] == ckpt["id"]

    checkpoints_after = await lora_training_repo.list_checkpoints(job["id"])
    assert not any(c["id"] == ckpt["id"] for c in checkpoints_after)


async def test_delete_checkpoint_missing_returns_none(db_conn):
    assert await lora_training_repo.delete_checkpoint("nonexistent") is None
