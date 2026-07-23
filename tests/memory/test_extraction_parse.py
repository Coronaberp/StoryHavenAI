import pytest

from backend.memory_extraction import (FactDraft, CharStateDraft, parse_extract_response,
                                       parse_reconcile, build_extract_prompt, build_reconcile_prompt)

GOOD = ('{"facts": [{"text": "Mira was stabbed.", "fact_type": "state", "participants": ["Mira"], '
        '"importance": 5, "valence": -2}], "char_state": {"doing": "", "location": "", "npcs": []}}')


def test_parse_extract_response_valid():
    facts, char_state = parse_extract_response(GOOD)
    assert len(facts) == 1
    assert facts[0].fact_type == "state"
    assert facts[0].participants == ["Mira"]
    assert char_state == CharStateDraft()


def test_parse_extract_response_strips_fence():
    facts, _ = parse_extract_response("```json\n" + GOOD + "\n```")
    assert len(facts) == 1


def test_parse_extract_response_empty_facts():
    facts, char_state = parse_extract_response('{"facts": [], "char_state": {}}')
    assert facts == []
    assert char_state == CharStateDraft()


def test_parse_extract_response_rejects_bad_type():
    bad = GOOD.replace('"state"', '"opinion"')
    with pytest.raises(ValueError):
        parse_extract_response(bad)


def test_parse_extract_response_rejects_out_of_range_importance():
    bad = GOOD.replace('"importance": 5', '"importance": 9')
    with pytest.raises(ValueError):
        parse_extract_response(bad)


def test_parse_extract_response_rejects_non_object():
    with pytest.raises(ValueError):
        parse_extract_response('[{"text": "x"}]')


def test_parse_extract_response_caps_at_max():
    fact = ('{"text": "Mira was stabbed.", "fact_type": "state", "participants": ["Mira"], '
            '"importance": 5, "valence": -2}')
    many = '{"facts": [' + ",".join([fact] * 15) + '], "char_state": {}}'
    facts, _ = parse_extract_response(many)
    assert len(facts) == 10


def test_parse_reconcile_valid():
    raw = '[{"index": 0, "action": "reinforce", "target_id": "mf_a"}]'
    got = parse_reconcile(raw, 1, {"mf_a"})
    assert got[0].action == "reinforce"
    assert got[0].target_id == "mf_a"


def test_parse_reconcile_add_needs_no_target():
    got = parse_reconcile('[{"index": 0, "action": "add"}]', 1, set())
    assert got[0].action == "add"


def test_parse_reconcile_rejects_unknown_target():
    with pytest.raises(ValueError):
        parse_reconcile('[{"index": 0, "action": "supersede", "target_id": "mf_zzz"}]', 1, {"mf_a"})


def test_parse_reconcile_rejects_missing_decision():
    with pytest.raises(ValueError):
        parse_reconcile('[{"index": 0, "action": "add"}]', 2, set())


def test_parse_reconcile_rejects_target_missing_for_non_add():
    with pytest.raises(ValueError):
        parse_reconcile('[{"index": 0, "action": "supersede"}]', 1, {"mf_a"})


def test_prompts_mention_names_and_format_last():
    p = build_extract_prompt("Alice: hi\nKael: hello", "Kael", "Alice", "English")
    assert "Kael" in p and "English" in p
    assert p.strip().endswith("format.")
    drafts, _ = parse_extract_response(GOOD)
    rp = build_reconcile_prompt(drafts, [[{"id": "mf_a", "text": "Mira got hurt."}]])
    assert "mf_a" in rp and "Mira was stabbed." in rp
