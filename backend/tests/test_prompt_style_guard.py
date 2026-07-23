import pytest

from backend.prompt import build_system, strip_ai_prose_artifacts


def _char(mode="character"):
    return {"name": "Kestrel", "persona": "", "scenario": "", "system_prompt": "",
            "dialogue": "", "mode": mode, "assets": {}}


@pytest.mark.parametrize("mode", ["character", "rpg"])
@pytest.mark.parametrize("full", [True, False])
def test_build_system_bans_em_dash_and_semicolon(mode, full):
    system = build_system(_char(mode), None, "Alice", mode=mode, full=full)
    assert "em dash" in system.lower() or "em dashes" in system.lower()
    assert "semicolon" in system.lower()


@pytest.mark.parametrize("mode", ["character", "rpg"])
def test_build_system_full_includes_npc_name_guidance(mode):
    system = build_system(_char(mode), None, "Alice", mode=mode, full=True)
    assert "Naming new characters" in system
    assert "Vance Arthuria" in system


def test_build_system_full_bans_stock_ai_words():
    system = build_system(_char("character"), None, "Alice", mode="character", full=True)
    for word in ["delve", "tapestry", "testament", "beacon", "nuanced"]:
        assert word in system.lower()


def test_build_system_full_rpg_bans_stock_ai_words():
    system = build_system(_char("rpg"), None, "Alice", mode="rpg", full=True)
    for word in ["delve", "tapestry", "testament", "beacon", "nuanced"]:
        assert word in system.lower()


@pytest.mark.parametrize("full", [True, False])
def test_build_system_rpg_multiplayer_bans_second_person(full):
    system = build_system(_char("rpg"), None, "Alice", mode="rpg", full=full, is_multiplayer=True)
    assert "second person" in system.lower()


@pytest.mark.parametrize("full", [True, False])
def test_build_system_rpg_solo_omits_multiplayer_guard(full):
    system = build_system(_char("rpg"), None, "Alice", mode="rpg", full=full, is_multiplayer=False)
    assert "second person" not in system.lower()


def test_build_system_rpg_multiplayer_bans_voicing_other_players():
    system = build_system(_char("rpg"), None, "Alice", mode="rpg", full=True,
                          is_multiplayer=True, other_player_names=["Tarion Bluerose"])
    assert "Tarion Bluerose" in system
    assert "never" in system.lower() and "dialogue" in system.lower()


def test_build_system_rpg_multiplayer_without_other_players_omits_voicing_clause():
    system = build_system(_char("rpg"), None, "Alice", mode="rpg", full=True,
                          is_multiplayer=True, other_player_names=[])
    assert "NEVER write their dialogue" not in system


def test_build_system_character_mode_ignores_multiplayer_flag():
    system = build_system(_char("character"), None, "Alice", mode="character", full=True, is_multiplayer=True)
    assert "second person" not in system.lower()


def test_build_system_bans_moralizing_and_hedging():
    system = build_system(_char("character"), None, "Alice", mode="character", full=True)
    assert "moralizing" in system.lower()
    assert "worth noting" in system.lower()


def test_strip_ai_prose_artifacts_removes_em_dash():
    assert strip_ai_prose_artifacts("She paused—then smiled.") == "She paused, then smiled."


def test_strip_ai_prose_artifacts_removes_en_dash():
    assert strip_ai_prose_artifacts("She paused–then smiled.") == "She paused, then smiled."


def test_strip_ai_prose_artifacts_removes_semicolon_and_capitalizes():
    assert strip_ai_prose_artifacts("He ran; she followed.") == "He ran. She followed."


def test_strip_ai_prose_artifacts_semicolon_at_end():
    assert strip_ai_prose_artifacts("He ran;") == "He ran."


def test_strip_ai_prose_artifacts_leaves_clean_text_untouched():
    assert strip_ai_prose_artifacts("She smiled at him.") == "She smiled at him."


def test_strip_ai_prose_artifacts_handles_empty():
    assert strip_ai_prose_artifacts("") == ""
    assert strip_ai_prose_artifacts(None) is None
