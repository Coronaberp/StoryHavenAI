import pytest
from pydantic import ValidationError

from backend.schemas import CharacterIn

def test_character_in_accepts_short_fields():
    CharacterIn(system_prompt="short", persona="short", scenario="short", dialogue="short")

def test_character_in_accepts_exactly_40000_combined():
    CharacterIn(system_prompt="a" * 40000, persona="", scenario="", dialogue="")

def test_character_in_rejects_over_40000_combined():
    with pytest.raises(ValidationError):
        CharacterIn(system_prompt="a" * 40001, persona="", scenario="", dialogue="")

def test_character_in_description_excluded_from_cap():
    CharacterIn(description="a" * 100000, system_prompt="", persona="", scenario="", dialogue="")
