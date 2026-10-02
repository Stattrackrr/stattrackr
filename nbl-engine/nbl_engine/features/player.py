"""Player-level features from game logs: windows, hit rates, splits, H2H, minutes, rest."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from statistics import mean, median, pstdev

from nbl_engine.features.stats import StatDef, attempts_value, stat_value
from nbl_engine.ingest.timeutil import parse_iso
from nbl_engine.models.raw import GameLogRow


def played_rows(rows: list[GameLogRow]) -> list[GameLogRow]:
    """Rows where the player actually took the floor, newest first."""
    out = [r for r in rows if r.minutes is not None and r.minutes > 0]
    return sorted(out, key=lambda r: (parse_iso(r.date) or datetime.min.replace(tzinfo=None), r.matchId), reverse=True)


@dataclass(frozen=True)
class WindowStats:
    window: str
    n: int
    mean: float | None
    median: float | None
    stdev: float | None
    minimum: float | None
    maximum: float | None
    values: tuple[float, ...]


def window_stats(rows: list[GameLogRow], sd: StatDef, window: str, limit: int | None) -> WindowStats:
    vals = [v for v in (stat_value(r, sd) for r in (rows[:limit] if limit else rows)) if v is not None]
    if not vals:
        return WindowStats(window, 0, None, None, None, None, None, ())
    return WindowStats(
        window=window,
        n=len(vals),
        mean=mean(vals),
        median=median(vals),
        stdev=pstdev(vals) if len(vals) > 1 else 0.0,
        minimum=min(vals),
        maximum=max(vals),
        values=tuple(vals),
    )


@dataclass(frozen=True)
class HitRate:
    window: str
    n: int
    overs: int
    unders: int
    pushes: int
    line: float

    @property
    def rate(self) -> float | None:
        decided = self.overs + self.unders
        return self.overs / decided if decided else None


def hit_rate(rows: list[GameLogRow], sd: StatDef, line: float, window: str, limit: int | None) -> HitRate:
    vals = [v for v in (stat_value(r, sd) for r in (rows[:limit] if limit else rows)) if v is not None]
    overs = sum(1 for v in vals if v > line)
    unders = sum(1 for v in vals if v < line)
    pushes = len(vals) - overs - unders
    return HitRate(window, len(vals), overs, unders, pushes, line)


def current_streak(rows: list[GameLogRow], sd: StatDef, line: float) -> tuple[str, int]:
    """("over"|"under"|"none", length) for consecutive most-recent games on one side."""
    side = "none"
    length = 0
    for r in rows:
        v = stat_value(r, sd)
        if v is None or v == line:
            break
        this = "over" if v > line else "under"
        if side == "none":
            side = this
        if this != side:
            break
        length += 1
    return side, length


@dataclass(frozen=True)
class MinutesProfile:
    season_n: int
    season_mean: float | None
    l5_n: int
    l5_mean: float | None
    last_game: float | None

    @property
    def trend(self) -> float | None:
        if self.season_mean is None or self.l5_mean is None:
            return None
        return self.l5_mean - self.season_mean


def minutes_profile(rows: list[GameLogRow]) -> MinutesProfile:
    mins = [float(r.minutes) for r in rows if r.minutes is not None]
    l5 = mins[:5]
    return MinutesProfile(
        season_n=len(mins),
        season_mean=mean(mins) if mins else None,
        l5_n=len(l5),
        l5_mean=mean(l5) if l5 else None,
        last_game=mins[0] if mins else None,
    )


@dataclass(frozen=True)
class AttemptsProfile:
    season_n: int
    season_mean: float | None
    l5_mean: float | None
    season_pct: float | None  # made / attempted over the window


def attempts_profile(rows: list[GameLogRow], sd: StatDef) -> AttemptsProfile | None:
    if not sd.attempts_field:
        return None
    pairs = [(stat_value(r, sd), attempts_value(r, sd)) for r in rows]
    pairs = [(m, a) for m, a in pairs if m is not None and a is not None]
    if not pairs:
        return AttemptsProfile(0, None, None, None)
    atts = [a for _, a in pairs]
    made = sum(m for m, _ in pairs)
    tot = sum(atts)
    return AttemptsProfile(
        season_n=len(pairs),
        season_mean=mean(atts),
        l5_mean=mean(atts[:5]),
        season_pct=(made / tot) if tot else None,
    )


def home_away_split(rows: list[GameLogRow], sd: StatDef, is_home: bool) -> WindowStats:
    sub = [r for r in rows if r.isHome == is_home]
    return window_stats(sub, sd, "home" if is_home else "away", None)


def h2h_rows(rows_by_year: dict[int, list[GameLogRow]], opponent_code: str) -> dict[int, list[GameLogRow]]:
    return {y: [r for r in rows if r.opponentCode.upper() == opponent_code.upper()] for y, rows in rows_by_year.items()}


def rest_days(last_game_iso: str | None, tipoff: datetime) -> int | None:
    last = parse_iso(last_game_iso)
    if last is None:
        return None
    return (tipoff.date() - last.date()).days
