from __future__ import annotations

from nbl_engine.ingest.names import norm_player_key
from nbl_engine.ingest.teams import TeamRegistry
from nbl_engine.models.raw import ScheduleGame
from nbl_engine.models.records import ClaimRecord, InferenceRecord
from nbl_engine.narrative.template import build_narrative
from nbl_engine.narrative.verifier import numeric_tokens, verify
from nbl_engine.output.serialize import canonical_json, sha256_of


def claim(id_: str, text: str, category="form", metric="season_mean", value=2.3) -> ClaimRecord:
    return ClaimRecord(id=id_, category=category, subject="player:x", stat="threeMade", metric=metric, value=value, sample_n=3, source_dataset="t", source_as_of="2026-10-01T00:00:00Z", as_text=text)


def test_numeric_tokens():
    assert numeric_tokens("over 2.5 in 2 of 3 (67%) at -9.5, +1.0") == ["2.5", "2", "3", "67%", "-9.5", "+1.0"]
    assert numeric_tokens("Q3 rank") == []  # digits glued to letters are not numbers


def test_verifier_flags_untraceable_numbers():
    claims = [claim("c1", "Season 3PM average 2.3 over 3 game(s).")]
    infs = [InferenceRecord(rule_id="r", category="form", direction="over", status="confirmed", weight=1.0, claim_ids=["c1"], reason="Season 3PM average 2.3 over 3 game(s).")]
    ok = verify("Season 3PM average 2.3 over 3 game(s). Verdict: LEAN OVER 1.5 3PM.", claims, infs, "LEAN", "over", 1.5)
    assert ok.passed, ok.issues
    bad = verify("He averages 2.4 threes.", claims, infs, "LEAN", "over", 1.5)
    assert not bad.passed and "2.4" in bad.issues[0]
    missing = verify("x", claims, [InferenceRecord(rule_id="r", category="form", direction="over", status="confirmed", weight=1.0, claim_ids=["zz"], reason="")], "NO EDGE", "neutral", None)
    assert any("missing claim" in i for i in missing.issues)


def test_template_narrative_verifies():
    claims = [
        claim("c1", "Consensus 3PM over/under line 2.5 across 4 book(s).", "context", "line_consensus", 2.5),
        claim("c2", "This season: over 2.5 3PM in 3 of 4 game(s) (75%).", "hit_rate", "season_hit_rate", 0.75),
        claim("c3", "Best over price 1.91 at BookA.", "context", "best_over_price", 1.91),
    ]
    infs = [InferenceRecord(rule_id="hit_rate_vs_line", category="hit_rate", direction="over", status="confirmed", weight=1.5, claim_ids=["c2"], reason=claims[1].as_text)]
    text = build_narrative("Test Player", "3PM", 2.5, "LEAN", "over", claims, infs, [])
    assert "Verdict: LEAN OVER 2.5 3PM" in text
    assert verify(text, claims, infs, "LEAN", "over", 2.5).passed


def test_canonical_json_is_deterministic():
    a = {"b": [1.23456789, {"z": 1, "a": 2}], "a": "x"}
    b = {"a": "x", "b": [1.2345678901, {"a": 2, "z": 1}]}
    assert canonical_json(a) == canonical_json(b)
    assert sha256_of(a) == sha256_of(b)
    assert canonical_json(a).endswith("\n")


def _sched(home_code, home, away_code, away) -> ScheduleGame:
    return ScheduleGame(id=f"{home_code}{away_code}", startTime="2026-10-03T09:30:00.000Z", homeTeam=home, homeTeamCode=home_code, awayTeam=away, awayTeamCode=away_code)


def test_team_registry_resolution_without_hardcoding():
    reg = TeamRegistry.from_schedule([
        _sched("MEL", "Melbourne United", "NZL", "New Zealand Breakers"),
        _sched("SEM", "South East Melbourne Phoenix", "ADL", "Adelaide 36ers"),
    ])
    assert reg.resolve("NZ Breakers") == "NZL"  # nickname fallback
    assert reg.resolve("new zealand breakers") == "NZL"
    assert reg.resolve("MEL") == "MEL"
    assert reg.resolve("South East Melbourne") == "SEM"  # token subset
    assert reg.resolve("Melbourne") is None  # ambiguous between two Melbourne clubs
    reg.learn_alias("Sixers", "ADL")
    assert reg.resolve("Sixers") == "ADL"


def test_player_key_normalisation():
    assert norm_player_key("Rob Baker II") == "rob baker"
    assert norm_player_key("Jo Lual-Acuil Jr") == "jo lual acuil"
    assert norm_player_key("Šhea Ili") == "shea ili"
