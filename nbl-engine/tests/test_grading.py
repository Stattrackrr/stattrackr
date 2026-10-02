from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from nbl_engine.config import load_thresholds
from nbl_engine.models.raw import PlayerLogFile
from nbl_engine.models.records import GateResult, LineSummary, PickRecord, VerifierResult
from nbl_engine.output.grading import grade_all, grade_pick
from tests.conftest import make_row


def _pick(side: str, tier: str, line: float | None = 2.5) -> PickRecord:
    return PickRecord(
        engine_version="t",
        run_date="2026-10-03",
        game_key="g",
        game_label="CNS@MEL",
        tipoff_utc="2026-10-03T09:30:00.000Z",
        player_id="p1",
        player_name="Test",
        team_code="MEL",
        opponent_code="CNS",
        is_home=True,
        stat="threeMade",
        stat_label="3PM",
        line=line,
        side=side,
        tier=tier,
        score_over=1.0,
        score_under=0.0,
        confirmed_categories=[],
        gates=[GateResult(gate="x", passed=True, detail="")],
        line_summary=LineSummary(consensus_line=line, books=1, best_over_decimal=None, best_over_book=None, best_under_decimal=None, best_under_book=None, kind="ou", captured_at=None),
        claims=[],
        inferences=[],
        narrative="",
        verifier=VerifierResult(passed=True),
        evidence_sha256="0" * 64,
        data_as_of={},
    )


def _store(three_made: float | None):
    cfg = load_thresholds()
    row = make_row("m9", "2026-10-03T09:30:00", team="MEL", opp="CNS", three_made=three_made if three_made is not None else 0)
    if three_made is None:
        row = row.model_copy(update={"threeMade": None})
    log = PlayerLogFile(playerId="p1", name="Test", team="Melbourne United", teamCode="MEL", year=2026, games=[row])
    return SimpleNamespace(cfg=cfg, player_logs={("p1", 2026): log}, run_time=datetime.now(timezone.utc))


def test_grade_win_loss_push_and_no_result():
    assert grade_pick(_pick("over", "LEAN"), _store(3)).result == "WIN"
    assert grade_pick(_pick("over", "LEAN"), _store(1)).result == "LOSS"
    assert grade_pick(_pick("under", "STRONG"), _store(1)).result == "WIN"
    assert grade_pick(_pick("over", "LEAN", 2.0), _store(2)).result == "PUSH"
    assert grade_pick(_pick("over", "NO EDGE"), _store(3)).result == "NO_PICK"
    assert grade_pick(_pick("over", "LEAN"), _store(None)).result == "NO_RESULT"
    empty = SimpleNamespace(cfg=load_thresholds(), player_logs={}, run_time=datetime.now(timezone.utc))
    assert grade_pick(_pick("over", "LEAN"), empty).result == "NO_RESULT"


def test_grade_all_tally():
    out = grade_all([_pick("over", "LEAN"), _pick("under", "LEAN"), _pick("over", "NO EDGE")], _store(3))
    assert out["tally"] == {"LOSS": 1, "NO_PICK": 1, "WIN": 1}
