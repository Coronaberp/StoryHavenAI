import math

from backend.memory_ranking import (is_active, retention, passes_filters, participants_present,
                                    rank, RETENTION_FLOOR, STRENGTH_BASE,
                                    STRENGTH_PER_IMPORTANCE, STRENGTH_PER_VALENCE)


def fact(**kw):
    base = {"id": "mf_x", "fact_type": "event", "participants": ["Alice", "Kael"],
            "importance": 3, "valence": 0, "reinforcements": 0,
            "valid_until_turn": None, "last_turn": 10, "pinned": False, "distance": 0.3}
    base.update(kw)
    return base


def test_open_state_is_active_closed_is_not():
    assert is_active(fact(fact_type="state"))
    assert not is_active(fact(fact_type="state", valid_until_turn=50))
    assert not is_active(fact(fact_type="event"))


def test_active_and_pinned_never_decay():
    assert retention(fact(fact_type="state"), 2000) == 1.0
    assert retention(fact(pinned=True), 2000) == 1.0


def test_retention_decays_with_age_and_strength():
    old = fact(last_turn=0)
    strength = STRENGTH_BASE + STRENGTH_PER_IMPORTANCE * 3
    assert math.isclose(retention(old, 100), math.exp(-100 / strength))
    assert retention(old, 100) > retention(old, 500)
    assert retention(fact(last_turn=0, importance=5), 200) > retention(fact(last_turn=0, importance=1), 200)
    assert retention(fact(last_turn=0, valence=-2), 200) > retention(fact(last_turn=0, valence=0), 200)


def test_faded_fact_fails_filter():
    ancient = fact(last_turn=0, importance=1)
    assert retention(ancient, 1000) < RETENTION_FLOOR
    assert not passes_filters(ancient, {"alice", "kael"}, 1000)


def test_participants_hard_filter():
    npc_scene = fact(participants=["Mira", "Bram"])
    assert not passes_filters(npc_scene, {"alice", "kael"}, 20)
    assert passes_filters(npc_scene, {"alice", "mira"}, 20)


def test_world_facts_exempt_from_participant_filter():
    world = fact(fact_type="world", participants=[])
    assert passes_filters(world, {"alice"}, 20)


def test_empty_participants_fails_open():
    orphan = fact(participants=[])
    assert passes_filters(orphan, {"alice"}, 20)


def test_participants_present_standalone():
    assert not participants_present(fact(participants=["Mira"]), {"alice", "kael"})
    assert participants_present(fact(participants=["Mira"]), {"mira"})
    assert participants_present(fact(fact_type="world", participants=[]), {"alice"})


def test_rank_orders_by_relevance_then_filters():
    near = fact(id="near", distance=0.1)
    far = fact(id="far", distance=0.7)
    leaked = fact(id="leak", distance=0.05, participants=["Mira"])
    out = rank([far, near, leaked], ["Alice", "Kael"], 20)
    assert [f["id"] for f in out] == ["near", "far"]
