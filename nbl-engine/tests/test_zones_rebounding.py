from __future__ import annotations

import pytest

from nbl_engine.features.rebounding import board_matchup, opponent_boards, rebound_rates, rebound_split
from nbl_engine.features.shots import defence_zone_profiles, player_zone_profile, zone_matchup
from nbl_engine.features.team import TeamBoxes
from nbl_engine.models.raw import ShotChartDefenseFile, ShotChartPlayerFile, ShotZone, ShotZoneRank
from nbl_engine.reasoning.rules import run_rules
from tests.conftest import make_row
from tests.test_rules_and_tiers import claim


def _zones(**fga_fgm: tuple[float, float]) -> list[ShotZone]:
    out = []
    for zone in ("restricted", "paint", "midRange", "leftCorner3", "rightCorner3", "aboveBreak3"):
        fga, fgm = fga_fgm.get(zone, (0, 0))
        out.append(ShotZone(zone=zone, fga=fga, fgm=fgm, fgPct=(fgm / fga * 100) if fga else 0, share=0))
    return out


def _player(games=4, **z) -> ShotChartPlayerFile:
    zones = _zones(**z)
    return ShotChartPlayerFile(mode="player", playerName="P", team="MEL", years=[2026], gamesUsed=games, shotCount=int(sum(x.fga for x in zones)), zones=zones)


def _defence(team: str, games=4, ranks=None, **z) -> ShotChartDefenseFile:
    zones = _zones(**z)
    return ShotChartDefenseFile(mode="defense", team=team, years=[2026], gamesUsed=games, shotCount=int(sum(x.fga for x in zones)), zones=zones, ranks=ranks or [])


def test_player_zone_profile_points_and_shares():
    sp = player_zone_profile(_player(restricted=(20, 14), midRange=(10, 4), aboveBreak3=(10, 4)))
    assert sp.total_pts == 14 * 2 + 4 * 2 + 4 * 3
    r = sp.zone("restricted")
    assert r.share_fga == pytest.approx(0.5) and r.share_pts == pytest.approx(28 / 48)
    assert r.share_fgm == pytest.approx(14 / 22)
    assert sp.three_share == pytest.approx(0.25) and sp.three_pct == pytest.approx(0.4)


def test_makes_pct_can_differ_from_scoring_pct():
    """Court Makes is FGM share. Engine scoring share weights 3s. Bolden-shaped split."""
    from nbl_engine.evidence.builder import _zone_share_text

    sp = player_zone_profile(_player(restricted=(7, 6), rightCorner3=(5, 2), aboveBreak3=(7, 2)))
    r = sp.zone("restricted")
    assert r.share_fgm == pytest.approx(0.6)
    assert r.share_pts == pytest.approx(0.5)
    text = _zone_share_text("Jonah Bolden", r, "the rim")
    assert text == "60% of Jonah Bolden's makes are from the rim (6 of 7)."
    assert "scoring" not in text


def test_defence_ranks_one_is_hardest():
    files = {
        "A": _defence("A", restricted=(60, 48)),  # 96 pts / 4 g = 24.0
        "B": _defence("B", restricted=(60, 30)),  # 15.0
        "C": _defence("C", restricted=(60, 36)),  # 18.0
    }
    d = defence_zone_profiles(files, min_games=1)
    assert d["B"].zone("restricted").rank_pts == (1, 3)  # allows fewest
    assert d["A"].zone("restricted").rank_pts == (3, 3)  # allows most
    assert d["B"].zone("restricted").rank_pct == (1, 3)
    assert d["B"].zone("restricted").rank == (1, 3)  # no stored ranks → FG% fallback
    assert d["A"].zone("paint").rank_pts is None  # no attempts -> unranked
    assert defence_zone_profiles(files, min_games=5)["A"].zone("restricted").rank_pts is None


def test_stored_shot_chart_rank_wins():
    files = {
        "A": _defence(
            "A",
            restricted=(60, 48),
            ranks=[
                ShotZoneRank(zone="restricted", label="Restricted", fga=60, fgm=48, fgPct=80, share=100, rank=1, teamsCompared=10),
            ],
        ),
        "B": _defence("B", restricted=(60, 30)),
    }
    d = defence_zone_profiles(files, min_games=1)
    assert d["A"].zone("restricted").rank == (1, 10)
    assert d["A"].zone("restricted").rank_pts == (2, 2)
    assert d["B"].zone("restricted").rank == d["B"].zone("restricted").rank_pct


def test_zone_fg_rank_does_not_shift_with_team_min_games():
    """Dashboard ranks every team with 4+ FGA. team_min_games must not change #1 of N."""
    files = {
        "A": _defence("A", games=2, restricted=(60, 48)),
        "B": _defence("B", games=2, restricted=(60, 30)),
    }
    loose = defence_zone_profiles(files, min_games=1)
    tight = defence_zone_profiles(files, min_games=99)
    assert loose["B"].zone("restricted").rank == (1, 2)
    assert tight["B"].zone("restricted").rank == (1, 2)
    assert tight["A"].zone("restricted").rank_pts is None


def test_every_shot_chart_defense_file_feeds_the_same_rank():
    from pathlib import Path

    from nbl_engine.models.raw import ShotChartDefenseFile

    root = Path(__file__).resolve().parents[2] / "data" / "nbl-model" / "cache" / "shot-chart-defense"
    if not root.exists():
        pytest.skip("no shot-chart-defense cache")
    files = {}
    for path in sorted(root.glob("*.json")):
        sd = ShotChartDefenseFile.model_validate_json(path.read_text(encoding="utf-8"))
        files[sd.team] = sd
    assert len(files) >= 8
    profiles = defence_zone_profiles(files, min_games=99)
    mismatches = []
    for team, sd in files.items():
        for row in sd.ranks:
            if row.rank is None:
                continue
            got = profiles[team].zone(row.zone).rank
            want = (int(row.rank), int(row.teamsCompared or 0))
            if got != want:
                mismatches.append(f"{team} {row.zone}: engine {got} vs chart {want}")
    assert mismatches == []


def test_zone_matchup_edge():
    sp = player_zone_profile(_player(restricted=(20, 14), aboveBreak3=(10, 4)))  # 28 pts (70%) + 12 pts (30%)
    files = {f"T{i}": _defence(f"T{i}", restricted=(60, 30 + i), aboveBreak3=(40, 10 + i)) for i in range(10)}
    d = defence_zone_profiles(files, min_games=1)
    easiest = d["T9"]  # allows most everywhere -> rank 10
    zm = zone_matchup(sp, easiest, top_rank=3, bottom_rank=8, min_zone_share=0.10)
    assert zm.favourable_share == pytest.approx(1.0) and zm.edge == pytest.approx(1.0)
    hardest = d["T0"]
    zm = zone_matchup(sp, hardest, top_rank=3, bottom_rank=8, min_zone_share=0.10)
    assert zm.unfavourable_share == pytest.approx(1.0) and zm.edge == pytest.approx(-1.0)


def test_zone_matchup_text_quotes_make_pct_not_a_sum():
    """44% of scoring from weak spots is a sum — it is not a Makes cell. Quote each zone."""
    from nbl_engine.evidence.builder import _zone_matchup_text

    sp = player_zone_profile(
        _player(restricted=(5, 3), paint=(2, 1), midRange=(1, 1), leftCorner3=(2, 1), aboveBreak3=(2, 1), rightCorner3=(3, 0))
    )
    files = {f"T{i}": _defence(f"T{i}", restricted=(60, 30 + i), paint=(40, 20 + i), midRange=(40, 16 + i), leftCorner3=(30, 8 + i), aboveBreak3=(40, 10 + i)) for i in range(10)}
    d = defence_zone_profiles(files, min_games=1)
    zm = zone_matchup(sp, d["T9"], top_rank=3, bottom_rank=8, min_zone_share=0.10)
    text = _zone_matchup_text("Sam Waardenburg", "Cairns Taipans", zm, sp, d["T9"])
    assert "43% of makes from the rim" in text
    assert "14% of makes from the paint" in text
    assert "scoring" not in text
    assert "44%" not in text


def test_rebound_split_and_rates():
    rows = [make_row("m1", "2026-09-19T09:30:00", team="MEL", opp="CNS", rebounds=6, oreb=4, minutes=40, fga=10)]
    opp_rows = [make_row("m1", "2026-09-19T09:30:00", team="CNS", opp="MEL", home=False, rebounds=10, oreb=2, minutes=200, fga=10)]
    team_rows = rows + [make_row("m1", "2026-09-19T09:30:00", team="MEL", opp="CNS", rebounds=10, oreb=2, minutes=160, fga=10)]
    boxes = TeamBoxes.from_logs(2026, [team_rows, opp_rows])
    split = rebound_split(rows)
    assert split.oreb_share == pytest.approx(4 / 6) and split.dreb_share == pytest.approx(2 / 6)
    rates = rebound_rates(rows, boxes)
    # REB% = 100*6*(200/5)/(40*(16+10)) ; OREB% = 100*4*40/(40*(6+8)) ; DREB% = 100*2*40/(40*(10+2))
    assert rates.reb_pct == pytest.approx(100 * 6 * 40 / (40 * 26))
    assert rates.oreb_pct == pytest.approx(100 * 4 * 40 / (40 * 14))
    assert rates.dreb_pct == pytest.approx(100 * 2 * 40 / (40 * 12))


def test_opponent_boards_and_matchup_direction():
    # Build 3 teams; team X concedes many OREB (bad defensive glass), few DREB.
    def game(mid, a, b, a_oreb, a_dreb, b_oreb, b_dreb):
        ra = make_row(mid, "2026-09-19T09:30:00", team=a, opp=b, rebounds=a_oreb + a_dreb, oreb=a_oreb)
        rb = make_row(mid, "2026-09-19T09:30:00", team=b, opp=a, home=False, rebounds=b_oreb + b_dreb, oreb=b_oreb)
        return [ra], [rb]

    logs = []
    for pair in (game("g1", "X", "Y", 5, 20, 15, 30), game("g2", "X", "Z", 5, 20, 14, 31), game("g3", "Y", "Z", 8, 30, 8, 30)):
        logs.extend(pair)
    boxes = TeamBoxes.from_logs(2026, logs)
    x = opponent_boards(boxes, "X", min_games=1)
    assert x.oreb_allowed == pytest.approx(14.5) and x.oreb_rank == (3, 3)
    assert x.dreb_rank == (3, 3)
    split = rebound_split([make_row("q", "2026-09-19T09:30:00", rebounds=5, oreb=3)])
    assert board_matchup(split, x, top_rank=1, bottom_rank=3) == pytest.approx(1.0)
    z = opponent_boards(boxes, "Z", min_games=1)
    assert board_matchup(split, z, top_rank=1, bottom_rank=3) <= 0


def test_shot_profile_rule_for_points_and_rebounding_rule(cfg):
    pts_claims = [
        claim("c1", "shot_profile", "zone_share_restricted", 0.55, 4, text="55% of P's makes are from the rim (14 of 20) — 55% of his scoring."),
        claim("c2", "shot_profile", "opp_zone_rank_restricted", 10, 4, text="Opp are shot-chart #10 of 10 at the rim (easiest). Opponents shoot 70% there (14 of 20)."),
        claim("c3", "shot_profile", "zone_matchup_edge", 0.55, 4, text="Opp's weaker spots vs P: 55% of makes from the rim, shot-chart #10 of 10 (easiest)."),
    ]
    inf = {i.rule_id: i for i in run_rules(pts_claims, cfg, "points")}["shot_profile_vs_opp"]
    assert (inf.status, inf.direction) == ("confirmed", "over")
    assert set(inf.claim_ids) == {"c1", "c2", "c3"}
    reb_none = {i.rule_id: i for i in run_rules(pts_claims, cfg, "rebounds")}["shot_profile_vs_opp"]
    assert reb_none.status == "cannot_determine"

    reb_claims = [
        claim("r1", "rebounding", "oreb_share", 0.6, 4, text="60% of P's rebounds are offensive."),
        claim("r2", "rebounding", "board_matchup_edge", -0.6, 4, text="matchup score -0.60"),
    ]
    inf = {i.rule_id: i for i in run_rules(reb_claims, cfg, "rebounds")}["rebound_profile_vs_opp"]
    assert (inf.status, inf.direction) == ("confirmed", "under")
    assert {i.rule_id: i for i in run_rules(reb_claims, cfg, "assists")}["rebound_profile_vs_opp"].status == "cannot_determine"
