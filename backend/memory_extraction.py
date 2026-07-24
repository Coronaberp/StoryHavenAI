import json
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, model_validator

from backend import llm
from backend.llm import strip_json_fence
from backend.state import log

FACT_TYPES = ("event", "state", "relationship", "world", "profile")
MAX_FACTS_PER_BATCH = 10

class FactDraft(BaseModel):
    text: str = Field(min_length=1)
    fact_type: Literal["event", "state", "relationship", "world", "profile"]
    participants: list[str]
    importance: int = Field(ge=1, le=5)
    valence: int = Field(ge=-2, le=2)

class CharStateDraft(BaseModel):
    doing: str = ""
    location: str = ""
    npcs: list[str] = []

class ReconcileDecision(BaseModel):
    index: int = Field(ge=0)
    action: Literal["add", "reinforce", "supersede"]
    target_id: str | None = None

    @model_validator(mode="after")
    def _target_required(self):
        if self.action != "add" and not self.target_id:
            raise ValueError(f"action {self.action} requires target_id")
        return self

class LoreUpdateDecision(BaseModel):
    index: int = Field(ge=0)
    lore_id: str
    new_content: str = Field(min_length=1)

class SecretRevealDecision(BaseModel):
    index: int = Field(ge=0)
    secret_id: str

EXTRACT_EXAMPLE = (
    '{"facts": [{"text": "Bandits ambushed the caravan on the Kelder road.", '
    '"fact_type": "event", "participants": [], "importance": 4, "valence": -1},\n'
    '{"text": "Mira was stabbed in the left shoulder during the ambush.", '
    '"fact_type": "state", "participants": ["Mira"], "importance": 5, "valence": -2},\n'
    '{"text": "Tomas swore to protect Mira after she saved his life.", '
    '"fact_type": "relationship", "participants": ["Tomas", "Mira"], "importance": 4, "valence": 2},\n'
    '{"text": "Kael is a proud swordsman who refuses to use magic.", '
    '"fact_type": "profile", "participants": ["Kael"], "importance": 3, "valence": 0},\n'
    '{"text": "The mine outside Kelder collapsed.", "fact_type": "world", '
    '"participants": [], "importance": 3, "valence": -1}],\n'
    '"char_state": {"doing": "tending to Mira\'s wound", "location": "the collapsed mine entrance", '
    '"npcs": ["Mira", "Tomas", "Kael"]}}'
)

def build_extract_prompt(transcript: str, char_name: str, user_name: str, language: str,
                         cast_names: list[str] | None = None) -> str:
    if cast_names:
        cast = ", ".join(cast_names)
        who = f"{user_name} and these characters: {cast}"
        state_owner = "the group"
        npc_exclusion = f"excluding {user_name} and every listed character ({cast})"
    else:
        who = f"{user_name} and {char_name}"
        state_owner = char_name
        npc_exclusion = f"excluding {char_name} and {user_name}"
    return (
        f"Analyze this roleplay story between {who}.\n"
        "List facts worth remembering many scenes from now, and the current scene state.\n"
        "Fact types: event (something happened), state (an ongoing unresolved condition: injury, "
        "promise, debt, live conflict, or a mood that persists beyond this exchange), relationship "
        "(how two people relate), world (a fact about the world involving no specific person), "
        "profile (a lasting trait of a person). A trailing [mood: X] tag on a character's line is "
        "their current emotional state — only turn it into a state fact if it reflects something "
        "lasting (e.g. a grudge, a fear taking hold), not a passing reaction to one line.\n"
        "Never record a fact about the conversation itself — that a question or topic has come up "
        "again, that the exchange feels repetitive, or any other observation about the pattern of "
        "the dialogue rather than the story world. Only record what is true in the story.\n"
        f"Each fact: one short third-person sentence in {language}; copy proper names exactly as "
        "written; participants = the people the fact is about; importance 1 (a trivial aside) to 5 "
        "(pivotal, changes the story) — a first meeting or a minor injury is about 3, a deliberate "
        "choice or commitment that will shape the story going forward is about 4, a betrayal, "
        "death, oath, or life-changing revelation is 5; valence -2 (very negative) to 2 (very "
        "positive). Prefer a few high-signal facts over many trivial ones. facts is [] if nothing "
        "lasting happened.\n"
        f"char_state: doing = a short phrase (in {language}) describing what {state_owner} is doing "
        f"or experiencing right now, or empty string; location = a short phrase (in {language}) "
        "describing where the current scene is taking place, or empty string; npcs = proper names "
        f"of named characters mentioned in this exchange, {npc_exclusion} — "
        "empty array if none. Never translate, transliterate, or alter proper names in any field.\n\n"
        f"Example output:\n{EXTRACT_EXAMPLE}\n\n"
        f"Transcript:\n{transcript}\n\n"
        "Reply with only a JSON object in exactly the example's format."
    )

def build_reconcile_prompt(drafts: list[FactDraft], neighbors: list[list[dict]]) -> str:
    new_lines, neighbor_lines = [], []
    for i, draft in enumerate(drafts):
        new_lines.append(f"{i}. {draft.text}")
        near = neighbors[i] if i < len(neighbors) else []
        if near:
            shown = "; ".join(f"[id={n['id']}] {n['text']}" for n in near)
        else:
            shown = "(none)"
        neighbor_lines.append(f"{i}. {shown}")
    return (
        "You maintain a story's memory database. For each NEW fact, compare it with its SIMILAR "
        "existing facts and decide exactly one action:\n"
        '- "add": genuinely new information, unrelated to any similar fact shown\n'
        '- "reinforce": restates an existing fact with no new detail (give that fact\'s id as '
        "target_id)\n"
        '- "supersede": the same recurring pattern, condition, or behavior as an existing fact, '
        "just with different specific details this time (a different list of things someone is "
        "preoccupied with, a different specific worry, an updated version of an ongoing habit or "
        "state) — OR a fact that contradicts and replaces an existing one that is no longer "
        "current (give the existing fact's id as target_id, and the new fact's own text becomes "
        "the merged/updated version)\n\n"
        "Prefer \"supersede\" over \"add\" whenever a NEW fact is thematically the same recurring "
        "pattern about the same participant(s) as one of its SIMILAR existing facts, even if the "
        "specific details differ — this keeps one evolving fact instead of many near-duplicate "
        "entries piling up over a long story. Example: existing fact \"Alice is repeatedly "
        "preoccupied with a rutted trail and a tavern crowd\" and a NEW fact \"Alice is preoccupied "
        "with a stone bridge and a swollen river\" describe the SAME recurring behavior — this "
        "should be \"supersede\", not \"add\".\n\n"
        "But do NOT supersede when the two facts are about different people, or are two distinct "
        "unresolved commitments that both still stand, even about the same person — two separate "
        "promises, debts, injuries, or duel challenges are each their own \"add\", never merge one "
        "away, even if they share a surface pattern. Example: existing fact \"Tarion challenged Diane "
        "to a duel\" and a NEW fact \"Tarion challenged Fenn to a duel\" are two separate open "
        "challenges — this is \"add\", not \"supersede\".\n\n"
        "NEW facts:\n" + "\n".join(new_lines) + "\n\n"
        "SIMILAR existing facts:\n" + "\n".join(neighbor_lines) + "\n\n"
        'Example output:\n[{"index": 0, "action": "supersede", "target_id": "mf_abc"}]\n\n'
        "Reply with only a JSON array containing exactly one decision per NEW fact, "
        "in exactly the example's format."
    )

def build_lore_update_prompt(drafts: list[FactDraft], lore_neighbors: list[list[dict]]) -> str:
    new_lines, neighbor_lines = [], []
    for i, draft in enumerate(drafts):
        new_lines.append(f"{i}. {draft.text}")
        near = lore_neighbors[i] if i < len(lore_neighbors) else []
        if near:
            shown = "; ".join(f"[lore_id={n['id']}] {n['text']}" for n in near)
        else:
            shown = "(none)"
        neighbor_lines.append(f"{i}. {shown}")
    return (
        "You maintain a story's world lorebook. For each NEW fact, check its NEARBY existing lore "
        "entries — does this fact make any of them factually outdated (a change of ruler, an "
        "overthrown government, a destroyed location, a died character)? Most facts update nothing "
        "— only flag a genuine, clear contradiction or supersession, not a minor detail or something "
        "that could simply be added alongside the existing lore without contradicting it.\n\n"
        "NEW facts:\n" + "\n".join(new_lines) + "\n\n"
        "NEARBY lore entries:\n" + "\n".join(neighbor_lines) + "\n\n"
        'Example output (only include facts that genuinely update lore):\n'
        '[{"index": 0, "lore_id": "l_abc", "new_content": "The government was overthrown by '
        'the player; the old ruling council no longer holds power."}]\n\n'
        "Reply with only a JSON array — one entry per fact that updates lore, [] if none do."
    )

def build_secret_reveal_prompt(drafts: list[FactDraft], secret_neighbors: list[list[dict]]) -> str:
    new_lines, neighbor_lines = [], []
    for i, draft in enumerate(drafts):
        new_lines.append(f"{i}. {draft.text}")
        near = secret_neighbors[i] if i < len(secret_neighbors) else []
        if near:
            shown = "; ".join(f"[secret_id={n['id']}] {n['text']}" for n in near)
        else:
            shown = "(none)"
        neighbor_lines.append(f"{i}. {shown}")
    return (
        "You maintain a story's hidden lore secrets — facts the players don't know yet until the "
        "story itself reveals them. For each NEW fact, check its NEARBY hidden secrets — does this "
        "fact show that a secret has genuinely come to light in the story (a character learns it, "
        "witnesses it, or it's stated outright)? Most facts reveal nothing — only flag a secret when "
        "the story has clearly and specifically surfaced that exact information, not just something "
        "adjacent or suggestive of it.\n\n"
        "NEW facts:\n" + "\n".join(new_lines) + "\n\n"
        "NEARBY hidden secrets:\n" + "\n".join(neighbor_lines) + "\n\n"
        'Example output (only include facts that genuinely reveal a secret):\n'
        '[{"index": 0, "secret_id": "lsec_abc"}]\n\n'
        "Reply with only a JSON array — one entry per fact that reveals a secret, [] if none do."
    )

def _load_array(raw: str) -> list:
    try:
        data = json.loads(strip_json_fence(raw))
    except Exception as e:
        raise ValueError(f"not valid JSON: {e}") from e
    if not isinstance(data, list):
        raise ValueError("expected a JSON array")
    return data

def parse_extract_response(raw: str) -> tuple[list[FactDraft], CharStateDraft]:
    data = json.loads(strip_json_fence(raw))
    if not isinstance(data, dict):
        raise ValueError("expected a JSON object with facts and char_state")
    try:
        facts = [FactDraft.model_validate(item) for item in (data.get("facts") or [])]
        char_state = CharStateDraft.model_validate(data.get("char_state") or {})
    except ValidationError as e:
        raise ValueError(str(e)) from e
    return facts[:MAX_FACTS_PER_BATCH], char_state

def parse_reconcile(raw: str, fact_count: int, valid_ids: set[str]) -> list[ReconcileDecision]:
    data = _load_array(raw)
    try:
        decisions = [ReconcileDecision.model_validate(item) for item in data]
    except ValidationError as e:
        raise ValueError(str(e)) from e
    seen = {d.index for d in decisions}
    if seen != set(range(fact_count)):
        raise ValueError(f"expected one decision per fact 0..{fact_count - 1}, got indexes {sorted(seen)}")
    if len(decisions) != fact_count:
        raise ValueError(f"expected exactly {fact_count} decisions, got {len(decisions)} with duplicate indexes")
    for d in decisions:
        if d.action != "add" and d.target_id not in valid_ids:
            raise ValueError(f"unknown target_id {d.target_id}")
    return sorted(decisions, key=lambda d: d.index)

def parse_lore_updates(raw: str, fact_count: int, valid_lore_ids: set[str]) -> list[LoreUpdateDecision]:
    data = _load_array(raw)
    try:
        decisions = [LoreUpdateDecision.model_validate(item) for item in data]
    except ValidationError as e:
        raise ValueError(str(e)) from e
    for d in decisions:
        if d.index >= fact_count:
            raise ValueError(f"index {d.index} out of range for {fact_count} facts")
        if d.lore_id not in valid_lore_ids:
            raise ValueError(f"unknown lore_id {d.lore_id}")
    return decisions

def parse_secret_reveals(raw: str, fact_count: int, valid_secret_ids: set[str]) -> list[SecretRevealDecision]:
    data = _load_array(raw)
    try:
        decisions = [SecretRevealDecision.model_validate(item) for item in data]
    except ValidationError as e:
        raise ValueError(str(e)) from e
    for d in decisions:
        if d.index >= fact_count:
            raise ValueError(f"index {d.index} out of range for {fact_count} facts")
        if d.secret_id not in valid_secret_ids:
            raise ValueError(f"unknown secret_id {d.secret_id}")
    return decisions

async def _call(prompt: str, model: str, base_url: str | None, api_key: str | None) -> str:
    out = []
    async for channel, chunk in llm.chat_stream(
            [{"role": "user", "content": prompt}], model, parse_think=True,
            base_url=base_url, api_key=api_key, pin_host=True):
        if channel == "content":
            out.append(chunk)
    return "".join(out)

async def _call_validated(prompt: str, parse, model: str, base_url: str | None,
                          api_key: str | None, label: str):
    raw = await _call(prompt, model, base_url, api_key)
    try:
        return parse(raw)
    except ValueError as first_error:
        log.warning("memory %s parse failed, retrying once: %s", label, first_error)
        retry_prompt = (f"{prompt}\n\nYour previous reply was invalid: {first_error}\n"
                        "Reply again with only the corrected JSON array.")
        raw = await _call(retry_prompt, model, base_url, api_key)
        return parse(raw)

async def run_extract(transcript: str, char_name: str, user_name: str, language: str,
                      model: str, base_url: str | None = None,
                      api_key: str | None = None,
                      cast_names: list[str] | None = None) -> tuple[list[FactDraft], CharStateDraft]:
    prompt = build_extract_prompt(transcript, char_name, user_name, language, cast_names)
    try:
        return await _call_validated(prompt, parse_extract_response, model, base_url, api_key, "extract")
    except Exception as e:
        log.warning("memory extract batch dropped after retry: %s", e)
        return [], CharStateDraft()

async def run_reconcile(drafts: list[FactDraft], neighbors: list[list[dict]], model: str,
                        base_url: str | None = None,
                        api_key: str | None = None) -> list[ReconcileDecision]:
    if not drafts:
        return []
    valid_ids = {n["id"] for near in neighbors for n in near}
    prompt = build_reconcile_prompt(drafts, neighbors)
    parse = lambda raw: parse_reconcile(raw, len(drafts), valid_ids)
    try:
        return await _call_validated(prompt, parse, model, base_url, api_key, "reconcile")
    except Exception as e:
        log.warning("memory reconcile failed after retry, falling back to add-all: %s", e)
        return [ReconcileDecision(index=i, action="add") for i in range(len(drafts))]

async def run_lore_update_detection(drafts: list[FactDraft], lore_neighbors: list[list[dict]],
                                    model: str, base_url: str | None = None,
                                    api_key: str | None = None) -> list[LoreUpdateDecision]:
    if not drafts or not any(lore_neighbors):
        return []
    valid_lore_ids = {n["id"] for near in lore_neighbors for n in near}
    prompt = build_lore_update_prompt(drafts, lore_neighbors)
    parse = lambda raw: parse_lore_updates(raw, len(drafts), valid_lore_ids)
    try:
        return await _call_validated(prompt, parse, model, base_url, api_key, "lore_update")
    except Exception as e:
        log.warning("lore update detection failed after retry, applying no updates: %s", e)
        return []

async def run_secret_reveal_detection(drafts: list[FactDraft], secret_neighbors: list[list[dict]],
                                      model: str, base_url: str | None = None,
                                      api_key: str | None = None) -> list[SecretRevealDecision]:
    if not drafts or not any(secret_neighbors):
        return []
    valid_secret_ids = {n["id"] for near in secret_neighbors for n in near}
    prompt = build_secret_reveal_prompt(drafts, secret_neighbors)
    parse = lambda raw: parse_secret_reveals(raw, len(drafts), valid_secret_ids)
    try:
        return await _call_validated(prompt, parse, model, base_url, api_key, "secret_reveal")
    except Exception as e:
        log.warning("secret reveal detection failed after retry, revealing nothing: %s", e)
        return []
