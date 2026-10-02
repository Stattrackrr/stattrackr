"""Rebounding features: OREB/DREB split, REB% / OREB% / DREB%, opponent OREB/DREB allowed.

Rates follow Basketball-Reference:
  REB%  = 100 * REB  * (TmMP/5) / (MP * (TmREB  + OppREB))
  OREB% = 100 * OREB * (TmMP/5) / (MP * (TmOREB + OppDREB))
  DREB% = 100 * DREB * (TmMP/5) / (MP * (TmDREB + OppOREB))
Team totals come from the log-derived team boxes.
"""

from __future__ import annotations

from dataclasses import dataclass
from statistics import mean

from nbl_engine.features.team import TeamBoxes
from nbl_engine.models.raw import GameLogRow


@dataclass(frozen=True)
class ReboundSplit:
    n: int
    reb_mean: float | None
    oreb_mean: float | None
    dreb_mean: float | None

    @property
    def oreb_share(self) -> float | None:
        if not self.reb_mean or self.oreb_mean is None:
            return None
        return self.oreb_mean / self.reb_mean

    @property
    def dreb_share(self) -> float | None:
        s = self.oreb_share
        return None if s is None else 1.0 - s


def rebound_split(rows: list[GameLogRow], limit: int | None = None) -> ReboundSplit:
    sub = rows[:limit] if limit else rows
    trip = [(r.rebounds, r.offensiveRebounds, r.defensiveRebounds) for r in sub]
    trip = [(float(a), float(b), float(c)) for a, b, c in trip if a is not None and b is not None and c is not None]
    if not trip:
        return ReboundSplit(0, None, None, None)
    return ReboundSplit(len(trip), mean(t[0] for t in trip), mean(t[1] for t in trip), mean(t[2] for t in trip))


def _rates(row: GameLogRow, boxes: TeamBoxes) -> tuple[float, float, float] | None:
    box = boxes.boxes.get((row.matchId, row.teamCode.upper()))
    opp = boxes.opponent_box(box) if box else None
    if box is None or opp is None or not row.minutes:
        return None
    need = (row.rebounds, row.offensiveRebounds, row.defensiveRebounds)
    if any(v is None for v in need):
        return None
    t = box.totals
    o = opp.totals
    keys = ("rebounds", "offensiveRebounds", "defensiveRebounds", "minutes")
    if any(t.get(k) is None for k in keys) or any(o.get(k) is None for k in keys[:3]) or not t["minutes"]:
        return None
    share_floor = t["minutes"] / 5.0 / float(row.minutes)
    reb = 100.0 * float(row.rebounds) * share_floor / (t["rebounds"] + o["rebounds"]) if (t["rebounds"] + o["rebounds"]) else None  # type: ignore[arg-type]
    oreb_den = t["offensiveRebounds"] + o["defensiveRebounds"]
    dreb_den = t["defensiveRebounds"] + o["offensiveRebounds"]
    oreb = 100.0 * float(row.offensiveRebounds) * share_floor / oreb_den if oreb_den else None  # type: ignore[arg-type]
    dreb = 100.0 * float(row.defensiveRebounds) * share_floor / dreb_den if dreb_den else None  # type: ignore[arg-type]
    if reb is None or oreb is None or dreb is None:
        return None
    return reb, oreb, dreb


@dataclass(frozen=True)
class ReboundRates:
    n: int
    reb_pct: float | None
    oreb_pct: float | None
    dreb_pct: float | None


def rebound_rates(rows: list[GameLogRow], boxes: TeamBoxes, limit: int | None = None) -> ReboundRates:
    vals = [v for v in (_rates(r, boxes) for r in (rows[:limit] if limit else rows)) if v is not None]
    if not vals:
        return ReboundRates(0, None, None, None)
    return ReboundRates(len(vals), mean(v[0] for v in vals), mean(v[1] for v in vals), mean(v[2] for v in vals))


@dataclass(frozen=True)
class OpponentBoards:
    oreb_allowed: float | None  # opponents' OREB per game vs this team
    oreb_n: int
    oreb_rank: tuple[int, int] | None  # 1 = hardest (allows fewest)
    dreb_allowed: float | None
    dreb_n: int
    dreb_rank: tuple[int, int] | None


def opponent_boards(boxes: TeamBoxes, team_code: str, min_games: int) -> OpponentBoards:
    o_val, o_n = boxes.allowed_per_game(team_code, ("offensiveRebounds",))
    d_val, d_n = boxes.allowed_per_game(team_code, ("defensiveRebounds",))
    o_ranks: dict[str, float | None] = {}
    d_ranks: dict[str, float | None] = {}
    for code in boxes.teams():
        v, n = boxes.allowed_per_game(code, ("offensiveRebounds",))
        o_ranks[code] = v if n >= min_games else None
        v, n = boxes.allowed_per_game(code, ("defensiveRebounds",))
        d_ranks[code] = v if n >= min_games else None
    return OpponentBoards(
        oreb_allowed=o_val,
        oreb_n=o_n,
        oreb_rank=boxes.rank_asc(o_ranks).get(team_code),
        dreb_allowed=d_val,
        dreb_n=d_n,
        dreb_rank=boxes.rank_asc(d_ranks).get(team_code),
    )


def board_matchup(split: ReboundSplit, opp: OpponentBoards, top_rank: int, bottom_rank: int) -> float | None:
    """Signed share of the player's boards that come from favourable (+) / unfavourable (-) sources."""
    if split.oreb_share is None or split.dreb_share is None:
        return None

    def sig(rank: tuple[int, int] | None) -> int:
        if not rank:
            return 0
        return -1 if rank[0] <= top_rank else 1 if rank[0] >= bottom_rank else 0

    return split.oreb_share * sig(opp.oreb_rank) + split.dreb_share * sig(opp.dreb_rank)
