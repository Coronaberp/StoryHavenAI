import pytest

from backend.memory_extraction import (
    CharStateDraft, build_extract_prompt, parse_extract_response,
)
from backend.memory_extraction import (
    FactDraft, LoreUpdateDecision, build_lore_update_prompt, build_reconcile_prompt, parse_lore_updates,
)
from backend.memory_extraction import (
    SecretRevealDecision, build_secret_reveal_prompt, parse_secret_reveals,
)

pytestmark = pytest.mark.asyncio


def test_parse_extract_response_splits_facts_and_char_state():
    raw = (
        '{"facts": [{"text": "The player arrived in town.", "fact_type": "event", '
        '"participants": [], "importance": 3, "valence": 0}], '
        '"char_state": {"doing": "standing watch", "location": "the town gate", "npcs": ["Mira"]}}'
    )
    facts, char_state = parse_extract_response(raw)
    assert len(facts) == 1
    assert facts[0].text == "The player arrived in town."
    assert char_state.doing == "standing watch"
    assert char_state.location == "the town gate"
    assert char_state.npcs == ["Mira"]


def test_parse_extract_response_defaults_missing_char_state_to_empty():
    raw = '{"facts": [], "char_state": {"doing": "", "location": "", "npcs": []}}'
    facts, char_state = parse_extract_response(raw)
    assert facts == []
    assert char_state.doing == ""
    assert char_state.npcs == []


def test_build_extract_prompt_requests_combined_shape():
    prompt = build_extract_prompt("Player: hi\nChar: hello", "Char", "Player", "English")
    assert '"facts"' in prompt
    assert '"char_state"' in prompt


def test_build_extract_prompt_group_frames_whole_cast():
    solo = build_extract_prompt("t", "Luna", "Player", "English")
    group = build_extract_prompt("t", "Luna", "Player", "English", cast_names=["Luna", "Ryōshū"])
    assert "between Player and Luna." in solo
    assert "Luna, Ryōshū" in group
    assert "these characters: Luna, Ryōshū" in group


def test_build_extract_prompt_forbids_conversation_meta_observations():
    prompt = build_extract_prompt("Player: hi\nChar: hello", "Char", "Player", "English")
    assert "conversation itself" in prompt
    assert "repetitive" in prompt


def test_build_reconcile_prompt_prefers_supersede_for_recurring_pattern():
    drafts = [FactDraft(text="Alice is preoccupied with a stone bridge and a swollen river",
                        fact_type="state", participants=["Alice"], importance=2, valence=0)]
    neighbors = [[{"id": "mf_abc", "text": "Alice is repeatedly preoccupied with a rutted trail "
                                            "and a tavern crowd"}]]
    prompt = build_reconcile_prompt(drafts, neighbors)
    assert "supersede" in prompt
    assert "Prefer" in prompt
    assert "mf_abc" in prompt
    assert "recurring pattern" in prompt


def test_parse_lore_updates_valid_decision():
    raw = '[{"index": 0, "lore_id": "l-abc", "new_content": "The government was overthrown."}]'
    decisions = parse_lore_updates(raw, fact_count=1, valid_lore_ids={"l-abc"})
    assert len(decisions) == 1
    assert decisions[0].lore_id == "l-abc"
    assert decisions[0].new_content == "The government was overthrown."


def test_parse_lore_updates_empty_array_means_no_updates():
    decisions = parse_lore_updates("[]", fact_count=2, valid_lore_ids={"l-abc"})
    assert decisions == []


def test_parse_lore_updates_rejects_unknown_lore_id():
    raw = '[{"index": 0, "lore_id": "l-unknown", "new_content": "x"}]'
    with pytest.raises(ValueError):
        parse_lore_updates(raw, fact_count=1, valid_lore_ids={"l-abc"})


def test_build_lore_update_prompt_allows_no_update_answer():
    draft = FactDraft(text="the player overthrew the government", fact_type="event",
                      participants=[], importance=5, valence=1)
    prompt = build_lore_update_prompt([draft], [[{"id": "l-abc", "text": "The government rules the city."}]])
    assert "no update" in prompt.lower() or "[]" in prompt


def test_parse_secret_reveals_valid_decision():
    raw = '[{"index": 0, "secret_id": "lsec-abc"}]'
    decisions = parse_secret_reveals(raw, fact_count=1, valid_secret_ids={"lsec-abc"})
    assert len(decisions) == 1
    assert decisions[0].secret_id == "lsec-abc"


def test_parse_secret_reveals_empty_array_means_no_reveals():
    decisions = parse_secret_reveals("[]", fact_count=2, valid_secret_ids={"lsec-abc"})
    assert decisions == []


def test_parse_secret_reveals_rejects_unknown_secret_id():
    raw = '[{"index": 0, "secret_id": "lsec-unknown"}]'
    with pytest.raises(ValueError):
        parse_secret_reveals(raw, fact_count=1, valid_secret_ids={"lsec-abc"})


def test_build_secret_reveal_prompt_allows_no_reveal_answer():
    draft = FactDraft(text="the party found a locked chest", fact_type="event",
                      participants=[], importance=2, valence=0)
    prompt = build_secret_reveal_prompt([draft], [[{"id": "lsec-abc", "text": "The chest holds a cursed ring."}]])
    assert "[]" in prompt
