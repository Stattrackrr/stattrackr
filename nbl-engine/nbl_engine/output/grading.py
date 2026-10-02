"""Grade stored picks against the player logs once the game has been played."""

from __future__ import annotations

from nbl_engine.features.stats import STATS, stat_value
from nbl_engine.ingest.loaders import DataStore
from nbl_engine.ingest.timeutil import local_date, parse_iso
from nbl_engine.models.records import GradedPick, PickRecord


def grade_pick(pick: PickRecord, store: DataStore) -> GradedPick:
    sd = STATS.get(pick.stat)
    year = store.cfg.seasons.current_year
    log = store.player_logs.get((pick.player_id, year))
    base = dict(
        game_key=pick.game_key,
        player_id=pick.player_id,
        player_name=pick.player_name,
        stat=pick.stat,
        line=pick.line,
        side=pick.side,
        tier=pick.tier,
    )
    if pick.tier not in ("STRONG", "LEAN") or pick.line is None or pick.side == "neutral":
        return GradedPick(**base, actual=None, result="NO_PICK", source_match_id=None)
    if not sd or not log:
        return GradedPick(**base, actual=None, result="NO_RESULT", source_match_id=None)
    tip_day = local_date(pick.tipoff_utc)
    row = None
    for g in log.games:
        if local_date(g.date) == tip_day and g.opponentCode.upper() == pick.opponent_code.upper():
            row = g
            break
    if row is None:
        return GradedPick(**base, actual=None, result="NO_RESULT", source_match_id=None)
    actual = stat_value(row, sd)
    if actual is None:
        return GradedPick(**base, actual=None, result="NO_RESULT", source_match_id=row.matchId)
    if actual == pick.line:
        result = "PUSH"
    elif (actual > pick.line) == (pick.side == "over"):
        result = "WIN"
    else:
        result = "LOSS"
    return GradedPick(**base, actual=actual, result=result, source_match_id=row.matchId)


def grade_all(picks: list[PickRecord], store: DataStore) -> dict:
    graded = [grade_pick(p, store) for p in picks]
    tally: dict[str, int] = {}
    for g in graded:
        tally[g.result] = tally.get(g.result, 0) + 1
    return {"graded": graded, "tally": dict(sorted(tally.items()))}


__all__ = ["grade_pick", "grade_all", "parse_iso"]
