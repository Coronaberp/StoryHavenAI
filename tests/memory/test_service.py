import pytest

from backend import memory_service as ms


def msg(role, content, mid="m"):
    return {"id": mid, "role": role, "content": content}


def test_exchanges_pairs_user_assistant():
    msgs = [msg("user", "a"), msg("assistant", "b"), msg("user", "c"),
            msg("assistant", "d"), msg("user", "e")]
    got = ms.exchanges(msgs)
    assert len(got) == 2
    assert got[0][0]["content"] == "a" and got[1][1]["content"] == "d"


def test_exchanges_group_captures_every_responder():
    msgs = [msg("user", "hi", "u1"),
            {"id": "a1", "role": "assistant", "content": "Luna hi", "char_id": "luna"},
            {"id": "a2", "role": "assistant", "content": "Ryo hi", "char_id": "ryo"},
            msg("user", "bye", "u2"),
            {"id": "a3", "role": "assistant", "content": "Luna bye", "char_id": "luna"}]
    got = ms.exchanges(msgs, group=True)
    assert [a["content"] for _, a in got] == ["Luna hi", "Ryo hi", "Luna bye"]
    assert [u["content"] for u, _ in got] == ["hi", "hi", "bye"]


def test_exchanges_single_char_unchanged_by_group_flag():
    msgs = [msg("user", "a", "u1"), msg("assistant", "b", "a1"),
            msg("user", "c", "u2"), msg("assistant", "d", "a2")]
    assert ms.exchanges(msgs) == ms.exchanges(msgs, group=True)


def test_transcript_group_labels_speakers_and_dedupes_user_line():
    user_msg = msg("user", "hi", "u1")
    luna = {"id": "a1", "role": "assistant", "content": "Hello.", "char_id": "luna"}
    ryo = {"id": "a2", "role": "assistant", "content": "Hey.", "char_id": "ryo"}
    out = ms._transcript([(user_msg, luna), (user_msg, ryo)], "Primary", "Alice",
                         {"luna": "Luna", "ryo": "Ryōshū"})
    assert out == "Alice: hi\nLuna: Hello.\nRyōshū: Hey."


def test_current_turn_counts_user_messages():
    msgs = [msg("user", "a"), msg("assistant", "b"), msg("user", "c")]
    assert ms.current_turn(msgs) == 2


def test_present_participants_includes_pair_and_cued_names():
    got = ms.present_participants("Kael", "Alice", ["Mira", "Bram"], "then Mira walked in")
    assert got == ["Alice", "Kael", "Mira"]


def test_transcript_appends_mood_tag_when_present():
    user_msg = msg("user", "I didn't have a choice.")
    assistant_msg = {**msg("assistant", "There's always a choice."), "mood": "seething"}
    out = ms._transcript([(user_msg, assistant_msg)], "Kestrel", "Alice")
    assert "Kestrel: There's always a choice. [mood: seething]" in out


def test_transcript_omits_mood_tag_when_absent():
    user_msg = msg("user", "Hello.")
    assistant_msg = {**msg("assistant", "Hello there."), "mood": None}
    out = ms._transcript([(user_msg, assistant_msg)], "Kestrel", "Alice")
    assert "[mood:" not in out


class FakeRepo:
    def __init__(self):
        self.cursor = 0
        self.inserted, self.reinforced_calls, self.superseded_calls = [], [], []

    async def get_cursor(self, sid):
        return self.cursor

    async def set_cursor(self, sid, n):
        self.cursor = n

    async def insert(self, fact, vec):
        self.inserted.append(fact)
        return f"mf_{len(self.inserted)}"

    async def reinforce(self, fid, turn):
        self.reinforced_calls.append((fid, turn))

    async def supersede(self, old, fact, vec, turn):
        self.superseded_calls.append((old, turn))
        return "mf_new"

    async def similar_live(self, sid, vec, k):
        return [{"id": "mf_a", "text": "Mira got hurt."}]

    async def reserved(self, sid):
        return []


@pytest.fixture()
def wired(monkeypatch):
    repo = FakeRepo()
    monkeypatch.setattr(ms, "memory_facts", repo)

    async def fake_embed(text, model, base_url=None, api_key=None):
        return [0.0] * 8

    monkeypatch.setattr(ms.llm, "embed", fake_embed)

    async def fake_overrides(sid):
        return {}

    monkeypatch.setattr(ms.lore_memory.session_lore_state,
                        "get_all_overrides_for_session", fake_overrides)

    async def fake_search_lore_ids(char_id, vec, k, max_dist):
        return []

    monkeypatch.setattr(ms.lore_memory.vectors, "search_lore_ids", fake_search_lore_ids)

    async def fake_set_char_state(sid, doing=None, location=None, known_names=None):
        repo.char_state = {"doing": doing, "location": location, "known_names": known_names}

    monkeypatch.setattr(ms.chat_sessions, "set_char_state", fake_set_char_state)
    return repo


@pytest.mark.asyncio
async def test_maybe_extract_below_threshold_does_nothing(wired, monkeypatch):
    called = []

    async def fake_list(sid):
        return [msg("user", "a"), msg("assistant", "b")] * 3

    monkeypatch.setattr(ms.chat_sessions, "list_messages", fake_list)

    from backend.memory_extraction import CharStateDraft

    async def fake_extract(*a, **kw):
        called.append(1)
        return [], CharStateDraft()

    monkeypatch.setattr(ms, "run_extract", fake_extract)
    await ms.maybe_extract({"id": "s1"}, {"id": "c1", "name": "Kael"}, "Alice", "English", "m")
    assert called == []


@pytest.mark.asyncio
async def test_maybe_extract_runs_batches_and_advances_cursor(wired, monkeypatch):
    from backend.memory_extraction import FactDraft, ReconcileDecision, CharStateDraft

    async def fake_list12(sid):
        out = []
        for i in range(12):
            out += [msg("user", f"u{i}"), msg("assistant", f"a{i}")]
        return out

    monkeypatch.setattr(ms.chat_sessions, "list_messages", fake_list12)

    async def fake_extract(transcript, cn, un, lang, model, base_url=None, api_key=None, cast_names=None):
        return [FactDraft(text="Mira was stabbed.", fact_type="state",
                          participants=["Mira"], importance=5, valence=-2),
                FactDraft(text="The mine collapsed.", fact_type="world",
                          participants=[], importance=3, valence=-1)], CharStateDraft()

    async def fake_reconcile(drafts, neighbors, model, base_url=None, api_key=None):
        return [ReconcileDecision(index=0, action="reinforce", target_id="mf_a"),
                ReconcileDecision(index=1, action="add")]

    monkeypatch.setattr(ms, "run_extract", fake_extract)
    monkeypatch.setattr(ms, "run_reconcile", fake_reconcile)
    await ms.maybe_extract({"id": "s1"}, {"id": "c1", "name": "Kael"}, "Alice", "English", "m")
    assert wired.cursor == 10
    assert len(wired.inserted) == 2
    assert len(wired.reinforced_calls) == 2
    assert wired.inserted[0]["fact_type"] == "world"


@pytest.mark.asyncio
async def test_extract_batch_defaults_unattributed_participants(wired, monkeypatch):
    from backend.memory_extraction import FactDraft, ReconcileDecision, CharStateDraft

    async def fake_extract(*a, **kw):
        return [FactDraft(text="A vow was made.", fact_type="event",
                          participants=[], importance=4, valence=1)], CharStateDraft()

    async def fake_reconcile(drafts, neighbors, model, base_url=None, api_key=None):
        return [ReconcileDecision(index=0, action="add")]

    monkeypatch.setattr(ms, "run_extract", fake_extract)
    monkeypatch.setattr(ms, "run_reconcile", fake_reconcile)
    batch = [(msg("user", "u"), msg("assistant", "a"))] * 5
    stats = await ms.extract_batch("s1", "c1", "Kael", "Alice", batch, 5, "English", "m",
                                   {"id": "s1", "known_names": "[]"})
    assert stats["added"] == 1
    assert wired.inserted[0]["participants"] == ["Alice", "Kael"]


@pytest.mark.asyncio
async def test_extract_batch_merges_char_state_with_previous(wired, monkeypatch):
    from backend.memory_extraction import CharStateDraft

    async def fake_extract(*a, **kw):
        return [], CharStateDraft(doing="", location="", npcs=["Rolf"])

    monkeypatch.setattr(ms, "run_extract", fake_extract)
    batch = [(msg("user", "u"), msg("assistant", "a"))] * 5
    prev_session = {"id": "s1", "known_names": '["Mira"]',
                    "char_doing": "standing watch", "char_location": "the gate"}
    await ms.extract_batch("s1", "c1", "Kael", "Alice", batch, 5, "English", "m",
                           prev_session)
    assert wired.char_state["known_names"] == ["Mira", "Rolf"]
    assert wired.char_state["doing"] == "standing watch"
    assert wired.char_state["location"] == "the gate"


@pytest.mark.asyncio
async def test_retrieve_block_filters_reserved_by_participants(wired, monkeypatch):
    def full_fact(fid, text, participants):
        return {"id": fid, "text": text, "fact_type": "state", "participants": participants,
                "importance": 4, "valence": -1, "reinforcements": 0, "valid_from_turn": 1,
                "valid_until_turn": None, "last_turn": 1, "pinned": False}

    async def fake_reserved(sid):
        return [full_fact("secret", "Mira hid her brother.", ["Mira"]),
                full_fact("shared", "Kael is wounded.", ["Kael", "Alice"])]

    async def fake_similar(sid, vec, k):
        return []

    wired.reserved = fake_reserved
    wired.similar_live = fake_similar
    msgs = [msg("user", "probe")]
    text, used, meta_lore_lines, meta_memory_lines = await ms.retrieve_block(
        {"id": "s1", "known_names": "[]"},
        {"id": "c1", "name": "Kael"}, "Alice",
        "where is everyone", msgs,
        {"memory_v2_budget_tokens": 600, "top_k_lore": 6, "lore_max_dist": 0.8}, [])
    assert "shared" in used and "secret" not in used
    assert "brother" not in text


@pytest.mark.asyncio
async def test_retrieve_block_returns_empty_without_query(wired):
    text, used, meta_lore_lines, meta_memory_lines = await ms.retrieve_block(
        {"id": "s1", "known_names": "[]"},
        {"id": "c1", "name": "Kael"}, "Alice",
        "", [], {"memory_v2_budget_tokens": 600}, [])
    assert text == "" and used == []
    assert meta_lore_lines == [] and meta_memory_lines == []
