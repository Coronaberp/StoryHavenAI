from backend.dice import resolve_inline_rolls, roll_dice, format_roll


def test_resolve_inline_rolls_slash_syntax():
    out = resolve_inline_rolls("I roll to disarm the trap — /roll 1d20+3")
    assert "🎲" in out
    assert "/roll" not in out


def test_resolve_inline_rolls_brace_syntax():
    out = resolve_inline_rolls("I roll to disarm the trap — {roll: 1d20+3}")
    assert "🎲" in out
    assert "{roll:" not in out


def test_resolve_inline_rolls_leaves_plain_text_untouched():
    out = resolve_inline_rolls("Just a normal reply, no command at all.")
    assert out == "Just a normal reply, no command at all."


def test_resolve_inline_rolls_multiple_brace_tokens():
    out = resolve_inline_rolls("{roll: 1d6} then {roll: 2d8}")
    assert out.count("🎲") == 2


def test_resolve_inline_rolls_invalid_expr_left_untouched():
    out = resolve_inline_rolls("{roll: not-a-real-expr}")
    assert out == "{roll: not-a-real-expr}"


def test_inline_roll_with_reason():
    from backend.dice import resolve_inline_rolls
    out = resolve_inline_rolls("{roll:2d6 perception check}")
    assert out.startswith("🎲 perception check:") and out.endswith("**")
    assert "{roll" not in out


def test_inline_roll_bare_still_works():
    from backend.dice import resolve_inline_rolls
    out = resolve_inline_rolls("{roll:d20}")
    assert out.startswith("🎲 1d20") and "{roll" not in out
