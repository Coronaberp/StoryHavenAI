from backend import memory_ranking


def _lore_fact(**overrides):
    base = {
        "id": "lore-1", "source": "lore", "fact_type": "lore",
        "text": "The Sunken City lies beneath the bay.",
        "participants": [], "importance": 3, "valence": 0,
        "reinforcements": 0, "pinned": False,
        "valid_until_turn": None, "last_turn": 1, "distance": 0.1,
    }
    base.update(overrides)
    return base


def _memory_fact(**overrides):
    base = {
        "id": "mf-1", "fact_type": "event", "text": "the player arrived in town",
        "participants": ["Alice"], "importance": 3, "valence": 0,
        "reinforcements": 0, "pinned": False, "location": None,
        "valid_until_turn": None, "last_turn": 1, "distance": 0.1,
    }
    base.update(overrides)
    return base


def test_lore_candidate_never_decays_regardless_of_age():
    fact = _lore_fact(last_turn=1)
    assert memory_ranking.retention(fact, current_turn=10_000) == 1.0


def test_non_lore_candidate_decays_with_age():
    fact = _memory_fact(last_turn=1, importance=1)
    assert memory_ranking.retention(fact, current_turn=10_000) < memory_ranking.RETENTION_FLOOR


def test_lore_candidate_passes_participants_filter_with_no_participants():
    fact = _lore_fact(participants=[])
    assert memory_ranking.participants_present(fact, present_lower={"alice"}) is True


def test_lore_candidate_with_no_participants_kept_by_passes_filters():
    fact = _lore_fact(participants=[])
    assert memory_ranking.passes_filters(fact, present_lower={"alice"}, current_turn=10_000) is True


def test_low_importance_state_fact_is_not_active():
    fact = _memory_fact(fact_type="state", valid_until_turn=None, importance=1)
    assert memory_ranking.is_active(fact) is False


def test_high_importance_state_fact_is_active():
    fact = _memory_fact(fact_type="state", valid_until_turn=None,
                         importance=memory_ranking.ACTIVE_STATE_IMPORTANCE_FLOOR)
    assert memory_ranking.is_active(fact) is True


def test_low_importance_state_fact_decays_instead_of_pinning_forever():
    fact = _memory_fact(fact_type="state", valid_until_turn=None, importance=1, last_turn=1)
    assert memory_ranking.retention(fact, current_turn=10_000) < memory_ranking.RETENTION_FLOOR


def test_location_matches_when_equal_case_insensitive():
    fact = _memory_fact(location="The Abandoned Mill")
    assert memory_ranking.location_matches(fact, "the abandoned mill") is True


def test_location_matches_when_fact_location_missing():
    fact = _memory_fact(location=None)
    assert memory_ranking.location_matches(fact, "the abandoned mill") is True


def test_location_matches_when_current_location_missing():
    fact = _memory_fact(location="the abandoned mill")
    assert memory_ranking.location_matches(fact, None) is True


def test_location_matches_false_when_different():
    fact = _memory_fact(location="the abandoned mill")
    assert memory_ranking.location_matches(fact, "the tavern") is False


def test_is_active_false_when_location_mismatched():
    fact = _memory_fact(fact_type="state", valid_until_turn=None,
                        importance=memory_ranking.ACTIVE_STATE_IMPORTANCE_FLOOR,
                        location="the abandoned mill")
    assert memory_ranking.is_active(fact, current_location="the tavern") is False


def test_is_active_true_when_location_matches():
    fact = _memory_fact(fact_type="state", valid_until_turn=None,
                        importance=memory_ranking.ACTIVE_STATE_IMPORTANCE_FLOOR,
                        location="the abandoned mill")
    assert memory_ranking.is_active(fact, current_location="the abandoned mill") is True


def test_retention_decays_active_fact_from_mismatched_location():
    fact = _memory_fact(fact_type="state", valid_until_turn=None,
                        importance=memory_ranking.ACTIVE_STATE_IMPORTANCE_FLOOR,
                        location="the abandoned mill", last_turn=1)
    assert memory_ranking.retention(fact, current_turn=10_000, current_location="the tavern") < 1.0


def test_score_applies_location_bonus_on_match():
    matching = _memory_fact(location="the abandoned mill", last_turn=1)
    mismatched = _memory_fact(location="the tavern", last_turn=1)
    matching_score = memory_ranking.score(matching, current_turn=1, current_location="the abandoned mill")
    mismatched_score = memory_ranking.score(mismatched, current_turn=1, current_location="the abandoned mill")
    assert matching_score > mismatched_score


def test_retention_decays_demoted_fact_even_when_location_still_matches():
    fact = _memory_fact(fact_type="state", valid_until_turn=None,
                        importance=memory_ranking.ACTIVE_STATE_IMPORTANCE_FLOOR,
                        location="the tavern", last_turn=1, demoted=True)
    assert memory_ranking.retention(fact, current_turn=10_000, current_location="the tavern") < 1.0


def test_is_active_true_for_demoted_fact_does_not_stop_decay():
    fact = _memory_fact(fact_type="state", valid_until_turn=None,
                        importance=memory_ranking.ACTIVE_STATE_IMPORTANCE_FLOOR,
                        location="the tavern", demoted=True)
    assert memory_ranking.is_active(fact, current_location="the tavern") is True


def test_score_still_applies_location_bonus_to_demoted_matching_fact():
    fact = _memory_fact(fact_type="state", valid_until_turn=None,
                        importance=memory_ranking.ACTIVE_STATE_IMPORTANCE_FLOOR,
                        location="the tavern", last_turn=1, demoted=True)
    other = _memory_fact(fact_type="state", valid_until_turn=None,
                         importance=memory_ranking.ACTIVE_STATE_IMPORTANCE_FLOOR,
                         location="the mountain pass", last_turn=1, demoted=True)
    assert (memory_ranking.score(fact, current_turn=1, current_location="the tavern")
            > memory_ranking.score(other, current_turn=1, current_location="the tavern"))


def test_rank_passes_current_location_through_to_score():
    facts = [
        _memory_fact(id="mf-a", location="the tavern", last_turn=1),
        _memory_fact(id="mf-b", location="the abandoned mill", last_turn=1),
    ]
    ranked = memory_ranking.rank(facts, present=["Alice"], current_turn=1,
                                 current_location="the abandoned mill")
    assert ranked[0]["id"] == "mf-b"
