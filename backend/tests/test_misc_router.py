import pytest
from fastapi import HTTPException

from backend import db
from backend.repositories import characters, chat_sessions, content_reports as content_report_repo
from backend.routers import misc
from backend.schemas import ContentReportIn, LocalizeIn, ResyncUiTranslationsIn, UiTranslateIn

pytestmark = pytest.mark.asyncio

OWNER_ID = "u_owner_misc"


async def _make_session():
    char = await characters.create({"owner_id": OWNER_ID, "name": "Aria", "mode": "character"})
    sid = await chat_sessions.create(char["id"], None, "Chat", "You", user_id=OWNER_ID)
    return sid, char


async def test_report_image_creates_report(db_conn):
    user = {"id": "u_reporter_1", "username": "reporter1", "is_admin": False}
    body = ContentReportIn(kind="avatar", label="Someone's avatar", target_id="target-1",
                           image="/media/x.png", note="looks off")

    result = await misc.report_image(body, current_user=user)

    assert result == {"ok": True}
    stored = await content_report_repo.get_pending_for("u_reporter_1", "avatar", "target-1")
    assert stored is not None
    assert stored["label"] == "Someone's avatar"


async def test_report_image_rejects_duplicate_pending_report(db_conn):
    user = {"id": "u_reporter_2", "username": "reporter2", "is_admin": False}
    body = ContentReportIn(kind="avatar", label="Dup target", target_id="target-2", image="", note="")
    await misc.report_image(body, current_user=user)

    with pytest.raises(HTTPException) as exc_info:
        await misc.report_image(body, current_user=user)

    assert exc_info.value.status_code == 429


async def test_ui_translations_english_passes_through_unchanged(db_conn):
    user = {"id": "u_ui_1", "username": "uiuser", "is_admin": False}
    body = UiTranslateIn(lang="English", strings={"save": "Save"})

    result = await misc.ui_translations(body, current_user=user)

    assert result == {"lang": "English", "strings": {"save": "Save"}}


async def test_ui_translations_returns_source_when_not_cached(db_conn):
    user = {"id": "u_ui_2", "username": "uiuser2", "is_admin": False}
    body = UiTranslateIn(lang="Spanish (Spain)",
                         strings={"save": "Save-zx91q", "cancel": "Cancel-zx91q"})

    result = await misc.ui_translations(body, current_user=user)

    assert result["lang"] == "Spanish (Spain)"
    assert result["strings"] == {"save": "Save-zx91q", "cancel": "Cancel-zx91q"}


async def test_ui_translations_uses_cached_localization(db_conn):
    user = {"id": "u_ui_3", "username": "uiuser3", "is_admin": False}
    from backend.chat_service import _src_hash
    from backend.repositories import localization as localization_repo
    await localization_repo.set([(_src_hash("Save"), "Save", "Guardar")], "spanish (spain)", kind="ui")
    body = UiTranslateIn(lang="Spanish (Spain)", strings={"save": "Save"})

    result = await misc.ui_translations(body, current_user=user)

    assert result["strings"]["save"] == "Guardar"


async def test_admin_resync_ui_translations_rejects_non_admin(db_conn):
    user = {"id": "u_plain_1", "username": "plainuser", "is_admin": False, "role": "user"}
    from backend.auth import get_admin

    with pytest.raises(HTTPException) as exc_info:
        await get_admin(current_user=user)

    assert exc_info.value.status_code == 403


async def test_admin_resync_ui_translations_rejects_empty_strings(db_conn):
    admin = {"id": "u_admin_1", "username": "adminuser", "is_admin": True, "role": "admin"}
    body = ResyncUiTranslationsIn(strings={})

    with pytest.raises(HTTPException) as exc_info:
        await misc.admin_resync_ui_translations(body, current_user=admin)

    assert exc_info.value.status_code == 400


async def test_admin_resync_ui_translations_rejects_concurrent_run(db_conn, monkeypatch):
    admin = {"id": "u_admin_2", "username": "adminuser2", "is_admin": True, "role": "admin"}
    monkeypatch.setattr(misc, "_ui_resync_running", True)
    body = ResyncUiTranslationsIn(strings={"save": "Save"})

    with pytest.raises(HTTPException) as exc_info:
        await misc.admin_resync_ui_translations(body, current_user=admin)

    assert exc_info.value.status_code == 409


async def test_admin_resync_ui_translations_starts_and_completes(db_conn, monkeypatch):
    admin = {"id": "u_admin_3", "username": "adminuser3", "is_admin": True, "role": "admin"}
    monkeypatch.setattr(misc, "_ui_resync_running", False)

    captured = {}

    def _fake_create_task(coro):
        captured["coro"] = coro
        return misc.asyncio.get_event_loop().create_future()

    async def _fake_translate(text, target, chat_model, ep, glossary=None):
        return f"[{target}] {text}"

    monkeypatch.setattr(misc, "translate_text_live", _fake_translate)
    monkeypatch.setattr(misc.asyncio, "create_task", _fake_create_task)
    body = ResyncUiTranslationsIn(strings={"save": "Save"})

    result = await misc.admin_resync_ui_translations(body, current_user=admin)
    assert result["started"] is True
    assert result["keys"] == 1
    assert misc._ui_resync_running is True

    await captured["coro"]
    assert misc._ui_resync_running is False


async def test_localize_returns_source_when_not_cached(db_conn):
    user = {"id": "u_loc_1", "username": "locuser", "is_admin": False}
    body = LocalizeIn(texts=["Hello there"], lang="Spanish (Spain)")

    result = await misc.localize(body, current_user=user)

    assert result["lang"] == "Spanish (Spain)"
    assert result["texts"] == ["Hello there"]


async def test_localize_rejects_text_too_long(db_conn):
    user = {"id": "u_loc_2", "username": "locuser2", "is_admin": False}
    body = LocalizeIn(texts=["x" * 20001], lang="Spanish (Spain)")

    with pytest.raises(HTTPException) as exc_info:
        await misc.localize(body, current_user=user)

    assert exc_info.value.status_code == 400


async def test_localize_defaults_language_from_user_settings(db_conn):
    user = {"id": "u_loc_3", "username": "locuser3", "is_admin": False}
    body = LocalizeIn(texts=["Hello"], lang=None)

    result = await misc.localize(body, current_user=user)

    assert result["lang"] == "English"


async def test_translate_text_live_returns_stripped_translation(db_conn, monkeypatch):
    async def _fake_stream(messages, model, params=None, parse_think=False,
                           base_url=None, api_key=None, pin_host=False):
        yield ("content", "  Hola  ")
    from backend import llm
    monkeypatch.setattr(llm, "chat_stream", _fake_stream)

    result = await misc.translate_text_live("Hello", "Spanish", "some-model", {"chat_base": None, "chat_key": None})

    assert result == "Hola"


async def test_translate_text_live_discards_echo(db_conn, monkeypatch):
    async def _fake_stream(messages, model, params=None, parse_think=False,
                           base_url=None, api_key=None, pin_host=False):
        yield ("content", "Hello")
    from backend import llm
    monkeypatch.setattr(llm, "chat_stream", _fake_stream)

    result = await misc.translate_text_live("Hello", "Spanish", "some-model", {"chat_base": None, "chat_key": None})

    assert result == ""


async def test_translate_text_live_empty_text_returns_immediately(db_conn):
    result = await misc.translate_text_live("   ", "Spanish", "some-model", {"chat_base": None, "chat_key": None})
    assert result == ""


async def test_summarize_session_not_found(db_conn):
    user = {"id": OWNER_ID, "username": "owner", "is_admin": False}

    with pytest.raises(HTTPException) as exc_info:
        await misc.summarize_session("nonexistent-sid", current_user=user)

    assert exc_info.value.status_code == 404


async def test_summarize_session_not_owned_by_caller(db_conn):
    sid, _char = await _make_session()
    other_user = {"id": "u_not_owner", "username": "notowner", "is_admin": False}

    with pytest.raises(HTTPException) as exc_info:
        await misc.summarize_session(sid, current_user=other_user)

    assert exc_info.value.status_code == 404


async def test_summarize_session_no_messages(db_conn):
    sid, _char = await _make_session()
    user = {"id": OWNER_ID, "username": "owner", "is_admin": False}

    result = await misc.summarize_session(sid, current_user=user)

    assert "hasn't started" in result["summary"]


async def test_summarize_session_returns_llm_summary(db_conn, monkeypatch):
    sid, char = await _make_session()
    await chat_sessions.add_message(sid, "user", "Hello there", user_name="You")
    await chat_sessions.add_message(sid, "assistant", "Hi, nice to meet you.", char_id=char["id"])

    async def _fake_stream(messages, model, params=None, parse_think=False,
                           base_url=None, api_key=None, pin_host=False):
        yield ("content", "A short recap of the story so far.")
    from backend import llm
    monkeypatch.setattr(llm, "chat_stream", _fake_stream)
    user = {"id": OWNER_ID, "username": "owner", "is_admin": False}

    result = await misc.summarize_session(sid, current_user=user)

    assert result["summary"] == "A short recap of the story so far."


async def test_summarize_session_llm_failure_returns_502(db_conn, monkeypatch):
    sid, char = await _make_session()
    await chat_sessions.add_message(sid, "user", "Hello", user_name="You")

    async def _boom(*args, **kwargs):
        raise RuntimeError("endpoint unreachable")
        yield
    from backend import llm
    monkeypatch.setattr(llm, "chat_stream", _boom)
    user = {"id": OWNER_ID, "username": "owner", "is_admin": False}

    with pytest.raises(HTTPException) as exc_info:
        await misc.summarize_session(sid, current_user=user)

    assert exc_info.value.status_code == 502


async def test_health_reports_ok_when_dependencies_reachable(db_conn, monkeypatch):
    from backend import vectors, llm
    async def _fake_stats():
        return {"memory_vectors": 0, "lore_vectors": 0}
    async def _fake_embed(text, model):
        return [0.1, 0.2, 0.3]
    monkeypatch.setattr(vectors, "stats", _fake_stats)
    monkeypatch.setattr(llm, "embed", _fake_embed)
    from backend.state import CFG
    monkeypatch.setitem(CFG, "embed_dim", 3)
    user = {"id": "u_health_1", "username": "healthuser", "is_admin": False}

    result = await misc.health(_=user)

    assert result["ok"] is True
    assert result["embeddings"]["ok"] is True
    assert result["embeddings"]["dim"] == 3


async def test_health_reports_embed_failure(db_conn, monkeypatch):
    from backend import vectors, llm
    async def _fake_stats():
        return {"memory_vectors": 0, "lore_vectors": 0}
    async def _fail_embed(text, model):
        raise RuntimeError("embed endpoint unreachable")
    monkeypatch.setattr(vectors, "stats", _fake_stats)
    monkeypatch.setattr(llm, "embed", _fail_embed)
    user = {"id": "u_health_2", "username": "healthuser2", "is_admin": False}

    result = await misc.health(_=user)

    assert result["embeddings"]["ok"] is False


async def test_test_embed_success(db_conn, monkeypatch):
    from backend import llm
    async def _fake_embed(text, model):
        return [0.1, 0.2]
    async def _fake_embed_url():
        return "http://embed.example"
    monkeypatch.setattr(llm, "embed", _fake_embed)
    monkeypatch.setattr(llm, "embed_url", lambda: "http://embed.example")
    user = {"id": "u_embed_1", "username": "embeduser", "is_admin": False}

    result = await misc.test_embed(_=user)

    assert result["ok"] is True
    assert result["dim"] == 2


async def test_test_embed_failure(db_conn, monkeypatch):
    from backend import llm
    async def _fail_embed(text, model):
        raise RuntimeError("embed down")
    monkeypatch.setattr(llm, "embed", _fail_embed)
    monkeypatch.setattr(llm, "embed_url", lambda: "http://embed.example")
    user = {"id": "u_embed_2", "username": "embeduser2", "is_admin": False}

    result = await misc.test_embed(_=user)

    assert result["ok"] is False


async def test_docs_live_config_returns_expected_keys(db_conn):
    user = {"id": "u_docs_1", "username": "docsuser", "is_admin": False}

    result = await misc.docs_live_config(_user=user)

    assert set(result.keys()) == {
        "memory_v2_budget_tokens", "memory_batch_size", "history_turns",
        "top_k_memory", "top_k_lore", "mem_max_dist", "lore_max_dist",
    }
