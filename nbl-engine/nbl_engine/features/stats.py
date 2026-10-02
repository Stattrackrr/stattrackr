"""Supported prop stats and how each maps onto stored fields."""

from __future__ import annotations

from dataclasses import dataclass

from nbl_engine.models.raw import GameLogRow


@dataclass(frozen=True)
class StatDef:
    key: str  # engine + snapshot key (identical in stored data)
    label: str  # human label
    aliases: tuple[str, ...]  # CLI inputs
    log_field: str  # GameLogRow attribute
    attempts_field: str | None  # e.g. threeAttempted for threeMade
    team_allowed_fields: tuple[str, ...]  # log fields summed for "allowed" (sum for composites)


STATS: dict[str, StatDef] = {
    "threeMade": StatDef("threeMade", "3PM", ("3PM", "THREES", "3PT", "THREEMADE"), "threeMade", "threeAttempted", ("threeMade",)),
    "points": StatDef("points", "PTS", ("PTS", "POINTS"), "points", "fgAttempted", ("points",)),
    "rebounds": StatDef("rebounds", "REB", ("REB", "REBOUNDS"), "rebounds", None, ("rebounds",)),
    "assists": StatDef("assists", "AST", ("AST", "ASSISTS"), "assists", None, ("assists",)),
    "pra": StatDef("pra", "PRA", ("PRA",), "pra", None, ("points", "rebounds", "assists")),
    "pr": StatDef("pr", "PR", ("PR", "P+R"), "pr", None, ("points", "rebounds")),
    "pa": StatDef("pa", "PA", ("PA", "P+A"), "pa", None, ("points", "assists")),
    "ra": StatDef("ra", "RA", ("RA", "R+A"), "ra", None, ("rebounds", "assists")),
}

STAT_ORDER: tuple[str, ...] = tuple(STATS)


def resolve_stat(value: str) -> StatDef | None:
    key = value.strip()
    if key in STATS:
        return STATS[key]
    upper = key.upper()
    for sd in STATS.values():
        if upper == sd.key.upper() or upper in sd.aliases:
            return sd
    return None


def stat_value(row: GameLogRow, sd: StatDef) -> float | None:
    """Value of a stat for a log row; composite stats fall back to their parts."""
    v = getattr(row, sd.log_field, None)
    if v is not None:
        return float(v)
    if len(sd.team_allowed_fields) > 1:
        parts = [getattr(row, f, None) for f in sd.team_allowed_fields]
        if all(p is not None for p in parts):
            return float(sum(float(p) for p in parts))  # type: ignore[arg-type]
    return None


def attempts_value(row: GameLogRow, sd: StatDef) -> float | None:
    if not sd.attempts_field:
        return None
    v = getattr(row, sd.attempts_field, None)
    return float(v) if v is not None else None
