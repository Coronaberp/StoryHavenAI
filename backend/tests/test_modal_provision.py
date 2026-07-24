import asyncio

import httpx
import pytest

from backend import modal_provision
from backend.state import CFG

pytestmark = pytest.mark.asyncio

class _FakeResponse:
    def __init__(self, status_code):
        self.status_code = status_code

class _FakePostClient:
    def __init__(self, response=None, raise_exc=None):
        self._response = response
        self._raise_exc = raise_exc
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, headers=None, json=None):
        self.calls.append((url, headers, json))
        if self._raise_exc:
            raise self._raise_exc
        return self._response

@pytest.mark.parametrize("status_code", [200, 400, 401])
async def test_is_alive_true_for_expected_status_codes(monkeypatch, status_code):
    fake_client = _FakePostClient(response=_FakeResponse(status_code))
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: fake_client)
    assert await modal_provision._is_alive("https://x.modal.run", "secret") is True

async def test_is_alive_false_for_404_stopped_app(monkeypatch):
    fake_client = _FakePostClient(response=_FakeResponse(404))
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: fake_client)
    assert await modal_provision._is_alive("https://x.modal.run", "secret") is False

async def test_is_alive_false_on_transport_error(monkeypatch):
    fake_client = _FakePostClient(raise_exc=httpx.ConnectError("refused"))
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: fake_client)
    assert await modal_provision._is_alive("https://x.modal.run", "secret") is False

async def test_is_alive_sends_bearer_auth_and_empty_job_id(monkeypatch):
    fake_client = _FakePostClient(response=_FakeResponse(200))
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: fake_client)
    await modal_provision._is_alive("https://x.modal.run", "secret-value")
    url, headers, body = fake_client.calls[0]
    assert url == "https://x.modal.run"
    assert headers == {"Authorization": "Bearer secret-value"}
    assert body == {"job_id": ""}

def _set_all_cached(monkeypatch, checkpoint_url="https://x-request-checkpoint.modal.run"):
    monkeypatch.setitem(CFG, "modal_train_url", "https://x-train.modal.run")
    monkeypatch.setitem(CFG, "modal_checkpoint_url", checkpoint_url)
    monkeypatch.setitem(CFG, "modal_check_cached_url", "https://x-check-model-cached.modal.run")
    monkeypatch.setitem(CFG, "modal_upload_model_url", "https://x-upload-model.modal.run")
    monkeypatch.setitem(CFG, "modal_download_output_url", "https://x-download-output.modal.run")
    monkeypatch.setitem(CFG, "modal_shared_secret", "secret-value")

async def test_ensure_deployed_skips_deploy_when_cached_and_alive(monkeypatch):
    _set_all_cached(monkeypatch)
    async def fake_is_alive(url, secret):
        return True
    monkeypatch.setattr(modal_provision, "_is_alive", fake_is_alive)
    async def fail_exec(*a, **kw):
        raise AssertionError("should not deploy when cached and alive")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fail_exec)
    await modal_provision.ensure_deployed()

async def test_ensure_deployed_raises_when_tokens_missing(monkeypatch):
    monkeypatch.delitem(CFG, "modal_train_url", raising=False)
    monkeypatch.setitem(CFG, "modal_train_url", "")
    monkeypatch.setitem(CFG, "modal_checkpoint_url", "")
    monkeypatch.setitem(CFG, "modal_check_cached_url", "")
    monkeypatch.setitem(CFG, "modal_upload_model_url", "")
    monkeypatch.setitem(CFG, "modal_download_output_url", "")
    monkeypatch.setitem(CFG, "modal_shared_secret", "")
    monkeypatch.delenv("MODAL_TOKEN_ID", raising=False)
    monkeypatch.delenv("MODAL_TOKEN_SECRET", raising=False)
    with pytest.raises(modal_provision.ModalProvisionError, match="MODAL_TOKEN_ID"):
        await modal_provision.ensure_deployed()

async def test_ensure_deployed_redeploys_when_not_alive(monkeypatch):
    _set_all_cached(monkeypatch, checkpoint_url="https://x-request-checkpoint.modal.run")
    async def fake_is_alive(url, secret):
        return False
    monkeypatch.setattr(modal_provision, "_is_alive", fake_is_alive)
    monkeypatch.setenv("MODAL_TOKEN_ID", "token-id")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "token-secret")

    deploy_output = (
        "deploying...\n"
        "created https://newapp-train.modal.run\n"
        "created https://newapp-request-checkpoint.modal.run\n"
        "created https://newapp-check-model-cached.modal.run\n"
        "created https://newapp-upload-model.modal.run\n"
        "created https://newapp-download-output.modal.run\n"
        "done\n"
    ).encode()

    class _FakeStdout:
        def __init__(self, data):
            self._lines = data.splitlines(keepends=True)

        async def readline(self):
            if self._lines:
                return self._lines.pop(0)
            return b""

    class _FakeProc:
        def __init__(self):
            self.stdout = _FakeStdout(deploy_output)
            self.returncode = 0

        async def wait(self):
            return None

    async def fake_exec(*args, **kwargs):
        return _FakeProc()

    async def fake_set_settings(values):
        fake_set_settings.called_with = values
    fake_set_settings.called_with = None

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setattr(modal_provision.db, "set_settings", fake_set_settings)

    await modal_provision.ensure_deployed()

    assert CFG["modal_train_url"] == "https://newapp-train.modal.run"
    assert CFG["modal_checkpoint_url"] == "https://newapp-request-checkpoint.modal.run"
    assert CFG["modal_check_cached_url"] == "https://newapp-check-model-cached.modal.run"
    assert CFG["modal_upload_model_url"] == "https://newapp-upload-model.modal.run"
    assert CFG["modal_download_output_url"] == "https://newapp-download-output.modal.run"
    assert fake_set_settings.called_with["modal_train_url"] == "https://newapp-train.modal.run"

async def test_ensure_deployed_raises_when_deploy_command_fails(monkeypatch):
    _set_all_cached(monkeypatch)
    async def fake_is_alive(url, secret):
        return False
    monkeypatch.setattr(modal_provision, "_is_alive", fake_is_alive)
    monkeypatch.setenv("MODAL_TOKEN_ID", "token-id")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "token-secret")

    class _FakeStdout:
        def __init__(self, data):
            self._lines = data.splitlines(keepends=True)

        async def readline(self):
            if self._lines:
                return self._lines.pop(0)
            return b""

    class _FakeProc:
        def __init__(self):
            self.stdout = _FakeStdout(b"Error: something went wrong\n")
            self.returncode = 1

        async def wait(self):
            return None

    async def fake_exec(*args, **kwargs):
        return _FakeProc()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    with pytest.raises(modal_provision.ModalProvisionError, match="Modal deploy failed"):
        await modal_provision.ensure_deployed()

async def test_ensure_deployed_raises_when_urls_not_parseable(monkeypatch):
    _set_all_cached(monkeypatch)
    async def fake_is_alive(url, secret):
        return False
    monkeypatch.setattr(modal_provision, "_is_alive", fake_is_alive)
    monkeypatch.setenv("MODAL_TOKEN_ID", "token-id")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "token-secret")

    class _FakeStdout:
        def __init__(self, data):
            self._lines = data.splitlines(keepends=True)

        async def readline(self):
            if self._lines:
                return self._lines.pop(0)
            return b""

    class _FakeProc:
        def __init__(self):
            self.stdout = _FakeStdout(b"deployed but no urls here\n")
            self.returncode = 0

        async def wait(self):
            return None

    async def fake_exec(*args, **kwargs):
        return _FakeProc()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    with pytest.raises(modal_provision.ModalProvisionError, match="endpoint URLs couldn't be parsed"):
        await modal_provision.ensure_deployed()
