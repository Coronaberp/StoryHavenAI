import pytest

from backend.routers import chat as chat_router
from backend.schemas import ChatIn
from backend.prompt import DIRECTOR_SIGIL

pytestmark = pytest.mark.asyncio


@pytest.fixture()
def wired(monkeypatch):
    calls = {}

    async def fake_own_session(sid, current_user):
        return {"id": sid}

    async def fake_run(sid, user_content=None, **kwargs):
        calls["user_content"] = user_content
        return {"ok": True}

    monkeypatch.setattr(chat_router, "_own_session", fake_own_session)
    monkeypatch.setattr(chat_router, "_run", fake_run)
    return calls


async def test_chat_whole_message_directive_wraps_everything(wired):
    body = ChatIn(content="are you there?", directive="ooc")
    await chat_router.chat("sid1", body, current_user={"id": "u1"})
    assert wired["user_content"] == f"({DIRECTOR_SIGIL}:[ooc] are you there?)"


async def test_chat_no_directive_resolves_inline_tokens(wired):
    body = ChatIn(content="She walks past the door {scene: dusk falls} and looks back.")
    await chat_router.chat("sid1", body, current_user={"id": "u1"})
    assert wired["user_content"] == (
        f"She walks past the door ({DIRECTOR_SIGIL}:[scene dusk falls]) and looks back."
    )


async def test_chat_no_directive_and_no_tokens_passes_through(wired):
    body = ChatIn(content="Just a normal reply, no command at all.")
    await chat_router.chat("sid1", body, current_user={"id": "u1"})
    assert wired["user_content"] == "Just a normal reply, no command at all."


async def test_chat_inline_roll_resolved_before_inline_directives(wired):
    body = ChatIn(content="I roll to disarm the trap — {roll: 1d20+3}")
    await chat_router.chat("sid1", body, current_user={"id": "u1"})
    assert "🎲" in wired["user_content"]
    assert "{roll:" not in wired["user_content"]
    assert DIRECTOR_SIGIL not in wired["user_content"]
