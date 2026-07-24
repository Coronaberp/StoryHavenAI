import pytest

from backend.tts import segment_speech

def test_segment_pure_narration():
    assert segment_speech("She walks to the door and knocks.") == [
        ("narration", "She walks to the door and knocks.")]

def test_segment_pure_dialogue():
    assert segment_speech('"Hello there."') == [("dialogue", "Hello there.")]

def test_segment_mixed():
    assert segment_speech('She smiles. "Come in," she says, stepping aside.') == [
        ("narration", "She smiles."),
        ("dialogue", "Come in,"),
        ("narration", "she says, stepping aside.")]

def test_segment_curly_quotes():
    assert segment_speech("He nods. “Of course.”") == [
        ("narration", "He nods."),
        ("dialogue", "Of course.")]

def test_segment_closed_curly_not_tail_leak():
    assert segment_speech("“One.” and “Two.”") == [
        ("dialogue", "One."),
        ("narration", "and"),
        ("dialogue", "Two.")]

def test_segment_unclosed_quote_is_dialogue():
    assert segment_speech('She whispers. "And then everything went dark') == [
        ("narration", "She whispers."),
        ("dialogue", "And then everything went dark")]

def test_segment_adjacent_quotes():
    assert segment_speech('"One." "Two."') == [
        ("dialogue", "One."), ("dialogue", "Two.")]

def test_segment_empty_input():
    assert segment_speech("") == []
    assert segment_speech("   ") == []

def test_segment_empty_quotes_dropped():
    assert segment_speech('Before "" after.') == [
        ("narration", "Before"), ("narration", "after.")]
