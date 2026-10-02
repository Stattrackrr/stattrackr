"""Guarantees that apply to every published pick, not one player."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from nbl_engine.features.shots import defence_zone_profiles
from nbl_engine.models.raw import ShotChartDefenseFile

REPO = Path(__file__).resolve().parents[2]
PICKS_DIR = REPO / "data" / "nbl-model" / "cache" / "engine-picks"
DEFENSE_DIR = REPO / "data" / "nbl-model" / "cache" / "shot-chart-defense"


def _picks_files() -> list[Path]:
    if not PICKS_DIR.exists():
        return []
    return sorted(PICKS_DIR.glob("*.json"))


@pytest.fixture(scope="module")
def all_picks() -> list[dict]:
    rows = []
    for path in _picks_files():
        data = json.loads(path.read_text(encoding="utf-8"))
        for pick in data.get("picks") or []:
            rows.append(pick)
    return rows


def test_every_pick_has_one_best_over_not_two_book_names(all_picks):
    if not all_picks:
        pytest.skip("no engine-picks cache")
    problems = []
    for pick in all_picks:
        who = f"{pick.get('player_name')} {pick.get('stat')} {pick.get('game_label')}"
        ls = pick.get("line_summary") or {}
        if ls.get("best_over_line") is not None:
            if ls.get("best_over_book") != ls.get("best_over_line_book"):
                problems.append(f"{who}: best_over_book {ls.get('best_over_book')} != best_over_line_book {ls.get('best_over_line_book')}")
            if ls.get("best_over_decimal") != ls.get("best_over_line_decimal"):
                problems.append(f"{who}: best_over_decimal {ls.get('best_over_decimal')} != best_over_line_decimal {ls.get('best_over_line_decimal')}")
        if ls.get("best_under_line") is not None:
            if ls.get("best_under_book") != ls.get("best_under_line_book"):
                problems.append(f"{who}: best_under_book {ls.get('best_under_book')} != best_under_line_book {ls.get('best_under_line_book')}")
        metrics = [c.get("metric") for c in pick.get("claims") or []]
        if "best_over_price" in metrics:
            problems.append(f"{who}: still emits best_over_price")
        if metrics.count("best_over_line") > 1:
            problems.append(f"{who}: duplicate best_over_line claims")
        texts = [c.get("as_text") or "" for c in pick.get("claims") or [] if str(c.get("metric") or "").startswith("best_")]
        if len(texts) >= 2 and texts[0] and any("best over price" in t.lower() for t in texts):
            problems.append(f"{who}: overlapping best-over wording {texts}")
    assert problems == []


def test_every_scoring_pick_zone_rank_matches_shot_chart(all_picks):
    if not all_picks:
        pytest.skip("no engine-picks cache")
    if not DEFENSE_DIR.exists():
        pytest.skip("no shot-chart-defense cache")
    files = {}
    for path in DEFENSE_DIR.glob("*.json"):
        sd = ShotChartDefenseFile.model_validate_json(path.read_text(encoding="utf-8"))
        files[sd.team] = sd
    profiles = defence_zone_profiles(files, min_games=99)
    by_name = {name.lower(): prof for name, prof in profiles.items()}
    problems = []
    for pick in all_picks:
        if pick.get("stat") not in {"points", "pra", "pr", "pa"}:
            continue
        who = f"{pick.get('player_name')} {pick.get('stat')} vs {pick.get('opponent_code')}"
        opp_claims = [c for c in pick.get("claims") or [] if str(c.get("metric") or "").startswith("opp_zone_rank_")]
        if not opp_claims:
            continue
        # Claim subject is team:CODE; match the profile by opponent name in as_text.
        text0 = opp_claims[0].get("as_text") or ""
        prof = None
        for name, p in by_name.items():
            if name and name in text0.lower():
                prof = p
                break
        if prof is None:
            problems.append(f"{who}: could not match opponent in {text0!r}")
            continue
        for c in opp_claims:
            zone = str(c.get("metric")).removeprefix("opp_zone_rank_")
            dz = prof.zone(zone)
            if not dz or not dz.rank:
                problems.append(f"{who}: no chart rank for {zone}")
                continue
            if c.get("value") != dz.rank[0]:
                problems.append(f"{who} {zone}: pick {c.get('value')} vs chart {dz.rank[0]}")
    assert problems == []


HASH_RANK = re.compile(r"#\d+\s+of\s+\d+")
BOX_RANK_METRICS = {
    "opp_allowed_rank",
    "opp_allowed_season",
    "opp_three_pct_rank",
    "opp_oreb_rank",
    "opp_dreb_rank",
    "opp_oreb_allowed",
    "opp_dreb_allowed",
    "season_games",
    "season_slate",
}


def test_zone_claims_say_shot_chart_and_box_ranks_do_not(all_picks):
    """Court #N is a zone FG% rank. Box-score PTS/REB D must not use that #N phrasing."""
    if not all_picks:
        pytest.skip("no engine-picks cache")
    problems = []
    for pick in all_picks:
        who = f"{pick.get('player_name')} {pick.get('stat')}"
        for c in pick.get("claims") or []:
            metric = str(c.get("metric") or "")
            text = c.get("as_text") or ""
            if metric.startswith("opp_zone_rank_"):
                if "shot-chart" not in text.lower():
                    problems.append(f"{who} {metric}: missing shot-chart label in {text!r}")
            if metric.startswith("zone_share_") and "makes are from" not in text:
                problems.append(f"{who} {metric}: missing Makes % in {text!r}")
            if metric == "zone_matchup_edge" and (
                "scoring is from" in text or "of scoring" in text or "comes from their weak spots" in text
            ):
                problems.append(f"{who} {metric}: combined scoring % instead of Makes % in {text!r}")
            if metric in BOX_RANK_METRICS and HASH_RANK.search(text):
                problems.append(f"{who} {metric}: box-score rank looks like a court #N in {text!r}")
    assert problems == []


def test_line_picks_with_a_slate_include_hits_vs_d(all_picks):
    if not all_picks:
        pytest.skip("no engine-picks cache")
    problems = []
    checked = 0
    for pick in all_picks:
        if pick.get("line") is None:
            continue
        metrics = {str(c.get("metric") or "") for c in pick.get("claims") or []}
        if "season_games" not in metrics:
            continue
        games = next((c.get("as_text") or "" for c in pick.get("claims") or [] if c.get("metric") == "season_games"), "")
        if " D " not in games:
            continue
        checked += 1
        if "season_vs_d_hits" not in metrics:
            problems.append(f"{pick.get('player_name')} {pick.get('stat')}: missing season_vs_d_hits")
    if not checked:
        pytest.skip("no ranked slate picks")
    assert problems == []


def test_published_best_overs_are_modelable(all_picks):
    """1.04-style shorts are not the modelled best over."""
    if not all_picks:
        pytest.skip("no engine-picks cache")
    problems = []
    for pick in all_picks:
        ls = pick.get("line_summary") or {}
        price = ls.get("best_over_line_decimal")
        if price is not None and float(price) < 1.5 - 1e-9 and (ls.get("kind") or "") != "ou":
            problems.append(
                f"{pick.get('player_name')} {pick.get('stat')}: best over {ls.get('best_over_line')} at {price}"
            )
    assert problems == []
