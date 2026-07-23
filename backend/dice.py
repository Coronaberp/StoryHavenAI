"""Dice mechanics — parsing/rolling dice expressions and formatting/resolving
them for the chat surface (the 🎲 lines and /roll slash command)."""
import re
import random

DICE_TERM = re.compile(r'([+-]?)\s*(\d*)\s*[dD]\s*(\d+)|([+-]?\s*\d+)')


def roll_dice(expr, max_dice=100, max_sides=1000):
    raw = (expr or "1d20").strip()
    total, bits, found = 0, [], False
    for m in DICE_TERM.finditer(raw):
        neg = m.group(1) == "-"
        if m.group(3):
            found = True
            n = int(m.group(2)) if m.group(2) else 1
            sides = int(m.group(3))
            n = max(1, min(n, max_dice))
            sides = max(2, min(sides, max_sides))
            rolls = [random.randint(1, sides) for _ in range(n)]
            total += -sum(rolls) if neg else sum(rolls)
            op = "-" if neg else ("+" if bits else "")
            bits.append(f"{op} {n}d{sides} [{', '.join(map(str, rolls))}]".strip())
        elif m.group(4) is not None and m.group(4).strip():
            c = int(m.group(4).replace(" ", ""))
            total += c
            op = "-" if c < 0 else ("+" if bits else "")
            bits.append(f"{op} {abs(c)}".strip())
    if not found:
        raise ValueError("no dice found — try e.g. 2d6+3 or d20")
    return {"expr": raw, "total": total, "detail": " ".join(bits)}


def format_roll(r, label=""):
    lbl = (label.strip() + ": ") if label.strip() else ""
    return f"🎲 {lbl}{r['detail']} = **{r['total']}**"


ROLL_INLINE = re.compile(
    r'/r(?:oll)?\s+(\d*d\d+(?:\s*[+-]\s*\d*d?\d+)*)'
    r'|\{roll:\s*(\d*d\d+(?:\s*[+-]\s*\d*d?\d+)*)\s*([^}]*?)\s*\}', re.I)


def resolve_inline_rolls(text):
    def repl(m):
        if m.group(1):
            expr, label = m.group(1), ""
        else:
            expr, label = m.group(2), (m.group(3) or "").strip()
        try:
            return format_roll(roll_dice(expr), label)
        except ValueError:
            return m.group(0)
    return ROLL_INLINE.sub(repl, text or "")
