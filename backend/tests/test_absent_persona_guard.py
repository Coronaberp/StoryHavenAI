import pytest

def test_absent_persona_guard_names_who_stepped_out():
    from backend.prompt import _absent_persona_guard
    guard = _absent_persona_guard(["Mira"])
    assert "Mira" in guard
    assert "stepped" in guard.lower() or "left the scene" in guard.lower()

def test_absent_persona_guard_returns_none_for_empty_list():
    from backend.prompt import _absent_persona_guard
    assert _absent_persona_guard([]) is None
    assert _absent_persona_guard(None) is None

def test_build_system_includes_absent_guard_when_names_given():
    from backend.prompt import build_system
    char = {"name": "Aria", "mode": "character", "persona": "", "scenario": "", "system_prompt": "", "dialogue": ""}
    system = build_system(char, None, "Player", mode="character", is_multiplayer=True,
                          other_player_names=[], session_persona_names=[],
                          absent_persona_names=["Mira"])
    assert "Mira" in system

def test_build_system_omits_absent_guard_when_no_names():
    from backend.prompt import build_system
    char = {"name": "Aria", "mode": "character", "persona": "", "scenario": "", "system_prompt": "", "dialogue": ""}
    system = build_system(char, None, "Player", mode="character", is_multiplayer=False,
                          other_player_names=[], session_persona_names=[], absent_persona_names=[])
    assert "stepped out" not in system.lower()
