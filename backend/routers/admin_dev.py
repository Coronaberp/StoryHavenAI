import asyncio

from fastapi import Depends

from backend.state import api, log
from backend.auth import get_dev

_e2e_run_running = False
_e2e_run_exit_code: int | None = None
_e2e_run_log = ""
_E2E_LOG_MAX_CHARS = 200_000


async def _run_e2e_tests():
    global _e2e_run_running, _e2e_run_exit_code, _e2e_run_log
    _e2e_run_log = ""
    _e2e_run_exit_code = None
    proc = await asyncio.create_subprocess_exec(
        "python3", "-m", "pytest", "-v",
        cwd="tests/e2e",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    try:
        assert proc.stdout is not None
        async for raw_line in proc.stdout:
            _e2e_run_log += raw_line.decode(errors="replace")
            if len(_e2e_run_log) > _E2E_LOG_MAX_CHARS:
                _e2e_run_log = _e2e_run_log[-_E2E_LOG_MAX_CHARS:]
        _e2e_run_exit_code = await proc.wait()
        log.info("admin_dev: e2e test run finished exit_code=%s", _e2e_run_exit_code)
    except Exception as exc:
        log.error("admin_dev: e2e test run failed: %s", exc)
        _e2e_run_exit_code = -1
    finally:
        _e2e_run_running = False


@api.post("/admin/dev/run-e2e-tests")
async def admin_run_e2e_tests(current_user: dict = Depends(get_dev)):
    global _e2e_run_running
    if _e2e_run_running:
        from fastapi import HTTPException
        raise HTTPException(409, "An E2E test run is already in progress.")
    _e2e_run_running = True
    log.info("admin_dev: e2e test run started by=%s", current_user["username"])
    asyncio.create_task(_run_e2e_tests())
    return {"started": True}


@api.get("/admin/dev/e2e-test-status")
async def admin_e2e_test_status(current_user: dict = Depends(get_dev)):
    return {"running": _e2e_run_running, "exit_code": _e2e_run_exit_code, "log": _e2e_run_log}
