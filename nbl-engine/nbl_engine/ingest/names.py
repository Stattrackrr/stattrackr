"""Name normalisation shared by player and team resolution."""

from __future__ import annotations

import re
import unicodedata

_SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}


def norm_key(value: str) -> str:
    """Lowercase, strip diacritics and punctuation, collapse whitespace."""
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().replace("’", "'")
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def norm_player_key(value: str) -> str:
    """norm_key plus generational suffix removal (``Rob Baker II`` -> ``rob baker``)."""
    tokens = [t for t in norm_key(value).split(" ") if t]
    while len(tokens) > 1 and tokens[-1] in _SUFFIXES:
        tokens.pop()
    return " ".join(tokens)


def compact_key(value: str) -> str:
    """No spaces at all; used for team matching across sources."""
    return norm_key(value).replace(" ", "")


def last_token(value: str) -> str:
    tokens = norm_key(value).split(" ")
    return tokens[-1] if tokens else ""
