import pytest

from backend.chat_service import participant_display_name

pytestmark = pytest.mark.asyncio


def test_persona_name_wins():
    assert participant_display_name({"name": "Kaelen"}, {"display_name": "Dana", "username": "dana1"}) == "Kaelen"


def test_display_name_when_no_persona():
    assert participant_display_name(None, {"display_name": "Dana", "username": "dana1"}) == "Dana"


def test_username_when_display_name_empty():
    assert participant_display_name(None, {"display_name": "", "username": "dana1"}) == "dana1"


def test_you_when_no_user_row():
    assert participant_display_name(None, None) == "You"


def test_empty_persona_name_falls_through():
    assert participant_display_name({"name": ""}, {"display_name": "", "username": "dana1"}) == "dana1"
