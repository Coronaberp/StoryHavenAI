import json
import sys
from pathlib import Path

FACTS = {
    "compass": ["Kael showed off his father's brass compass again.",
                "\"This compass was my father's,\" Kael said, turning it over.",
                "Kael checked the old compass his father left him.",
                "The battered compass — his father's — never leaves Kael's belt."],
    "wound": ["Mira's stabbed shoulder was aching again.",
              "Mira winced, favoring the shoulder where the knife went in.",
              "The stab wound in Mira's shoulder had not healed.",
              "Mira pressed a hand to her injured shoulder."],
    "debt": ["Kael still owes the innkeeper Serna forty silver.",
             "\"Forty silver, Kael. I haven't forgotten,\" Serna called out.",
             "Serna reminded Kael about the forty silver he owes her.",
             "The debt to Serna — forty silver — came up again."],
    "mill": ["The abandoned mill outside town creaked in the wind.",
             "Nobody has worked the old mill in years; it stands empty.",
             "They passed the derelict mill on the north road again.",
             "The old mill loomed, long abandoned."],
    "song": ["Kael hummed the Redford lament by the fire.",
             "That old Redford lament again — Kael can't stop humming it.",
             "Kael sang a verse of the lament from Redford.",
             "The Redford tune drifted from Kael's lips."],
    "map": ["Kael marked the eastern pass on his map of the Greyspine.",
            "The Greyspine map gained another notation: the eastern pass.",
            "Kael updated his Greyspine map, tracing the eastern pass.",
            "Poring over the Greyspine map, Kael circled the eastern pass."],
    "scar": ["Kael's jagged scar from the wolf attack showed above his collar.",
             "The old wolf-attack scar on Kael's neck caught the light.",
             "Kael rubbed the scar the wolf gave him years ago.",
             "That wolf-bite scar of Kael's stood pale against his skin."],
    "sister": ["Mira spoke fondly of her sister Tessa in the capital.",
               "Tessa, Mira's sister, sent another letter from the capital.",
               "Mira mentioned her sister Tessa again, worry in her voice.",
               "A letter from Tessa arrived; Mira's sister writes weekly."],
    "fear": ["Kael admitted he cannot swim and dreads deep water.",
             "Deep water again — Kael tensed, unable to swim a stroke.",
             "Kael skirted the river's edge; he has never learned to swim.",
             "The ferry crossing left Kael pale; deep water terrifies him."],
    "ring": ["Mira wears a silver signet ring engraved with a heron.",
             "The heron-engraved silver ring never leaves Mira's finger.",
             "Mira turned her silver heron ring absently as she spoke.",
             "Light glinted off the heron signet on Mira's hand."],
}


def main():
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    turns = []
    for round_index in range(rounds):
        for key, variants in FACTS.items():
            line = variants[round_index % len(variants)]
            turns.append({"user": f"We continue the journey, scene {len(turns)}.",
                          "assistant": line})
    probes = [
        {"query": "What does Kael carry from his father?", "present": [],
         "expect": ["compass"], "reject": []},
        {"query": "What does Kael owe and to whom?", "present": ["Serna"],
         "expect": ["forty silver"], "reject": []},
        {"query": "What is wrong with Mira?", "present": ["Mira"],
         "expect": ["shoulder"], "reject": []},
        {"query": "What lies on the north road?", "present": [],
         "expect": ["mill"], "reject": []},
        {"query": "What song does Kael like?", "present": [],
         "expect": ["Redford"], "reject": []},
        {"query": "What did Kael mark on the map?", "present": [],
         "expect": ["eastern pass"], "reject": []},
        {"query": "Tell me everything you know about Kael.", "present": ["Serna"],
         "expect": ["compass", "forty silver", "Redford", "swim"], "reject": []},
        {"query": "Tell me everything you know about Mira.", "present": ["Mira", "Tessa"],
         "expect": ["shoulder", "Tessa", "heron"], "reject": []},
    ]
    out = Path(__file__).parent / "probe_scripts" / "dedup.json"
    out.write_text(json.dumps({"turns": turns, "probes": probes}, indent=1), encoding="utf-8")
    print(f"wrote {out} ({len(turns)} turns, {len(probes)} probes)")


if __name__ == "__main__":
    main()
