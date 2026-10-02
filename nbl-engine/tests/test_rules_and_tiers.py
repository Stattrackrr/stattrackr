from __future__ import annotations

from datetime import datetime, timezone

from nbl_engine.models.records import ClaimRecord, InferenceRecord
from nbl_engine.reasoning.rules import registered_rules, run_rules
from nbl_engine.scoring.tiers import GateInputs, run_gates, score

NOW = datetime(2026, 10, 3, 0, 0, tzinfo=timezone.utc)


def claim(id_: str, category: str, metric: str, value, n: int | None = 3, text: str | None = None, **kw) -> ClaimRecord:
    return ClaimRecord(
        id=id_,
        category=category,
        subject="player:x",
        stat="threeMade",
        metric=metric,
        value=value,
        sample_n=n,
        source_dataset="test",
        source_as_of="2026-10-01T00:00:00Z",
        as_text=text or f"{metric} {value}",
        **kw,
    )


def test_one_rule_per_category():
    cats = [c for _, c, _ in registered_rules()]
    assert len(cats) == len(set(cats)) == 12


def test_rules_fail_closed_without_claims(cfg):
    out = run_rules([], cfg, "threeMade")
    assert all(i.status == "cannot_determine" and i.weight == 0.0 for i in out)


def test_form_rule_needs_split_and_delta(cfg):
    same = [claim("c1", "form", "season_mean", 2.0, 3), claim("c2", "form", "l5_mean", 3.0, 3)]
    inf = {i.rule_id: i for i in run_rules(same, cfg, "threeMade")}["form_l5_vs_season"]
    assert inf.status == "cannot_determine"  # L5 == season
    split = [claim("c1", "form", "season_mean", 2.0, 8), claim("c2", "form", "l5_mean", 3.0, 5)]
    inf = {i.rule_id: i for i in run_rules(split, cfg, "threeMade")}["form_l5_vs_season"]
    assert inf.status == "confirmed" and inf.direction == "over" and inf.weight == cfg.weights.form


def test_hit_rate_rule_bands(cfg):
    for rate, expect in ((0.8, ("confirmed", "over")), (0.65, ("confirmed", "over")), (0.5, ("not_confirmed", "neutral")), (0.2, ("confirmed", "under"))):
        inf = {i.rule_id: i for i in run_rules([claim("c1", "hit_rate", "season_hit_rate", rate, 5, comparison=2.5)], cfg, "threeMade")}["hit_rate_vs_line"]
        assert (inf.status, inf.direction) == expect, rate
    small = {i.rule_id: i for i in run_rules([claim("c1", "hit_rate", "season_hit_rate", 0.9, 2)], cfg, "threeMade")}["hit_rate_vs_line"]
    assert small.status == "cannot_determine"


def test_injury_rule_pairs_with_without(cfg):
    claims = [
        claim("c1", "context", "teammate_out", "Out", None, text="Teammate X is Out."),
        claim("c2", "injury_impact", "ww_with_abc", 1.0, 3, text="3PM with X on court: 1.0 over 3 game(s)."),
        claim("c3", "injury_impact", "ww_without_abc", 3.0, 2, text="3PM without X: 3.0 over 2 game(s)."),
    ]
    inf = {i.rule_id: i for i in run_rules(claims, cfg, "threeMade")}["teammate_out_split"]
    assert inf.status == "confirmed" and inf.direction == "over"
    assert set(inf.claim_ids) == {"c1", "c2", "c3"}


def _gates(**over) -> list:
    base = dict(games_current=4, minutes_season_mean=25.0, line_present=True, market_kind="ou", market_captured_at="2026-10-02T22:00:00Z", stats_fresh=True, stats_age_hours=10.0, self_injury_status=None, run_time=NOW)
    base.update(over)
    return GateInputs(**base)


def inf(cat: str, direction: str, weight: float, status: str = "confirmed") -> InferenceRecord:
    return InferenceRecord(rule_id=f"r_{cat}", category=cat, direction=direction if status == "confirmed" else "neutral", status=status, weight=weight if status == "confirmed" else 0.0, claim_ids=["c1"], reason="r")


def test_gates_and_tiers(cfg):
    g = _gates()
    gates = run_gates(g, cfg)
    assert all(x.passed for x in gates)
    strong = [inf("hit_rate", "over", 1.5), inf("matchup_allowed", "over", 1.0), inf("form", "over", 1.0)]
    r = score(strong, [], gates, cfg, g)
    assert (r.tier, r.side) == ("STRONG", "over") and r.confirmed_categories == ["form", "hit_rate", "matchup_allowed"]
    lean = [inf("hit_rate", "over", 1.5), inf("pace", "over", 0.5)]
    assert score(lean, [], gates, cfg, g).tier == "LEAN"
    weak = [inf("pace", "over", 0.5)]
    assert score(weak, [], gates, cfg, g).tier == "NO EDGE"


def test_conflict_and_red_flags_avoid(cfg):
    g = _gates()
    gates = run_gates(g, cfg)
    conflict = [inf("hit_rate", "over", 1.5), inf("matchup_allowed", "under", 1.0)]
    assert score(conflict, [], gates, cfg, g).tier == "AVOID"
    minutes_down = [inf("hit_rate", "over", 1.5), inf("form", "over", 1.0), inf("matchup_allowed", "over", 1.0), inf("minutes", "under", 0.75)]
    assert score(minutes_down, [], gates, cfg, g).tier == "AVOID"
    doubtful = _gates(self_injury_status="Day-to-Day")
    assert score([inf("hit_rate", "over", 1.5), inf("form", "over", 1.0)], [], run_gates(doubtful, cfg), cfg, doubtful).tier == "AVOID"


def test_gate_failures_fail_closed(cfg):
    out_player = _gates(self_injury_status="Out")
    assert score([inf("hit_rate", "over", 1.5), inf("form", "over", 1.0)], [], run_gates(out_player, cfg), cfg, out_player).tier == "AVOID"
    few_games = _gates(games_current=2)
    r = score([inf("hit_rate", "over", 1.5), inf("form", "over", 1.0)], [], run_gates(few_games, cfg), cfg, few_games)
    assert (r.tier, r.side) == ("NO EDGE", "neutral")
    stale_odds = _gates(market_captured_at="2026-09-20T00:00:00Z")
    assert score([inf("hit_rate", "over", 1.5), inf("form", "over", 1.0)], [], run_gates(stale_odds, cfg), cfg, stale_odds).tier == "NO EDGE"


def test_milestone_market_cannot_produce_under(cfg):
    g = _gates(market_kind="milestone")
    gates = run_gates(g, cfg)
    r = score([inf("hit_rate", "under", 1.5), inf("matchup_allowed", "under", 1.0), inf("form", "under", 1.0)], [], gates, cfg, g)
    assert (r.tier, r.side) == ("NO EDGE", "under")
