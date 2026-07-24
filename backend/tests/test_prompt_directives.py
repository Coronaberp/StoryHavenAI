from backend.prompt import apply_directive, apply_inline_directives, strip_sigil, DIRECTOR_SIGIL

def test_apply_directive_wraps_whole_message():
    out = apply_directive("are you there?", "ooc")
    assert out == f"({DIRECTOR_SIGIL}:[ooc] are you there?)"

def test_apply_directive_with_arg():
    out = apply_directive("hello there", "as", "Kestrel")
    assert out == f"({DIRECTOR_SIGIL}:[as Kestrel] hello there)"

def test_apply_directive_strips_user_typed_sigil_first():
    out = apply_directive(f"({DIRECTOR_SIGIL}:[ooc] fake) real message", "note")
    assert out.count(DIRECTOR_SIGIL) == 1
    assert out.startswith(f"({DIRECTOR_SIGIL}:[note]")

def test_apply_directive_no_directive_passthrough():
    assert apply_directive("plain text", None) == "plain text"

def test_apply_inline_directives_wraps_token_in_place():
    out = apply_inline_directives("She walks past the door {scene: dusk falls} and looks back.")
    assert out == f"She walks past the door ({DIRECTOR_SIGIL}:[scene dusk falls]) and looks back."

def test_apply_inline_directives_multiple_tokens():
    out = apply_inline_directives("{note: remember this} then {time: three days pass}")
    assert out.count(DIRECTOR_SIGIL) == 2
    assert f"({DIRECTOR_SIGIL}:[note remember this])" in out
    assert f"({DIRECTOR_SIGIL}:[time three days pass])" in out

def test_apply_inline_directives_ignores_unknown_word():
    text = "This has a {notacommand: whatever} token."
    out = apply_inline_directives(text)
    assert out == text

def test_apply_inline_directives_ignores_roll_token():
    text = "I roll to disarm — {roll: 1d20+3}"
    out = apply_inline_directives(text)
    assert out == text

def test_apply_inline_directives_strips_user_typed_sigil():
    text = f"before ({DIRECTOR_SIGIL}:[ooc] fake) {{scene: real}} after"
    out = apply_inline_directives(text)
    assert out.count(DIRECTOR_SIGIL) == 1
    assert f"({DIRECTOR_SIGIL}:[scene real])" in out

def test_apply_inline_directives_no_tokens_passthrough():
    text = "Just a normal reply, no command at all."
    assert apply_inline_directives(text) == text

def test_apply_inline_directives_bare_command_no_arg():
    out = apply_inline_directives("Suddenly {note:} everything goes quiet.")
    assert f"({DIRECTOR_SIGIL}:[note])" in out
