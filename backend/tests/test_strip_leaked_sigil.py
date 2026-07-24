from backend.prompt import strip_leaked_sigil, DIRECTOR_SIGIL

S = DIRECTOR_SIGIL

def test_ooc_keeps_label_drops_sigil():
    reply = f"({S}:[ooc] Hey! So the plan is to ease you in. Sound good?)"
    assert strip_leaked_sigil(reply) == "[ooc: Hey! So the plan is to ease you in. Sound good?]"

def test_directive_with_arg():
    assert strip_leaked_sigil(f"({S}:[as Mira] What did you find?)") == "[as Mira: What did you find?]"

def test_empty_content_keeps_bare_tag():
    assert strip_leaked_sigil(f"({S}:[scene])") == "[scene]"

def test_bare_sigil_glyph_removed():
    assert strip_leaked_sigil(f"She smiles {S} warmly.").replace("  ", " ") == "She smiles warmly."

def test_clean_reply_untouched():
    assert strip_leaked_sigil("She smiles warmly.") == "She smiles warmly."

def test_empty():
    assert strip_leaked_sigil("") == ""
    assert strip_leaked_sigil(None) == ""
