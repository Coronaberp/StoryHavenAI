import math

STATEFUL_TYPES = {"state"}
STRENGTH_BASE = 40.0
STRENGTH_PER_REINFORCEMENT = 15.0
STRENGTH_PER_IMPORTANCE = 10.0
STRENGTH_PER_VALENCE = 8.0
RETENTION_FLOOR = 0.05
RECENCY_SCALE_TURNS = 200.0
RELEVANCE_WEIGHT = 1.0
RECENCY_WEIGHT = 0.6
IMPORTANCE_WEIGHT = 0.4
LOCATION_MATCH_WEIGHT = 0.5
ACTIVE_STATE_IMPORTANCE_FLOOR = 3
MAX_ACTIVE_RESERVED_FACTS = 12
PARTICIPANT_ABSENCE_PENALTY = 0.5

def location_matches(fact: dict, current_location: str | None) -> bool:
    fact_location = fact.get("location")
    if not fact_location or not current_location:
        return True
    return fact_location.strip().lower() == current_location.strip().lower()

def is_active(fact: dict, current_location: str | None = None) -> bool:
    return (fact["fact_type"] in STATEFUL_TYPES and fact["valid_until_turn"] is None
            and fact["importance"] >= ACTIVE_STATE_IMPORTANCE_FLOOR
            and location_matches(fact, current_location))

def retention(fact: dict, current_turn: int, current_location: str | None = None) -> float:
    if fact.get("source") == "lore" or fact.get("pinned"):
        return 1.0
    if not fact.get("demoted") and is_active(fact, current_location):
        return 1.0
    strength = (STRENGTH_BASE
                + STRENGTH_PER_REINFORCEMENT * fact["reinforcements"]
                + STRENGTH_PER_IMPORTANCE * fact["importance"]
                + STRENGTH_PER_VALENCE * abs(fact["valence"]))
    age = max(0, current_turn - fact["last_turn"])
    return math.exp(-age / strength)

def participants_present(fact: dict, present_lower: set[str]) -> bool:
    if fact["fact_type"] == "world" or fact.get("source") == "lore":
        return True
    if not fact["participants"]:
        return True
    return any(p.lower() in present_lower for p in fact["participants"])

def passes_filters(fact: dict, present_lower: set[str], current_turn: int,
                    current_location: str | None = None) -> bool:
    return retention(fact, current_turn, current_location) >= RETENTION_FLOOR

def score(fact: dict, current_turn: int, current_location: str | None = None,
          present_lower: set[str] | None = None) -> float:
    relevance = max(0.0, 1.0 - fact["distance"])
    recency = math.exp(-max(0, current_turn - fact["last_turn"]) / RECENCY_SCALE_TURNS)
    location_bonus = (LOCATION_MATCH_WEIGHT
                       if current_location and fact.get("location")
                       and location_matches(fact, current_location)
                       else 0.0)
    weight = (RELEVANCE_WEIGHT * relevance
              + RECENCY_WEIGHT * recency
              + IMPORTANCE_WEIGHT * fact["importance"] / 5.0
              + location_bonus)
    base = weight * retention(fact, current_turn, current_location)
    if present_lower is not None and not participants_present(fact, present_lower):
        return base * PARTICIPANT_ABSENCE_PENALTY
    return base

def rank(candidates: list[dict], present: list[str], current_turn: int,
         current_location: str | None = None) -> list[dict]:
    present_lower = {p.lower() for p in present}
    kept = [c for c in candidates if passes_filters(c, present_lower, current_turn, current_location)]
    return sorted(kept, key=lambda c: score(c, current_turn, current_location, present_lower=present_lower),
                  reverse=True)
