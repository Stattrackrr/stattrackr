"""Models for the stored files exactly as they exist under data/.

Field names mirror the JSON keys. Unknown keys are ignored; keys the engine
depends on are required so a changed upstream shape fails loudly at ingest.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _Raw(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)


# ---------------------------------------------------------------- player logs

class GameLogRow(_Raw):
    matchId: str
    date: str
    season: int | None = None
    round: str | int | None = None
    opponent: str
    opponentCode: str
    isHome: bool
    team: str
    teamCode: str
    minutes: float | None = None
    points: float | None = None
    rebounds: float | None = None
    offensiveRebounds: float | None = None
    defensiveRebounds: float | None = None
    assists: float | None = None
    steals: float | None = None
    blocks: float | None = None
    turnovers: float | None = None
    fouls: float | None = None
    fgMade: float | None = None
    fgAttempted: float | None = None
    twoMade: float | None = None
    twoAttempted: float | None = None
    threeMade: float | None = None
    threeAttempted: float | None = None
    ftMade: float | None = None
    ftAttempted: float | None = None
    pra: float | None = None
    pr: float | None = None
    pa: float | None = None
    ra: float | None = None


class PlayerLogFile(_Raw):
    playerId: str
    name: str
    team: str
    teamCode: str
    year: int
    seasonLabel: str | None = None
    generatedAt: str | None = None
    source: str | None = None
    gameCount: int | None = None
    games: list[GameLogRow]


class GameLogsIndexPlayer(_Raw):
    playerId: str
    name: str
    team: str
    teamCode: str
    gameCount: int
    cacheFile: str


class GameLogsIndexFile(_Raw):
    year: int
    generatedAt: str | None = None
    players: list[GameLogsIndexPlayer]


# ------------------------------------------------------------ season files

class ScheduleGame(_Raw):
    id: str
    externalId: str | None = None
    startTime: str
    round: str | int | None = None
    status: str | None = None
    homeTeam: str
    homeTeamCode: str
    homeTeamId: str | None = None
    awayTeam: str
    awayTeamCode: str
    awayTeamId: str | None = None
    homeScore: float | None = None
    awayScore: float | None = None
    venue: str | None = None


class ScheduleFile(_Raw):
    year: int
    generatedAt: str | None = None
    games: list[ScheduleGame]


class LadderTeam(_Raw):
    pos: int
    team: str
    teamCode: str
    played: int
    win: int
    loss: int
    points_for: float
    points_against: float
    last_5: str | None = None
    streak: int | None = None
    home_wins: int | None = None
    home_losses: int | None = None
    away_wins: int | None = None
    away_losses: int | None = None


class LadderFile(_Raw):
    year: int
    generatedAt: str | None = None
    teams: list[LadderTeam]


class LeaguePlayerStat(_Raw):
    playerId: str
    name: str
    team: str
    teamCode: str
    position: str | None = None
    games: int | None = None
    gamesStarted: int | None = None
    minutes: float | None = None


class LeaguePlayerStatsFile(_Raw):
    year: int
    generatedAt: str | None = None
    players: list[LeaguePlayerStat]


class RosterPlayer(_Raw):
    playerId: str | None = None  # tracker-only signings have no Rosetta id yet
    name: str
    team: str
    teamCode: str
    position: str | None = None
    jersey: str | None = None
    trackerStatus: str | None = None


class RosterTeam(_Raw):
    team: str
    teamCode: str
    headCoach: str | None = None
    players: list[RosterPlayer]


class RostersByTeamFile(_Raw):
    year: int
    generatedAt: str | None = None
    teams: list[RosterTeam]


class InjuryRow(_Raw):
    team: str
    player: str
    injury: str
    returning: str
    status: str | None = None
    note: str | None = None
    listedByNbl: bool | None = None


class InjuriesFile(_Raw):
    generatedAt: str
    source: str | None = None
    sourceUrl: str | None = None
    sourcePage: str | None = None
    sourceUpdatedText: str | None = None
    injuries: list[InjuryRow]


class RefreshStamp(_Raw):
    updatedAt: str
    workflow: str | None = None


# -------------------------------------------------------------- odds files

SnapStat = Literal["points", "rebounds", "assists", "threeMade", "pra", "pr", "pa", "ra"]


class SnapLine(_Raw):
    player: str
    playerKey: str
    book: str
    stat: SnapStat
    kind: Literal["ou", "milestone"]
    line: float
    label: str
    over: str
    under: str
    overDecimal: float | None = None
    underDecimal: float | None = None


class PropSnapshotFile(_Raw):
    gameId: str
    gameKey: str
    homeTeam: str
    awayTeam: str
    commenceTime: str
    capturedAt: str
    closing: bool
    source: str | None = None
    books: list[str] = Field(default_factory=list)
    lineCount: int | None = None
    lines: list[SnapLine]


class PropHistoryLine(_Raw):
    book: str
    player: str
    playerKey: str
    stat: SnapStat
    kind: Literal["ou", "milestone"]
    line: float
    overDecimal: float | None = None
    underDecimal: float | None = None


class PropHistoryCapture(_Raw):
    capturedAt: str
    boardSize: int
    upserts: list[PropHistoryLine]
    removed: list[str]


class PropHistoryFile(_Raw):
    format: int
    gameKey: str
    homeTeam: str
    awayTeam: str
    commenceTime: str
    mode: Literal["delta"]
    firstCapturedAt: str
    lastCapturedAt: str
    captures: list[PropHistoryCapture]


class BookTwoWay(_Raw):
    line: str
    over: str
    under: str


class BookH2H(_Raw):
    home: str
    away: str


class GameOddsBook(_Raw):
    name: str
    H2H: BookH2H
    Spread: BookTwoWay
    Total: BookTwoWay


class GameOddsCapture(_Raw):
    capturedAt: str
    bookmakers: list[GameOddsBook]


class GameOddsHistoryFile(_Raw):
    format: int
    gameKey: str
    homeTeam: str
    awayTeam: str
    commenceTime: str
    firstCapturedAt: str
    lastCapturedAt: str
    captures: list[GameOddsCapture]


# ------------------------------------------------------------- shot charts

class ShotZone(_Raw):
    zone: str
    label: str | None = None
    fga: float
    fgm: float
    fgPct: float
    share: float


class ShotZoneRank(ShotZone):
    # Stored rank sorts FG% allowed ascending (1 = best defence); null when below the attempt floor.
    rank: int | None = None
    teamsCompared: int = 0


class ShotChartPlayerFile(_Raw):
    mode: str
    playerName: str
    team: str
    years: list[int]
    gamesUsed: int
    shotCount: int
    zones: list[ShotZone]
    generatedAt: str | None = None


class ShotChartDefenseFile(_Raw):
    mode: str
    team: str
    years: list[int]
    gamesUsed: int
    shotCount: int
    zones: list[ShotZone]
    ranks: list[ShotZoneRank]
    generatedAt: str | None = None


# ----------------------------------------------------------------- lineups

class LineupPerson(_Raw):
    personId: str
    name: str
    jersey: str | None = None
    position: str | None = None
    starter: bool | None = None


class LineupTeam(_Raw):
    team: str
    teamCode: str
    isHome: bool
    starters: list[LineupPerson]
    bench: list[LineupPerson] = Field(default_factory=list)


class LineupFile(_Raw):
    fixtureId: str
    homeTeam: str
    awayTeam: str
    tipoff: str | None = None
    teams: list[LineupTeam]
