from __future__ import annotations

import pytest

from nbl_engine.config import load_thresholds
from nbl_engine.models.raw import GameLogRow


def make_row(
    match_id: str,
    date: str,
    *,
    team: str = "MEL",
    opp: str = "CNS",
    home: bool = True,
    minutes: float = 30.0,
    points: float = 15,
    rebounds: float = 5,
    assists: float = 3,
    three_made: float = 2,
    three_att: float = 5,
    fga: float = 12,
    fta: float = 4,
    tov: float = 2,
    oreb: float = 1,
) -> GameLogRow:
    return GameLogRow(
        matchId=match_id,
        date=date,
        season=2026,
        opponent=opp,
        opponentCode=opp,
        isHome=home,
        team=team,
        teamCode=team,
        minutes=minutes,
        points=points,
        rebounds=rebounds,
        offensiveRebounds=oreb,
        defensiveRebounds=rebounds - oreb,
        assists=assists,
        steals=1,
        blocks=0,
        turnovers=tov,
        fouls=2,
        fgMade=6,
        fgAttempted=fga,
        threeMade=three_made,
        threeAttempted=three_att,
        ftMade=3,
        ftAttempted=fta,
        pra=points + rebounds + assists,
        pr=points + rebounds,
        pa=points + assists,
        ra=rebounds + assists,
    )


@pytest.fixture
def cfg():
    return load_thresholds()


@pytest.fixture
def rows() -> list[GameLogRow]:
    """Six games, oldest to newest in input order, mixed venues/opponents."""
    return [
        make_row("m1", "2026-09-19T09:30:00", opp="CNS", home=True, three_made=1, minutes=28),
        make_row("m2", "2026-09-22T09:30:00", opp="SYD", home=False, three_made=3, minutes=30),
        make_row("m3", "2026-09-25T09:30:00", opp="PER", home=True, three_made=2, minutes=31),
        make_row("m4", "2026-09-27T09:30:00", opp="CNS", home=False, three_made=4, minutes=33),
        make_row("m5", "2026-09-29T09:30:00", opp="TAS", home=True, three_made=3, minutes=34),
        make_row("m6", "2026-10-01T09:30:00", opp="ADL", home=True, three_made=5, minutes=36),
    ]
