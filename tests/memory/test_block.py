from backend.memory_block import build_block, estimate_tokens, RESERVED_FRACTION


def fact(fid, text, **kw):
    base = {"id": fid, "text": text, "fact_type": "event", "importance": 3,
            "last_turn": 10, "valid_until_turn": None, "valid_from_turn": 5, "pinned": False}
    base.update(kw)
    return base


def test_empty_inputs_give_empty_block():
    assert build_block([], [], [], 600) == ("", [], [])


def test_sections_and_suffixes():
    text, used, dropped = build_block(
        [fact("p1", "Kael swore an oath.", pinned=True)],
        [fact("a1", "Mira is wounded.", fact_type="state")],
        [fact("s1", "They met at dawn."),
         fact("s2", "Mira trusted the captain.", valid_until_turn=90)],
        600)
    assert "## Ongoing & pinned" in text and "## Recalled from earlier" in text
    assert "Mira is wounded. (ongoing)" in text
    assert "Mira trusted the captain. (this later changed)" in text
    assert used == ["p1", "a1", "s1", "s2"]
    assert dropped == []


def test_reserved_capped_leaves_room_for_scored():
    heavy = [fact(f"a{i}", "An unresolved wound throbs badly in the dark. " * 4,
                  fact_type="state", importance=5 - (i % 3)) for i in range(30)]
    scored = [fact("s1", "They met at dawn."), fact("s2", "The city fell.")]
    text, used, dropped = build_block([], heavy, scored, 300)
    assert dropped
    assert "s1" in used and "s2" in used
    assert estimate_tokens(text) <= 300 + 20


def test_reserved_priority_pinned_then_importance():
    pinned = [fact("p1", "x " * 40, pinned=True)]
    states = [fact("hi", "y " * 40, fact_type="state", importance=5),
              fact("lo", "z " * 40, fact_type="state", importance=1)]
    budget = 60
    text, used, dropped = build_block(pinned, states, [], budget)
    assert used[0] == "p1"
    assert "lo" in dropped


def test_scored_stops_at_budget():
    scored = [fact(f"s{i}", f"Scored memory number {i}. " * 6) for i in range(50)]
    text, used, dropped = build_block([], [], scored, 200)
    assert 0 < len(used) < 50
    assert estimate_tokens(text) <= 200 + 20


def test_no_duplicate_between_reserved_and_scored():
    a = fact("a1", "Mira is wounded.", fact_type="state")
    text, used, dropped = build_block([], [a], [dict(a, distance=0.1)], 600)
    assert used.count("a1") == 1
