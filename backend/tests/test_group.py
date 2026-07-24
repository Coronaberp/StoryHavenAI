from backend.group import split_speech, mentioned_speakers

def test_split_quotes_to_dialogue_rest_to_action():
    dialogue, action = split_speech('*traces a sigil in the air* "The wards will hold. For now."')
    assert dialogue == "The wards will hold. For now."
    assert action == "traces a sigil in the air."

def test_split_dialogue_only_has_no_action():
    dialogue, action = split_speech('"Patience, Kael."')
    assert dialogue == "Patience, Kael."
    assert action == ""

def test_split_action_only_has_no_dialogue():
    dialogue, action = split_speech("*kicks the door open*")
    assert dialogue == ""
    assert action == "kicks the door open."

def test_split_multiple_quotes_join():
    dialogue, action = split_speech('"Move." *draws blade* "Now."')
    assert dialogue == "Move. Now."
    assert action == "draws blade."

def test_split_curly_quotes():
    dialogue, action = split_speech('“Up here.” *climbs the wall*')
    assert dialogue == "Up here."
    assert action == "climbs the wall."

def test_mentions_return_named_in_order():
    cast = [{"char_id": "aurelia", "name": "Aurelia"},
            {"char_id": "bram", "name": "Bram"},
            {"char_id": "sistine", "name": "Sistine"}]
    who = mentioned_speakers("Aurelia, Bram - watch your step", cast)
    assert [m["char_id"] for m in who] == ["aurelia", "bram"]

def test_mentions_mention_order_not_cast_order():
    cast = [{"char_id": "aurelia", "name": "Aurelia"},
            {"char_id": "bram", "name": "Bram"}]
    who = mentioned_speakers("Bram, then Aurelia", cast)
    assert [m["char_id"] for m in who] == ["bram", "aurelia"]

def test_mentions_at_handle():
    cast = [{"char_id": "bram", "name": "Bram"}]
    assert [m["char_id"] for m in mentioned_speakers("hey @bram", cast)] == ["bram"]

def test_mentions_word_boundary_no_false_positive():
    cast = [{"char_id": "al", "name": "Al"}]
    assert mentioned_speakers("we should always run", cast) == []

def test_mentions_first_name_of_multiword_name():
    cast = [{"char_id": "minerva", "name": "Minerva Hildemar"},
            {"char_id": "sunspire", "name": "Sunspire Academy"}]
    assert [m["char_id"] for m in mentioned_speakers("Minerva, what do you think?", cast)] == ["minerva"]
    assert [m["char_id"] for m in mentioned_speakers("Sunspire, your turn.", cast)] == ["sunspire"]

def test_mentions_non_ascii_name():
    cast = [{"char_id": "ryoshu", "name": "Ryōshū - The Neighbour"},
            {"char_id": "luna", "name": "Luna"}]
    assert [m["char_id"] for m in mentioned_speakers("Ryōshū, come here.", cast)] == ["ryoshu"]

def test_mentions_skip_title_token():
    cast = [{"char_id": "ryoshu", "name": "The Neighbour"}]
    assert mentioned_speakers("the door is open", cast) == []

def test_mentions_skip_narrator():
    cast = [{"char_id": "narr", "name": "Narrator", "is_narrator": True}]
    assert mentioned_speakers("Narrator, set the scene", cast) == []

def test_cast_block_lists_others():
    from backend.prompt import cast_block
    block = cast_block("Aurelia", [{"name": "Bram", "blurb": "a gruff mercenary"},
                                   {"name": "Sistine"}])
    assert "Bram: a gruff mercenary" in block
    assert "- Sistine" in block
    assert "as Aurelia, you never speak, act, or narrate for them" in block

def test_cast_block_empty():
    from backend.prompt import cast_block
    assert cast_block("Aurelia", []) == ""

def test_narrator_system_names_cast_and_language():
    from backend.prompt import narrator_system
    text = narrator_system(["Aurelia", "Bram"], "Kael", "Spanish")
    assert "Aurelia, Bram" in text
    assert "Kael" in text
    assert "Spanish" in text
    assert "never speak dialogue for any character" in text

def test_parse_id_list_filters_to_valid():
    from backend.chat_service import _parse_id_list
    assert _parse_id_list('["aurelia","bram"]', {"aurelia", "bram", "sistine"}) == ["aurelia", "bram"]

def test_parse_id_list_drops_unknown_and_dupes():
    from backend.chat_service import _parse_id_list
    assert _parse_id_list('["aurelia","ghost","aurelia"]', {"aurelia"}) == ["aurelia"]

def test_parse_id_list_handles_prose_around_json():
    from backend.chat_service import _parse_id_list
    assert _parse_id_list('Sure! ["bram"] should react.', {"bram"}) == ["bram"]

def test_parse_id_list_empty_on_garbage():
    from backend.chat_service import _parse_id_list
    assert _parse_id_list("no json here", {"a"}) == []
