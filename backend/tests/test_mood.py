from backend.mood import character_moods, parse_mood

def test_character_moods_collects_across_sections():
    char = {"assets": {
        "stage": {"moods": {"happy": {}, "sad": {}}},
        "music": {"moods": {"tense": {}}},
        "sprites": {"moods": {"happy": {}}},
    }}
    assert character_moods(char) == ["happy", "sad", "tense"]

def test_character_moods_empty_when_no_assets():
    assert character_moods({}) == []
    assert character_moods({"assets": {}}) == []

def test_parse_mood_no_tag_returns_stripped_text_and_none():
    text, mood = parse_mood("  Hello there.  ", ["happy"])
    assert text == "Hello there."
    assert mood is None

def test_parse_mood_strips_trailing_tag_and_returns_canonical_case():
    text, mood = parse_mood("Hi there! [mood: Happy]", ["Happy", "Sad"])
    assert text == "Hi there!"
    assert mood == "Happy"

def test_parse_mood_case_insensitive_match_against_known_moods():
    text, mood = parse_mood("Hi! [mood: HAPPY]", ["happy"])
    assert mood == "happy"

def test_parse_mood_unknown_mood_falls_back_to_lowercased_candidate():
    text, mood = parse_mood("Hi! [mood: mysterious]", [])
    assert text == "Hi!"
    assert mood == "mysterious"

def test_parse_mood_requires_tag_at_end_of_text():
    text, mood = parse_mood("[mood: happy] but then more text after", ["happy"])
    assert mood is None
    assert text == "[mood: happy] but then more text after"

def test_parse_mood_handles_none_text():
    text, mood = parse_mood(None, ["happy"])
    assert text == ""
    assert mood is None
