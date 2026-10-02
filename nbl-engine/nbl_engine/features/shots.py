"""Shot-zone features from shot-chart-players / shot-chart-defense files.

Zones (as stored): restricted, paint, midRange, leftCorner3, rightCorner3, aboveBreak3.
Matchup rank is the shot-chart rank (FG% allowed, 1 = elite / hardest), taken from
the stored ``ranks[]`` field so it matches the dashboard. Fallback is FG% with a
4-FGA floor when a file has no stored rank.
"""

from __future__ import annotations

from dataclasses import dataclass

from nbl_engine.models.raw import ShotChartDefenseFile, ShotChartPlayerFile

# Must match lib/nbl/nblShotChartData.ts MIN_ZONE_FGA_FOR_RANK — same floor as the court.
MIN_ZONE_FGA_FOR_RANK = 4

THREE_ZONES: tuple[str, ...] = ("leftCorner3", "rightCorner3", "aboveBreak3")
PAINT_ZONES: tuple[str, ...] = ("restricted", "paint")
ZONE_ORDER: tuple[str, ...] = ("restricted", "paint", "midRange", "leftCorner3", "rightCorner3", "aboveBreak3")
ZONE_LABEL: dict[str, str] = {
    "restricted": "restricted area",
    "paint": "paint (non-restricted)",
    "midRange": "mid-range",
    "leftCorner3": "left corner three",
    "rightCorner3": "right corner three",
    "aboveBreak3": "above-the-break three",
}
ZONE_SHORT: dict[str, str] = {
    "restricted": "the rim",
    "paint": "the paint",
    "midRange": "mid-range",
    "leftCorner3": "left corner 3s",
    "rightCorner3": "right corner 3s",
    "aboveBreak3": "above-the-break 3s",
}


def zone_points(zone: str) -> int:
    return 3 if zone in THREE_ZONES else 2


@dataclass(frozen=True)
class ZoneLine:
    zone: str
    label: str
    fga: float
    fgm: float
    fg_pct: float | None
    share_fga: float | None  # of all charted FGA
    share_fgm: float | None  # of all charted makes (Makes toggle on the court)
    pts: float  # fgm x zone value
    share_pts: float | None  # of all charted points
    per_game: float | None  # pts per game used


@dataclass(frozen=True)
class PlayerZoneProfile:
    games_used: int
    shot_count: int
    total_pts: float
    zones: tuple[ZoneLine, ...]  # ZONE_ORDER
    three_share: float | None  # fraction of FGA that are threes
    three_pct: float | None
    three_fga: float
    three_fgm: float

    def zone(self, key: str) -> ZoneLine | None:
        return next((z for z in self.zones if z.zone == key), None)


def _zone_lines(zones_raw, games_used: int) -> tuple[list[ZoneLine], float, float]:
    by_zone = {z.zone: z for z in zones_raw}
    total_fga = sum(z.fga for z in zones_raw)
    total_fgm = sum(z.fgm for z in zones_raw)
    total_pts = sum(z.fgm * zone_points(z.zone) for z in zones_raw)
    out: list[ZoneLine] = []
    for key in ZONE_ORDER:
        z = by_zone.get(key)
        fga = z.fga if z else 0.0
        fgm = z.fgm if z else 0.0
        pts = fgm * zone_points(key)
        out.append(
            ZoneLine(
                zone=key,
                label=ZONE_LABEL[key],
                fga=fga,
                fgm=fgm,
                fg_pct=(fgm / fga) if fga else None,
                share_fga=(fga / total_fga) if total_fga else None,
                share_fgm=(fgm / total_fgm) if total_fgm else None,
                pts=pts,
                share_pts=(pts / total_pts) if total_pts else None,
                per_game=(pts / games_used) if games_used else None,
            )
        )
    return out, total_fga, total_pts


def player_zone_profile(sc: ShotChartPlayerFile) -> PlayerZoneProfile:
    lines, total_fga, total_pts = _zone_lines(sc.zones, sc.gamesUsed)
    three_fga = sum(l.fga for l in lines if l.zone in THREE_ZONES)
    three_fgm = sum(l.fgm for l in lines if l.zone in THREE_ZONES)
    return PlayerZoneProfile(
        games_used=sc.gamesUsed,
        shot_count=sc.shotCount,
        total_pts=total_pts,
        zones=tuple(lines),
        three_share=(three_fga / total_fga) if total_fga else None,
        three_pct=(three_fgm / three_fga) if three_fga else None,
        three_fga=three_fga,
        three_fgm=three_fgm,
    )


@dataclass(frozen=True)
class ZoneDefence:
    zone: str
    label: str
    fga_allowed: float
    fgm_allowed: float
    fg_pct_allowed: float | None
    pts_allowed_per_game: float | None
    rank_pts: tuple[int, int] | None  # unused for matchup; kept for tests
    rank_pct: tuple[int, int] | None  # FG% allowed among every stored team with fga >= 4
    rank: tuple[int, int] | None  # shot-chart rank: stored file rank, else rank_pct; 1 = elite / hardest


@dataclass(frozen=True)
class DefenceZoneProfile:
    team_code: str
    games_used: int
    zones: tuple[ZoneDefence, ...]
    three_fga_allowed: float
    three_fgm_allowed: float
    three_pct_allowed: float | None

    def zone(self, key: str) -> ZoneDefence | None:
        return next((z for z in self.zones if z.zone == key), None)


def _rank_asc(values: dict[str, float | None]) -> dict[str, tuple[int, int]]:
    valid = sorted(((c, v) for c, v in values.items() if v is not None), key=lambda kv: (kv[1], kv[0]))
    return {c: (i + 1, len(valid)) for i, (c, _) in enumerate(valid)}


def defence_zone_profiles(files: dict[str, ShotChartDefenseFile], min_games: int) -> dict[str, DefenceZoneProfile]:
    """Per-team zone defence. Matchup rank is the shot-chart FG% rank for every team.

    Stored ``ranks[]`` wins so the model matches the court. Fallback ranks every
    cached team with at least MIN_ZONE_FGA_FOR_RANK attempts — the same floor as
    the dashboard, and not filtered by team_min_games (that would shift #1 of 10
    to #1 of 8 for some opponents).
    """
    per_team: dict[str, tuple[list[ZoneLine], int, dict[str, tuple[int, int]]]] = {}
    for code, sd in files.items():
        lines, _, _ = _zone_lines(sd.zones, sd.gamesUsed)
        stored = {r.zone: (int(r.rank), int(r.teamsCompared or 0)) for r in sd.ranks if r.rank is not None}
        per_team[code] = (lines, sd.gamesUsed, stored)

    ranks_pts: dict[str, dict[str, tuple[int, int]]] = {}
    ranks_pct: dict[str, dict[str, tuple[int, int]]] = {}
    for key in ZONE_ORDER:
        pts_vals: dict[str, float | None] = {}
        pct_vals: dict[str, float | None] = {}
        for code, (lines, games, _stored) in per_team.items():
            z = next(l for l in lines if l.zone == key)
            pct_vals[code] = z.fg_pct if z.fga >= MIN_ZONE_FGA_FOR_RANK else None
            pts_vals[code] = z.per_game if games >= min_games and z.fga >= MIN_ZONE_FGA_FOR_RANK else None
        ranks_pts[key] = _rank_asc(pts_vals)
        ranks_pct[key] = _rank_asc(pct_vals)

    out: dict[str, DefenceZoneProfile] = {}
    for code, (lines, games, stored) in per_team.items():
        zones = tuple(
            ZoneDefence(
                zone=l.zone,
                label=l.label,
                fga_allowed=l.fga,
                fgm_allowed=l.fgm,
                fg_pct_allowed=l.fg_pct,
                pts_allowed_per_game=l.per_game,
                rank_pts=ranks_pts[l.zone].get(code),
                rank_pct=ranks_pct[l.zone].get(code),
                rank=stored.get(l.zone) or ranks_pct[l.zone].get(code),
            )
            for l in lines
        )
        t_fga = sum(z.fga_allowed for z in zones if z.zone in THREE_ZONES)
        t_fgm = sum(z.fgm_allowed for z in zones if z.zone in THREE_ZONES)
        out[code] = DefenceZoneProfile(
            team_code=code,
            games_used=games,
            zones=zones,
            three_fga_allowed=t_fga,
            three_fgm_allowed=t_fgm,
            three_pct_allowed=(t_fgm / t_fga) if t_fga else None,
        )
    return out


@dataclass(frozen=True)
class ZoneMatchup:
    """How much of the player's charted scoring comes from zones the opponent leaks / locks down.

    favourable = opponent is easy there (rank >= bottom, allows the most).
    unfavourable = opponent is hard there (rank <= top, allows the fewest).
    """

    favourable_share: float  # share of player's points from zones where opp rank >= bottom (easy)
    unfavourable_share: float  # ... where opp rank <= top (hard / elite on the shot chart)
    favourable_zones: tuple[str, ...]
    unfavourable_zones: tuple[str, ...]

    @property
    def edge(self) -> float:
        return self.favourable_share - self.unfavourable_share


def zone_matchup(player: PlayerZoneProfile, defence: DefenceZoneProfile, top_rank: int, bottom_rank: int, min_zone_share: float) -> ZoneMatchup:
    fav = unf = 0.0
    fav_z: list[str] = []
    unf_z: list[str] = []
    for pz in player.zones:
        if pz.share_pts is None or pz.share_pts < min_zone_share:
            continue
        dz = defence.zone(pz.zone)
        if not dz or not dz.rank:
            continue
        if dz.rank[0] <= top_rank:
            unf += pz.share_pts
            unf_z.append(pz.zone)
        elif dz.rank[0] >= bottom_rank:
            fav += pz.share_pts
            fav_z.append(pz.zone)
    return ZoneMatchup(fav, unf, tuple(fav_z), tuple(unf_z))
