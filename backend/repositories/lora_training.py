import json
import time

from sqlalchemy import select, insert, update, delete

from backend import db
from backend.db import (
    lora_training_jobs, lora_checkpoints,
    _q, _q1, _w, nid, _decode_lora_job_metrics,
)
from backend.state import log


async def create_job(user_id: str, name: str, trigger_word: str, base_checkpoint: str,
                      resolution: int, rank: int, alpha: int, learning_rate: float,
                      steps: int, batch_size: int, image_count: int,
                      resume_from_lora: str | None = None) -> dict:
    jid = nid("lt")
    created = time.time()
    values = dict(id=jid, user_id=user_id, name=name, trigger_word=trigger_word,
                  base_checkpoint=base_checkpoint, resolution=resolution, rank=rank, alpha=alpha,
                  learning_rate=learning_rate, steps=steps, batch_size=batch_size,
                  image_count=image_count, status="queued", progress=0.0, created=created,
                  resume_from_lora=resume_from_lora)
    await _w(insert(lora_training_jobs).values(**values))
    log.info(f"lora training job created id={jid} user={user_id} name={name!r}")
    return await get_job(jid)


async def get_job(jid: str) -> dict | None:
    row = await _q1(select(lora_training_jobs).where(lora_training_jobs.c.id == jid))
    return _decode_lora_job_metrics(row) if row else row


async def append_metric(jid: str, metric: dict):
    row = await _q1(select(lora_training_jobs.c.metrics).where(lora_training_jobs.c.id == jid))
    if row is None:
        log.warning(f"lora training append_metric on missing job id={jid}")
        return
    try:
        history = json.loads(row["metrics"] or "[]")
    except (json.JSONDecodeError, TypeError) as e:
        log.warning(f"lora training append_metric: corrupt metrics history id={jid} error={e}")
        history = []
    history.append(metric)
    history = history[-500:]
    await _w(update(lora_training_jobs).where(lora_training_jobs.c.id == jid).values(metrics=json.dumps(history)))


async def fail_stuck_jobs() -> int:
    now = time.time()
    async with db._engine.begin() as conn:
        result = await conn.execute(update(lora_training_jobs)
                                    .where(lora_training_jobs.c.status.in_(
                                        ("queued", "provisioning", "loading_base_model", "training", "saving")))
                                    .values(status="failed", error="Interrupted by a server restart.", resolved=now))
    if result.rowcount:
        log.warning(f"lora training marked stuck jobs failed count={result.rowcount}")
    return result.rowcount


async def list_jobs(user_id: str | None = None) -> list[dict]:
    stmt = select(lora_training_jobs)
    if user_id:
        stmt = stmt.where(lora_training_jobs.c.user_id == user_id)
    stmt = stmt.order_by(lora_training_jobs.c.created.desc())
    rows = await _q(stmt)
    return [_decode_lora_job_metrics(r) for r in rows]


async def update_job(jid: str, **fields):
    if "status" in fields and fields["status"] in ("done", "failed"):
        fields.setdefault("resolved", time.time())
    await _w(update(lora_training_jobs).where(lora_training_jobs.c.id == jid).values(**fields))
    if "status" in fields:
        log.info(f"lora training job status change id={jid} status={fields['status']}")


async def delete_job(jid: str):
    await _w(delete(lora_training_jobs).where(lora_training_jobs.c.id == jid))
    log.info(f"lora training job deleted id={jid}")


async def create_checkpoint(job_id: str, filename: str) -> dict:
    cid = nid("ltc")
    values = dict(id=cid, job_id=job_id, filename=filename, created=time.time())
    await _w(insert(lora_checkpoints).values(**values))
    log.info(f"lora checkpoint created id={cid} job_id={job_id}")
    return values


async def list_checkpoints(job_id: str | None = None) -> list[dict]:
    stmt = select(lora_checkpoints)
    if job_id:
        stmt = stmt.where(lora_checkpoints.c.job_id == job_id)
    stmt = stmt.order_by(lora_checkpoints.c.created.desc())
    return await _q(stmt)


async def delete_checkpoint(cid: str) -> dict | None:
    row = await _q1(select(lora_checkpoints).where(lora_checkpoints.c.id == cid))
    if row:
        await _w(delete(lora_checkpoints).where(lora_checkpoints.c.id == cid))
        log.info(f"lora checkpoint deleted id={cid}")
    return row
