"""Tier assignment.

Hard gates fail closed (NO EDGE or AVOID with the reason recorded). After the
gates, each category contributes at most one confirmed vote; the side with
the higher summed weight is the candidate and the tier depends on score,
breadth (number of categories) and the size of the opposing evidence.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from nbl_engine.config import Thresholds
from nbl_engine.ingest.timeutil import hours_between, parse_iso
from nbl_engine.models.records import ClaimRecord, Direction, GateResult, InferenceRecord, Tier


@dataclass(frozen=True)
class GateInputs:
    games_current: int
    minutes_season_mean: float | None
    line_present: bool
    market_kind: str  # ou | milestone | none
    market_captured_at: str | None
    stats_fresh: bool
    stats_age_hours: float | None
    self_injury_status: str | None
    run_time: datetime


@dataclass(frozen=True)
class ScoreResult:
    tier: Tier
    side: Direction
    score_over: float
    score_under: float
    confirmed_categories: list[str]
    gates: list[GateResult]


def _is_out(status: str | None) -> bool:
    s = (status or "").strip().lower()
    return s.startswith("out") or s in {"season", "suspended", "injured"}


def _is_doubtful(status: str | None) -> bool:
    s = (status or "").strip().lower()
    return any(k in s for k in ("doubt", "day-to-day", "day to day", "questionable", "test", "gtd", "game time"))


def run_gates(g: GateInputs, cfg: Thresholds) -> list[GateResult]:
    gates: list[GateResult] = []
    gates.append(GateResult(gate="stats_fresh", passed=g.stats_fresh, detail=f"stats age {g.stats_age_hours:.1f}h (max {cfg.freshness.max_stats_age_hours}h)" if g.stats_age_hours is not None else "no refresh stamp"))
    gates.append(GateResult(gate="min_games", passed=g.games_current >= cfg.samples.min_games_current, detail=f"{g.games_current} game(s) (min {cfg.samples.min_games_current})"))
    mins_ok = g.minutes_season_mean is not None and g.minutes_season_mean >= cfg.samples.min_minutes_avg
    gates.append(GateResult(gate="min_minutes", passed=mins_ok, detail=f"{g.minutes_season_mean:.1f} min/g (min {cfg.samples.min_minutes_avg})" if g.minutes_season_mean is not None else "no minutes"))
    gates.append(GateResult(gate="line_present", passed=g.line_present, detail=f"market {g.market_kind}"))
    odds_ok = False
    odds_detail = "no capture time"
    cap = parse_iso(g.market_captured_at)
    if cap is not None:
        age = hours_between(g.run_time, cap)
        odds_ok = age <= cfg.freshness.max_odds_age_hours
        odds_detail = f"odds age {age:.1f}h (max {cfg.freshness.max_odds_age_hours}h)"
    gates.append(GateResult(gate="odds_fresh", passed=odds_ok, detail=odds_detail))
    gates.append(GateResult(gate="player_available", passed=not _is_out(g.self_injury_status), detail=f"injury status {g.self_injury_status or 'not listed'}"))
    return gates


def score(inferences: list[InferenceRecord], claims: list[ClaimRecord], gates: list[GateResult], cfg: Thresholds, g: GateInputs) -> ScoreResult:
    over = sum(i.weight for i in inferences if i.status == "confirmed" and i.direction == "over")
    under = sum(i.weight for i in inferences if i.status == "confirmed" and i.direction == "under")
    over, under = round(over, 4), round(under, 4)
    failed = [x for x in gates if not x.passed]

    def done(tier: Tier, side: Direction, cats: list[str]) -> ScoreResult:
        return ScoreResult(tier=tier, side=side, score_over=over, score_under=under, confirmed_categories=cats, gates=gates)

    # Fail closed on gates. Availability failure is an AVOID; everything else is NO EDGE.
    if any(x.gate == "player_available" for x in failed):
        return done("AVOID", "neutral", [])
    if failed:
        return done("NO EDGE", "neutral", [])

    if over == 0 and under == 0:
        return done("NO EDGE", "neutral", [])
    side: Direction = "over" if over > under else "under" if under > over else "neutral"
    if side == "neutral":
        return done("AVOID", "neutral", [])  # equal weight both ways = conflicting evidence
    support, oppose = (over, under) if side == "over" else (under, over)
    cats = sorted(i.category for i in inferences if i.status == "confirmed" and i.direction == side)

    # Red flags that force AVOID regardless of score
    minutes_against = any(i.category == "minutes" and i.status == "confirmed" and i.direction != side for i in inferences)
    if minutes_against and side == "over":
        return done("AVOID", side, cats)
    if _is_doubtful(g.self_injury_status):
        return done("AVOID", side, cats)
    if oppose > 0 and oppose >= support * cfg.scoring.conflict_ratio:
        return done("AVOID", side, cats)
    # A milestone-only market has no priced under: an under read cannot be acted on.
    if side == "under" and g.market_kind == "milestone":
        return done("NO EDGE", side, cats)

    net = support - oppose
    if net >= cfg.scoring.strong_score and len(cats) >= cfg.scoring.strong_min_categories:
        return done("STRONG", side, cats)
    if net >= cfg.scoring.lean_score and len(cats) >= cfg.scoring.lean_min_categories:
        return done("LEAN", side, cats)
    return done("NO EDGE", side, cats)
