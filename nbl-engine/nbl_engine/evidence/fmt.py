"""Deterministic number formatting shared by claims, narrative and verifier."""

from __future__ import annotations


def num(value: float | int | None, nd: int = 1) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, int) or float(value).is_integer() and nd == 0:
        return str(int(round(float(value))))
    text = f"{float(value):.{nd}f}"
    return text


def pct(rate: float | None) -> str:
    return "n/a" if rate is None else f"{round(rate * 100):d}%"


def line_text(line: float | None) -> str:
    return "n/a" if line is None else f"{line:g}"


def signed(value: float | None, nd: int = 1) -> str:
    if value is None:
        return "n/a"
    return f"{value:+.{nd}f}"


def nbl_season_label(year: int) -> str:
    """Rosetta start year 2025 → NBL26."""
    return f"NBL{str(int(year) + 1)[-2:]}"


def rank_text(rank: int, compared: int) -> str:
    return f"{rank} of {compared}"


def ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def box_rank(rank: int, compared: int, what: str) -> str:
    """Box-score allowed rank. Never the #N language used on the shot chart."""
    return f"{ordinal(rank)} of {compared} for {what} (box score, not a shot-chart zone rank)"
