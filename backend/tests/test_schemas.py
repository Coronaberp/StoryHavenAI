import pytest
from pydantic import ValidationError

from backend.schemas import CharacterIn


def test_character_in_accepts_short_fields():
    CharacterIn(system_prompt="short", persona="short", scenario="short", dialogue="short")


def test_character_in_accepts_exactly_25000_combined():
    CharacterIn(system_prompt="a" * 25000, persona="", scenario="", dialogue="")


def test_character_in_rejects_over_25000_combined():
    with pytest.raises(ValidationError):
        CharacterIn(system_prompt="a" * 25001, persona="", scenario="", dialogue="")


def test_character_in_description_excluded_from_cap():
    CharacterIn(description="a" * 100000, system_prompt="", persona="", scenario="", dialogue="")
