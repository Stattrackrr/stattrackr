from __future__ import annotations

from datetime import datetime, timezone

import pytest

from nbl_engine.features import player as pf
from nbl_engine.features.stats import STATS, resolve_stat, stat_value
from tests.conftest import make_row

THREE = STATS["threeMade"]


def test_resolve_stat_aliases():
    assert resolve_stat("3PM").key == "threeMade"
    assert resolve_stat("pts").key == "points"
    assert resolve_stat("threeMade").key == "threeMade"
    assert resolve_stat("nope") is None


def test_composite_stat_falls_back_to_parts():
    row = make_row("m", "2026-09-19T09:30:00", points=10, rebounds=4, assists=6)
    row = row.model_copy(update={"pra": None})
    assert stat_value(row, STATS["pra"]) == 20


def test_played_rows_newest_first_and_drops_dnp(rows):
    dnp = make_row("m0", "2026-09-10T09:30:00", minutes=0)
    out = pf.played_rows([dnp, *rows])
    assert [r.matchId for r in out] == ["m6", "m5", "m4", "m3", "m2", "m1"]


def test_window_stats(rows):
    newest = pf.played_rows(rows)
    season = pf.window_stats(newest, THREE, "season", None)
    assert season.n == 6 and season.mean == pytest.approx(3.0)
    l5 = pf.window_stats(newest, THREE, "L5", 5)
    assert l5.n == 5 and l5.values == (5, 3, 4, 2, 3)
    assert l5.mean == pytest.approx(3.4)


def test_hit_rate_counts_pushes(rows):
    newest = pf.played_rows(rows)
    hr = pf.hit_rate(newest, THREE, 3.0, "season", None)
    assert (hr.overs, hr.unders, hr.pushes) == (2, 2, 2)
    assert hr.rate == pytest.approx(0.5)
    hr2 = pf.hit_rate(newest, THREE, 2.5, "L5", 5)
    assert (hr2.overs, hr2.unders, hr2.n) == (4, 1, 5)
    assert hr2.rate == pytest.approx(0.8)


def test_current_streak(rows):
    newest = pf.played_rows(rows)
    assert pf.current_streak(newest, THREE, 2.5) == ("over", 3)  # 5,3,4 then 2 breaks
    assert pf.current_streak(newest, THREE, 4.5) == ("over", 1)
    assert pf.current_streak(newest, THREE, 5.0) == ("none", 0)  # push on first game


def test_minutes_profile(rows):
    newest = pf.played_rows(rows)
    mp = pf.minutes_profile(newest)
    assert mp.season_n == 6 and mp.season_mean == pytest.approx(32.0)
    assert mp.l5_mean == pytest.approx((36 + 34 + 33 + 31 + 30) / 5)
    assert mp.trend == pytest.approx(mp.l5_mean - 32.0)
    assert mp.last_game == 36


def test_attempts_profile(rows):
    ap = pf.attempts_profile(pf.played_rows(rows), THREE)
    assert ap is not None and ap.season_n == 6
    assert ap.season_pct == pytest.approx(18 / 30)
    assert pf.attempts_profile(rows, STATS["rebounds"]) is None


def test_home_away_and_h2h(rows):
    newest = pf.played_rows(rows)
    home = pf.home_away_split(newest, THREE, True)
    away = pf.home_away_split(newest, THREE, False)
    assert home.n == 4 and away.n == 2
    assert away.mean == pytest.approx(3.5)
    h2h = pf.h2h_rows({2026: newest}, "cns")
    assert [r.matchId for r in h2h[2026]] == ["m4", "m1"]


def test_rest_days():
    tip = datetime(2026, 10, 3, 9, 30, tzinfo=timezone.utc)
    assert pf.rest_days("2026-10-01T09:30:00", tip) == 2
    assert pf.rest_days(None, tip) is None
