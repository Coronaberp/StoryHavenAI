import pytest
from pydantic import ValidationError

from backend.schemas import CharacterIn, GroupCreateIn, GroupEditIn

def test_character_in_accepts_short_fields():
    CharacterIn(system_prompt="short", persona="short", scenario="short", dialogue="short")

def test_character_in_accepts_exactly_40000_combined():
    CharacterIn(system_prompt="a" * 40000, persona="", scenario="", dialogue="")

def test_character_in_rejects_over_40000_combined():
    with pytest.raises(ValidationError):
        CharacterIn(system_prompt="a" * 40001, persona="", scenario="", dialogue="")

def test_character_in_description_excluded_from_cap():
    CharacterIn(description="a" * 100000, system_prompt="", persona="", scenario="", dialogue="")

def test_character_in_accepts_valid_genre():
    c = CharacterIn(genre="Fantasy")
    assert c.genre == "Fantasy"

def test_character_in_rejects_free_text_genre():
    c = CharacterIn(genre="Not A Real Genre")
    assert c.genre is None

def test_character_in_defaults_genre_to_none():
    c = CharacterIn()
    assert c.genre is None

def test_group_create_in_accepts_valid_genre():
    g = GroupCreateIn(genre="Mystery")
    assert g.genre == "Mystery"

def test_group_create_in_rejects_free_text_genre():
    g = GroupCreateIn(genre="Not A Real Genre")
    assert g.genre is None

def test_group_edit_in_accepts_valid_genre():
    g = GroupEditIn(genre="Adventure")
    assert g.genre == "Adventure"

def test_group_edit_in_rejects_free_text_genre():
    g = GroupEditIn(genre="Not A Real Genre")
    assert g.genre is None
