import httpx
import pytest

from backend import llm

# --- strip_json_fence -------------------------------------------------

def test_strip_json_fence_removes_json_fence():
    assert llm.strip_json_fence('```json\n{"a": 1}\n```') == '{"a": 1}'


def test_strip_json_fence_removes_bare_fence():
    assert llm.strip_json_fence('```\n{"a": 1}\n```') == '{"a": 1}'


def test_strip_json_fence_passthrough_when_no_fence():
    assert llm.strip_json_fence('{"a": 1}') == '{"a": 1}'


def test_strip_json_fence_case_insensitive():
    assert llm.strip_json_fence('```JSON\n{"a": 1}\n```') == '{"a": 1}'


# --- URL normalization --------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("http://host:1234", "http://host:1234/v1"),
    ("http://host:1234/", "http://host:1234/v1"),
    ("http://host:1234/v1", "http://host:1234/v1"),
    ("http://host:1234/v1/", "http://host:1234/v1"),
    ("http://host:1234/api/v1", "http://host:1234/api/v1"),
    ("http://host:1234/chat/completions", "http://host:1234/v1"),
    ("http://host:1234/models", "http://host:1234/v1"),
])
def test_mk_root_normalizes_chat_base(raw, expected):
    assert llm._mk_root(raw) == expected


@pytest.mark.parametrize("raw,expected", [
    ("http://host:1234", "http://host:1234/v1"),
    ("http://host:1234/v1", "http://host:1234/v1"),
    ("http://host:1234/embeddings", "http://host:1234/v1"),
    ("http://host:1234/api/v1", "http://host:1234/api/v1"),
])
def test_mk_root_embed_normalizes_embed_base(raw, expected):
    assert llm._mk_root_embed(raw) == expected


def test_chat_url_embed_url_models_url_use_module_config(monkeypatch):
    monkeypatch.setattr(llm, "_base", "http://chat-host:1/v1")
    monkeypatch.setattr(llm, "_embed_base", "http://embed-host:2/v1")
    assert llm.chat_url() == "http://chat-host:1/v1/chat/completions"
    assert llm.embed_url() == "http://embed-host:2/v1/embeddings"
    assert llm.models_url() == "http://chat-host:1/v1/models"


def test_configure_sets_module_globals():
    llm.configure("http://new-chat/v1", "chat-key", "http://new-embed/v1", "embed-key")
    try:
        assert llm._base == "http://new-chat/v1"
        assert llm._key == "chat-key"
        assert llm._embed_base == "http://new-embed/v1"
        assert llm._embed_key == "embed-key"
    finally:
        llm.configure("http://llamacpp-chat:5001/v1", "", "http://llamacpp-embed:5002/v1", "")


def test_configure_embed_defaults_to_chat_base_when_unset():
    llm.configure("http://only-chat/v1", "chat-key")
    try:
        assert llm._embed_base == "http://only-chat/v1"
        assert llm._embed_key == ""
    finally:
        llm.configure("http://llamacpp-chat:5001/v1", "", "http://llamacpp-embed:5002/v1", "")


# --- auth headers --------------------------------------------------------

def test_headers_uses_override_key():
    assert llm._headers("override-key") == {"Authorization": "Bearer override-key"}


def test_headers_empty_override_means_no_auth():
    assert llm._headers("") == {}


def test_headers_none_falls_back_to_module_key(monkeypatch):
    monkeypatch.setattr(llm, "_key", "module-key")
    assert llm._headers(None) == {"Authorization": "Bearer module-key"}


def test_headers_embed_uses_separate_module_key(monkeypatch):
    monkeypatch.setattr(llm, "_embed_key", "embed-module-key")
    assert llm._headers_embed(None) == {"Authorization": "Bearer embed-module-key"}


# --- ThinkSplitter ---------------------------------------------------------

def test_think_splitter_no_tags_passes_through_as_content():
    s = llm.ThinkSplitter()
    out = s.feed("hello world")
    assert out == [("content", "hello world")]
    assert s.flush() == []


def test_think_splitter_full_think_block_in_one_chunk():
    s = llm.ThinkSplitter()
    out = s.feed("<think>reasoning</think>reply")
    assert out == [("thinking", "reasoning"), ("content", "reply")]


def test_think_splitter_open_tag_split_across_chunks():
    s = llm.ThinkSplitter()
    out1 = s.feed("<thi")
    out2 = s.feed("nk>reasoning</think>reply")
    assert out1 == []
    assert out2 == [("thinking", "reasoning"), ("content", "reply")]


def test_think_splitter_close_tag_split_across_chunks():
    s = llm.ThinkSplitter()
    out1 = s.feed("<think>reasoning</thi")
    out2 = s.feed("nk>reply")
    assert out1 == [("thinking", "reasoning")]
    assert out2 == [("content", "reply")]


def test_think_splitter_content_split_across_many_small_chunks():
    s = llm.ThinkSplitter()
    out = []
    for ch in "<think>abc</think>xyz":
        out.extend(s.feed(ch))
    out.extend(s.flush())
    thinking = "".join(t for ch, t in out if ch == "thinking")
    content = "".join(t for ch, t in out if ch == "content")
    assert thinking == "abc"
    assert content == "xyz"


def test_think_splitter_holds_back_suffix_that_could_be_a_partial_tag():
    s = llm.ThinkSplitter()
    out = s.feed("<think>reasoning<")
    assert out == [("thinking", "reasoning")]
    assert s.pending == "<"


def test_think_splitter_flush_emits_held_back_partial_tag_text():
    s = llm.ThinkSplitter()
    s.feed("<think>reasoning<")
    out = s.flush()
    assert out == [("thinking", "<")]
    assert s.pending == ""


def test_think_splitter_multiple_think_blocks():
    s = llm.ThinkSplitter()
    out = s.feed("<think>a</think>mid<think>b</think>end")
    assert out == [("thinking", "a"), ("content", "mid"), ("thinking", "b"), ("content", "end")]


# --- classify_image_explicit ------------------------------------------------

class _FakeResponse:
    def __init__(self, json_body, status_code=200):
        self._json = json_body
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("error", request=None, response=self)

    def json(self):
        return self._json


class _FakeAsyncClient:
    def __init__(self, reply_content=None, raise_exc=None, **kwargs):
        self._reply_content = reply_content
        self._raise_exc = raise_exc

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, headers=None, json=None):
        if self._raise_exc:
            raise self._raise_exc
        return _FakeResponse({"choices": [{"message": {"content": self._reply_content}}]})


@pytest.mark.asyncio
async def test_classify_image_explicit_parses_yes_with_confidence(monkeypatch):
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(reply_content="yes 87"))
    explicit, confidence, raw = await llm.classify_image_explicit("data:...", "vision-model")
    assert explicit is True
    assert confidence == 87
    assert raw == "yes 87"


@pytest.mark.asyncio
async def test_classify_image_explicit_parses_no(monkeypatch):
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(reply_content="no 95"))
    explicit, confidence, raw = await llm.classify_image_explicit("data:...", "vision-model")
    assert explicit is False
    assert confidence == 95


@pytest.mark.asyncio
async def test_classify_image_explicit_missing_confidence_defaults_zero(monkeypatch):
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(reply_content="yes"))
    explicit, confidence, raw = await llm.classify_image_explicit("data:...", "vision-model")
    assert explicit is True
    assert confidence == 0


@pytest.mark.asyncio
async def test_classify_image_explicit_unparsable_reply_defaults_not_explicit(monkeypatch):
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(reply_content=""))
    explicit, confidence, raw = await llm.classify_image_explicit("data:...", "vision-model")
    assert explicit is False
    assert confidence == 0


@pytest.mark.asyncio
async def test_classify_image_explicit_confidence_clamped_to_range(monkeypatch):
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(reply_content="yes 500"))
    explicit, confidence, raw = await llm.classify_image_explicit("data:...", "vision-model")
    assert confidence == 100


@pytest.mark.asyncio
async def test_classify_image_explicit_transport_error_never_raises(monkeypatch):
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: _FakeAsyncClient(raise_exc=RuntimeError("boom")))
    explicit, confidence, raw = await llm.classify_image_explicit("data:...", "vision-model")
    assert explicit is False
    assert confidence == 0
    assert raw.startswith("<error:")
