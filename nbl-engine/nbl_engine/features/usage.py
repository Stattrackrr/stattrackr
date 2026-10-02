"""Usage rate and with/without-teammate splits from player logs + team boxes."""

from __future__ import annotations

from dataclasses import dataclass
from statistics import mean

from nbl_engine.features.stats import StatDef, stat_value
from nbl_engine.features.team import TeamBoxes
from nbl_engine.models.raw import GameLogRow


def usage_pct(row: GameLogRow, boxes: TeamBoxes) -> float | None:
    """Basketball-Reference USG%: share of team possessions used while on floor."""
    box = boxes.boxes.get((row.matchId, row.teamCode.upper()))
    if box is None or not row.minutes:
        return None
    needed = (row.fgAttempted, row.ftAttempted, row.turnovers)
    if any(v is None for v in needed):
        return None
    t_fga, t_fta, t_tov, t_min = (box.totals.get("fgAttempted"), box.totals.get("ftAttempted"), box.totals.get("turnovers"), box.totals.get("minutes"))
    if None in (t_fga, t_fta, t_tov, t_min) or not t_min:
        return None
    player_poss = float(row.fgAttempted) + 0.44 * float(row.ftAttempted) + float(row.turnovers)  # type: ignore[arg-type]
    team_poss = float(t_fga) + 0.44 * float(t_fta) + float(t_tov)  # type: ignore[arg-type]
    if team_poss <= 0:
        return None
    return 100.0 * (player_poss * (float(t_min) / 5.0)) / (float(row.minutes) * team_poss)


@dataclass(frozen=True)
class UsageProfile:
    season_n: int
    season_mean: float | None
    l5_n: int
    l5_mean: float | None

    @property
    def delta(self) -> float | None:
        if self.season_mean is None or self.l5_mean is None:
            return None
        return self.l5_mean - self.season_mean


def usage_profile(rows: list[GameLogRow], boxes: TeamBoxes) -> UsageProfile:
    vals = [u for u in (usage_pct(r, boxes) for r in rows) if u is not None]
    l5 = vals[:5]
    return UsageProfile(len(vals), mean(vals) if vals else None, len(l5), mean(l5) if l5 else None)


@dataclass(frozen=True)
class WithWithout:
    teammate_id: str
    teammate_name: str
    with_n: int
    with_mean: float | None
    without_n: int
    without_mean: float | None


def with_without(
    rows: list[GameLogRow],
    sd: StatDef,
    teammate_id: str,
    teammate_name: str,
    teammate_match_ids: set[str],
) -> WithWithout:
    """Split the player's games by whether the teammate has a played row for that match."""
    w = [v for v in (stat_value(r, sd) for r in rows if r.matchId in teammate_match_ids) if v is not None]
    wo = [v for v in (stat_value(r, sd) for r in rows if r.matchId not in teammate_match_ids) if v is not None]
    return WithWithout(teammate_id, teammate_name, len(w), mean(w) if w else None, len(wo), mean(wo) if wo else None)
