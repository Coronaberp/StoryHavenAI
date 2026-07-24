import json

import httpx
import pytest

from backend import modal_client
from backend.state import CFG

pytestmark = pytest.mark.asyncio

class _FakeResponse:
    def __init__(self, status_code=200, text=""):
        self.status_code = status_code
        self._text = text

    async def aread(self):
        return self._text.encode()

    @property
    def text(self):
        return self._text

class _FakePostClient:
    def __init__(self, response):
        self._response = response
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, headers=None, json=None):
        self.calls.append((url, headers, json))
        return self._response

async def test_request_checkpoint_raises_when_url_missing(monkeypatch):
    monkeypatch.setitem(CFG, "modal_checkpoint_url", "")
    monkeypatch.setitem(CFG, "modal_shared_secret", "secret")
    with pytest.raises(modal_client.ModalNotConfigured):
        await modal_client.request_checkpoint("job-1")

async def test_request_checkpoint_raises_when_secret_missing(monkeypatch):
    monkeypatch.setitem(CFG, "modal_checkpoint_url", "https://x.modal.run")
    monkeypatch.setitem(CFG, "modal_shared_secret", "")
    with pytest.raises(modal_client.ModalNotConfigured):
        await modal_client.request_checkpoint("job-1")

async def test_request_checkpoint_posts_with_bearer_auth(monkeypatch):
    monkeypatch.setitem(CFG, "modal_checkpoint_url", "https://x.modal.run")
    monkeypatch.setitem(CFG, "modal_shared_secret", "secret-value")
    fake_client = _FakePostClient(_FakeResponse(status_code=200))
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: fake_client)
    await modal_client.request_checkpoint("job-1")
    url, headers, body = fake_client.calls[0]
    assert url == "https://x.modal.run"
    assert headers == {"Authorization": "Bearer secret-value"}
    assert body == {"job_id": "job-1"}

async def test_request_checkpoint_raises_on_non_200(monkeypatch):
    monkeypatch.setitem(CFG, "modal_checkpoint_url", "https://x.modal.run")
    monkeypatch.setitem(CFG, "modal_shared_secret", "secret-value")
    fake_client = _FakePostClient(_FakeResponse(status_code=500, text="internal error"))
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: fake_client)
    with pytest.raises(RuntimeError, match="500"):
        await modal_client.request_checkpoint("job-1")

async def test_require_deploy_urls_raises_when_train_url_missing(monkeypatch):
    monkeypatch.setitem(CFG, "modal_train_url", "")
    monkeypatch.setitem(CFG, "modal_shared_secret", "secret")
    with pytest.raises(modal_client.ModalNotConfigured, match="train"):
        modal_client._require_deploy_urls()

async def test_require_deploy_urls_raises_when_secret_missing(monkeypatch):
    monkeypatch.setitem(CFG, "modal_train_url", "https://x.modal.run")
    monkeypatch.setitem(CFG, "modal_shared_secret", "")
    with pytest.raises(modal_client.ModalNotConfigured, match="modal_shared_secret"):
        modal_client._require_deploy_urls()

async def test_require_deploy_urls_returns_urls_and_secret_when_set(monkeypatch):
    monkeypatch.setitem(CFG, "modal_train_url", "https://x.modal.run")
    monkeypatch.setitem(CFG, "modal_shared_secret", "secret-value")
    urls, secret = modal_client._require_deploy_urls()
    assert urls == {"train": "https://x.modal.run"}
    assert secret == "secret-value"

class _FakeStreamResponse:
    def __init__(self, status_code=200, text_chunks=None, error_text=""):
        self.status_code = status_code
        self._text_chunks = text_chunks or []
        self._error_text = error_text

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def aiter_text(self):
        for chunk in self._text_chunks:
            yield chunk

    async def aread(self):
        return self._error_text.encode()

class _FakeStreamClient:
    def __init__(self, response):
        self._response = response
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def stream(self, method, url, headers=None, data=None):
        self.calls.append((method, url, headers, data))
        return self._response

async def test_stream_training_job_sends_config_as_json_string(monkeypatch):
    monkeypatch.setitem(CFG, "modal_train_url", "https://x.modal.run")
    monkeypatch.setitem(CFG, "modal_shared_secret", "secret-value")
    response = _FakeStreamResponse(status_code=200, text_chunks=[])
    fake_client = _FakeStreamClient(response)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: fake_client)
    config = {"job_id": "j1", "epochs": 8}
    events = [event async for event in modal_client.stream_training_job(config)]
    assert events == []
    method, url, headers, data = fake_client.calls[0]
    assert method == "POST"
    assert url == "https://x.modal.run"
    assert headers == {"Authorization": "Bearer secret-value"}
    assert json.loads(data["config"]) == config

async def test_stream_training_job_parses_sse_data_events(monkeypatch):
    monkeypatch.setitem(CFG, "modal_train_url", "https://x.modal.run")
    monkeypatch.setitem(CFG, "modal_shared_secret", "secret-value")
    payload_one = json.dumps({"phase": "training", "step": 1})
    payload_two = json.dumps({"phase": "done"})
    response = _FakeStreamResponse(
        status_code=200,
        text_chunks=[f"data: {payload_one}\n\n", f"data: {payload_two}\n\n"])
    fake_client = _FakeStreamClient(response)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: fake_client)
    events = [event async for event in modal_client.stream_training_job({})]
    assert events == [{"phase": "training", "step": 1}, {"phase": "done"}]

async def test_stream_training_job_handles_split_chunks(monkeypatch):
    monkeypatch.setitem(CFG, "modal_train_url", "https://x.modal.run")
    monkeypatch.setitem(CFG, "modal_shared_secret", "secret-value")
    payload = json.dumps({"phase": "training"})
    full_line = f"data: {payload}\n\n"
    midpoint = len(full_line) // 2
    response = _FakeStreamResponse(
        status_code=200,
        text_chunks=[full_line[:midpoint], full_line[midpoint:]])
    fake_client = _FakeStreamClient(response)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: fake_client)
    events = [event async for event in modal_client.stream_training_job({})]
    assert events == [{"phase": "training"}]

async def test_stream_training_job_ignores_non_data_lines(monkeypatch):
    monkeypatch.setitem(CFG, "modal_train_url", "https://x.modal.run")
    monkeypatch.setitem(CFG, "modal_shared_secret", "secret-value")
    payload = json.dumps({"phase": "training"})
    response = _FakeStreamResponse(
        status_code=200,
        text_chunks=[f": comment\n\ndata: {payload}\n\n"])
    fake_client = _FakeStreamClient(response)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: fake_client)
    events = [event async for event in modal_client.stream_training_job({})]
    assert events == [{"phase": "training"}]

async def test_stream_training_job_raises_on_non_200(monkeypatch):
    monkeypatch.setitem(CFG, "modal_train_url", "https://x.modal.run")
    monkeypatch.setitem(CFG, "modal_shared_secret", "secret-value")
    response = _FakeStreamResponse(status_code=503, error_text="service unavailable")
    fake_client = _FakeStreamClient(response)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: fake_client)
    with pytest.raises(RuntimeError, match="503"):
        async for _ in modal_client.stream_training_job({}):
            pass

class _FakeIterEntry:
    def __init__(self, path, size):
        self.path = path
        self.size = size

class _FakeBatchUpload:
    def __init__(self, recorder):
        self._recorder = recorder

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def put_file(self, local_path, remote_name):
        self._recorder.append((local_path, remote_name))

class _FakeVolume:
    def __init__(self, cached_entries):
        self._cached_entries = cached_entries
        self.uploaded = []

    class _Iterdir:
        def __init__(self, entries):
            self._entries = entries

        def aio(self, path, recursive=False):
            return self._async_gen()

        async def _async_gen(self):
            for entry in self._entries:
                yield entry

    @property
    def iterdir(self):
        return self._Iterdir(self._cached_entries)

    def batch_upload(self, force=True):
        return _FakeBatchUpload(self.uploaded)

async def test_ensure_models_cached_skips_already_cached_matching_size(monkeypatch, tmp_path):
    local_file = tmp_path / "model.safetensors"
    local_file.write_bytes(b"x" * 100)
    fake_volume = _FakeVolume([_FakeIterEntry("/model.safetensors", 100)])
    monkeypatch.setattr(modal_client, "_get_volume", lambda: fake_volume)
    await modal_client.ensure_models_cached([("model.safetensors", str(local_file))])
    assert fake_volume.uploaded == []

async def test_ensure_models_cached_uploads_when_size_differs(monkeypatch, tmp_path):
    local_file = tmp_path / "model.safetensors"
    local_file.write_bytes(b"x" * 100)
    fake_volume = _FakeVolume([_FakeIterEntry("/model.safetensors", 50)])
    monkeypatch.setattr(modal_client, "_get_volume", lambda: fake_volume)
    await modal_client.ensure_models_cached([("model.safetensors", str(local_file))])
    assert fake_volume.uploaded == [(str(local_file), "model.safetensors")]

async def test_ensure_models_cached_uploads_when_not_cached_at_all(monkeypatch, tmp_path):
    local_file = tmp_path / "model.safetensors"
    local_file.write_bytes(b"x" * 100)
    fake_volume = _FakeVolume([])
    monkeypatch.setattr(modal_client, "_get_volume", lambda: fake_volume)
    await modal_client.ensure_models_cached([("model.safetensors", str(local_file))])
    assert fake_volume.uploaded == [(str(local_file), "model.safetensors")]
