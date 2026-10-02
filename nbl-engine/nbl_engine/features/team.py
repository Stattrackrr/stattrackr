"""Team-level features rebuilt from player logs (the stored team-stats file is not used).

A team-game box is the sum of that team's player rows for a matchId. From the
boxes we derive what each team scores and allows per game, possessions/pace,
and ranks among the teams that have played.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from statistics import mean

from nbl_engine.features.stats import StatDef
from nbl_engine.ingest.timeutil import parse_iso
from nbl_engine.models.raw import GameLogRow

BOX_FIELDS: tuple[str, ...] = (
    "points",
    "rebounds",
    "offensiveRebounds",
    "defensiveRebounds",
    "assists",
    "steals",
    "blocks",
    "turnovers",
    "fgMade",
    "fgAttempted",
    "threeMade",
    "threeAttempted",
    "ftMade",
    "ftAttempted",
    "minutes",
)


@dataclass
class TeamBox:
    match_id: str
    date: str
    team_code: str
    opponent_code: str
    is_home: bool
    totals: dict[str, float] = field(default_factory=dict)
    player_rows: int = 0

    def possessions(self) -> float | None:
        fga = self.totals.get("fgAttempted")
        oreb = self.totals.get("offensiveRebounds")
        tov = self.totals.get("turnovers")
        fta = self.totals.get("ftAttempted")
        if None in (fga, oreb, tov, fta):
            return None
        return float(fga) - float(oreb) + float(tov) + 0.44 * float(fta)  # type: ignore[arg-type]

    def team_minutes(self) -> float | None:
        m = self.totals.get("minutes")
        return float(m) / 5.0 if m else None


@dataclass
class TeamBoxes:
    year: int
    boxes: dict[tuple[str, str], TeamBox] = field(default_factory=dict)  # (matchId, teamCode)

    @classmethod
    def from_logs(cls, year: int, logs: list[list[GameLogRow]]) -> "TeamBoxes":
        tb = cls(year=year)
        for rows in logs:
            for r in rows:
                key = (r.matchId, r.teamCode.upper())
                box = tb.boxes.get(key)
                if box is None:
                    box = TeamBox(r.matchId, r.date, r.teamCode.upper(), r.opponentCode.upper(), r.isHome)
                    tb.boxes[key] = box
                box.player_rows += 1
                for f in BOX_FIELDS:
                    v = getattr(r, f, None)
                    if v is not None:
                        box.totals[f] = box.totals.get(f, 0.0) + float(v)
        return tb

    def team_games(self, team_code: str) -> list[TeamBox]:
        games = [b for b in self.boxes.values() if b.team_code == team_code.upper()]
        return sorted(games, key=lambda b: (parse_iso(b.date) or 0, b.match_id), reverse=True)  # type: ignore[arg-type]

    def opponent_box(self, box: TeamBox) -> TeamBox | None:
        return self.boxes.get((box.match_id, box.opponent_code))

    def teams(self) -> list[str]:
        return sorted({b.team_code for b in self.boxes.values()})

    # ------------------------------------------------------------- allowed
    def allowed_per_game(self, team_code: str, fields: tuple[str, ...], limit: int | None = None) -> tuple[float | None, int]:
        """Average of opponents' summed `fields` in games vs team_code (newest `limit`)."""
        vals: list[float] = []
        for box in self.team_games(team_code)[: limit or None]:
            opp = self.opponent_box(box)
            if opp is None:
                continue
            parts = [opp.totals.get(f) for f in fields]
            if any(p is None for p in parts):
                continue
            vals.append(float(sum(parts)))  # type: ignore[arg-type]
        return (mean(vals) if vals else None), len(vals)

    def scored_per_game(self, team_code: str, fields: tuple[str, ...], limit: int | None = None) -> tuple[float | None, int]:
        vals: list[float] = []
        for box in self.team_games(team_code)[: limit or None]:
            parts = [box.totals.get(f) for f in fields]
            if any(p is None for p in parts):
                continue
            vals.append(float(sum(parts)))  # type: ignore[arg-type]
        return (mean(vals) if vals else None), len(vals)

    def allowed_pct(self, team_code: str, made: str, attempted: str) -> tuple[float | None, int]:
        m = a = 0.0
        n = 0
        for box in self.team_games(team_code):
            opp = self.opponent_box(box)
            if opp is None or opp.totals.get(attempted) is None:
                continue
            m += opp.totals.get(made, 0.0)
            a += opp.totals[attempted]
            n += 1
        return ((m / a) if a else None), n

    def pace_per_game(self, team_code: str, limit: int | None = None) -> tuple[float | None, int]:
        """Possessions per 40 minutes, averaged over both teams in each game."""
        vals: list[float] = []
        for box in self.team_games(team_code)[: limit or None]:
            opp = self.opponent_box(box)
            p1, p2 = box.possessions(), (opp.possessions() if opp else None)
            tm = box.team_minutes()
            if p1 is None or p2 is None or not tm:
                continue
            vals.append(((p1 + p2) / 2.0) * 40.0 / tm)
        return (mean(vals) if vals else None), len(vals)

    # ---------------------------------------------------------------- ranks
    def rank_desc(self, values: dict[str, float | None]) -> dict[str, tuple[int, int]]:
        """Rank teams by value descending (1 = highest). Returns code -> (rank, compared)."""
        valid = [(code, v) for code, v in values.items() if v is not None]
        valid.sort(key=lambda kv: (-kv[1], kv[0]))
        return {code: (i + 1, len(valid)) for i, (code, _) in enumerate(valid)}

    def rank_asc(self, values: dict[str, float | None]) -> dict[str, tuple[int, int]]:
        """Rank teams by value ascending (1 = lowest = hardest matchup)."""
        valid = [(code, v) for code, v in values.items() if v is not None]
        valid.sort(key=lambda kv: (kv[1], kv[0]))
        return {code: (i + 1, len(valid)) for i, (code, _) in enumerate(valid)}

    def allowed_ranks(self, sd: StatDef, min_games: int, limit: int | None = None) -> dict[str, tuple[int, int]]:
        vals: dict[str, float | None] = {}
        for code in self.teams():
            v, n = self.allowed_per_game(code, sd.team_allowed_fields, limit)
            vals[code] = v if n >= min_games else None
        return self.rank_asc(vals)

    def pace_ranks(self, min_games: int) -> dict[str, tuple[int, int]]:
        vals: dict[str, float | None] = {}
        for code in self.teams():
            v, n = self.pace_per_game(code)
            vals[code] = v if n >= min_games else None
        return self.rank_asc(vals)

    def allowed_pct_ranks(self, made: str, attempted: str, min_games: int) -> dict[str, tuple[int, int]]:
        vals: dict[str, float | None] = {}
        for code in self.teams():
            v, n = self.allowed_pct(code, made, attempted)
            vals[code] = v if n >= min_games else None
        return self.rank_asc(vals)
