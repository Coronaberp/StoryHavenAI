from backend.chat_service import _persona_switch_note


def user_turn(name):
    return {"role": "user", "user_name": name}


def test_no_note_on_first_turn():
    assert _persona_switch_note([user_turn("Tarion")], "Kestrel") is None


def test_no_note_when_persona_unchanged():
    msgs = [user_turn("Tarion"), user_turn("Tarion")]
    assert _persona_switch_note(msgs, "Kestrel") is None


def test_note_fires_on_persona_switch():
    msgs = [user_turn("Tarion"), user_turn("Ryoshu")]
    note = _persona_switch_note(msgs, "Kestrel")
    assert note is not None
    assert "Ryoshu" in note and "Tarion" in note and "Kestrel" in note


def test_no_note_when_snapshot_missing():
    msgs = [{"role": "user", "user_name": None}, user_turn("Ryoshu")]
    assert _persona_switch_note(msgs, "Kestrel") is None


def test_ignores_non_user_messages():
    msgs = [user_turn("Tarion"), {"role": "assistant", "user_name": None}, user_turn("Ryoshu")]
    note = _persona_switch_note(msgs, "Kestrel")
    assert note is not None and "Tarion" in note
