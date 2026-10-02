from __future__ import annotations

import pytest

from nbl_engine.features.stats import STATS
from nbl_engine.features.team import TeamBoxes
from nbl_engine.features.usage import usage_pct, usage_profile, with_without
from tests.conftest import make_row

THREE = STATS["threeMade"]


def _two_team_logs():
    """One game m1: MEL (home) vs CNS. Two players per side."""
    mel = [
        make_row("m1", "2026-09-19T09:30:00", team="MEL", opp="CNS", home=True, minutes=100, three_made=4, three_att=10, fga=40, fta=10, tov=5, oreb=4),
        make_row("m1", "2026-09-19T09:30:00", team="MEL", opp="CNS", home=True, minutes=100, three_made=2, three_att=6, fga=40, fta=10, tov=5, oreb=4),
    ]
    cns = [
        make_row("m1", "2026-09-19T09:30:00", team="CNS", opp="MEL", home=False, minutes=100, three_made=6, three_att=12, fga=45, fta=8, tov=6, oreb=5),
        make_row("m1", "2026-09-19T09:30:00", team="CNS", opp="MEL", home=False, minutes=100, three_made=3, three_att=8, fga=45, fta=8, tov=6, oreb=5),
    ]
    return mel, cns


def test_team_boxes_sum_and_allowed():
    mel, cns = _two_team_logs()
    tb = TeamBoxes.from_logs(2026, [mel, cns])
    assert set(tb.teams()) == {"MEL", "CNS"}
    box = tb.boxes[("m1", "MEL")]
    assert box.totals["threeMade"] == 6 and box.player_rows == 2
    # CNS allowed = MEL's makes
    allowed, n = tb.allowed_per_game("CNS", ("threeMade",))
    assert (allowed, n) == (6.0, 1)
    allowed_mel, _ = tb.allowed_per_game("MEL", ("threeMade",))
    assert allowed_mel == 9.0
    pct, _ = tb.allowed_pct("MEL", "threeMade", "threeAttempted")
    assert pct == pytest.approx(9 / 20)


def test_pace_and_ranks():
    mel, cns = _two_team_logs()
    tb = TeamBoxes.from_logs(2026, [mel, cns])
    pace, n = tb.pace_per_game("MEL")
    mel_poss = 80 - 8 + 10 + 0.44 * 20
    cns_poss = 90 - 10 + 12 + 0.44 * 16
    assert n == 1 and pace == pytest.approx(((mel_poss + cns_poss) / 2) * 40 / 40)
    ranks = tb.allowed_ranks(THREE, min_games=1)
    assert ranks["CNS"] == (1, 2) and ranks["MEL"] == (2, 2)
    assert tb.allowed_ranks(THREE, min_games=2) == {}


def test_usage_pct_formula():
    mel, cns = _two_team_logs()
    tb = TeamBoxes.from_logs(2026, [mel, cns])
    row = mel[0]
    player_poss = 40 + 0.44 * 10 + 5
    team_poss = 80 + 0.44 * 20 + 10
    expected = 100 * (player_poss * (200 / 5)) / (100 * team_poss)
    assert usage_pct(row, tb) == pytest.approx(expected)
    up = usage_profile([row], tb)
    assert up.season_n == 1 and up.l5_n == 1 and up.season_mean == pytest.approx(expected)


def test_with_without_split():
    rows = [
        make_row("a", "2026-09-19T09:30:00", three_made=1),
        make_row("b", "2026-09-22T09:30:00", three_made=4),
        make_row("c", "2026-09-25T09:30:00", three_made=5),
    ]
    ww = with_without(rows, THREE, "t1", "Mate", {"a"})
    assert (ww.with_n, ww.with_mean) == (1, 1.0)
    assert (ww.without_n, ww.without_mean) == (2, 4.5)
