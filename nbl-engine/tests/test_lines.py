from __future__ import annotations

import pytest

from nbl_engine.features.lines import consensus_line, market_view, movement, replay_history
from nbl_engine.models.raw import PropHistoryCapture, PropHistoryFile, PropHistoryLine, SnapLine


def ou(book: str, line: float, over: float | None, under: float | None, player="A B", stat="threeMade") -> SnapLine:
    return SnapLine(player=player, playerKey=player.lower(), book=book, stat=stat, kind="ou", line=line, label=str(line), over="-110", under="-110", overDecimal=over, underDecimal=under)


def ms(book: str, line: float, over: float, player="A B", stat="threeMade") -> SnapLine:
    return SnapLine(player=player, playerKey=player.lower(), book=book, stat=stat, kind="milestone", line=line, label=f"{int(line + 0.5)}+", over="-110", under="N/A", overDecimal=over, underDecimal=None)


def test_consensus_is_an_actual_line():
    assert consensus_line([0.5, 1.5]) == 0.5  # tie -> toward median then lower
    assert consensus_line([1.5, 1.5, 2.5]) == 1.5
    assert consensus_line([2.5, 1.5, 2.5, 3.5]) == 2.5


def test_best_over_and_under_line_across_books():
    """When O/Us differ, best over is the lowest number; best under is the highest."""
    lines = [
        ou("Sportsbet", 18.5, 1.90, 1.87),
        ou("TAB", 19.5, 1.87, 1.91),
        ou("Unibet", 18.5, 1.88, 1.88),
        ms("Dabble", 4.5, 1.33),
    ]
    mv = market_view(lines)
    assert mv.kind == "ou" and mv.consensus_line == 18.5
    assert mv.best_over_line == ("Sportsbet", 18.5, 1.90)
    assert mv.best_under_line == ("TAB", 19.5, 1.91)
    assert mv.best_over == ("Sportsbet", 1.90)
    assert mv.best_over[0] == mv.best_over_line[0]
    assert mv.best_under[0] == mv.best_under_line[0]
    assert {b.book for b in mv.ou_book_lines} == {"Sportsbet", "TAB", "Unibet"}
    assert mv.milestone_book_lines[0].book == "Dabble"


def test_tied_over_books_are_one_quote():
    """Same 4.5 @ 2.35 at two books is one quote — never two book names for the same number."""
    lines = [ou("Betcity", 4.5, 2.35, 1.54), ou("Unibet", 4.5, 2.35, 1.54)]
    mv = market_view(lines)
    assert mv.best_over_quote is not None
    assert mv.best_over_quote.line == 4.5 and mv.best_over_quote.price == 2.35
    assert mv.best_over_quote.books == ("Betcity", "Unibet")
    assert mv.best_over == (mv.best_over_line[0], mv.best_over_line[2])
    assert mv.best_over[0] == mv.best_over_line[0] == "Betcity"


def test_market_view_prefers_two_way_and_best_prices():
    lines = [ou("B1", 2.5, 1.85, 1.95), ou("B2", 2.5, 1.90, 1.90), ou("B3", 3.5, 1.80, 2.00), ms("B4", 2.5, 1.70)]
    mv = market_view(lines)
    assert mv.kind == "ou" and mv.consensus_line == 2.5 and mv.books == 3
    assert mv.best_over == ("B2", 1.90)
    assert mv.best_under == ("B3", 2.00)
    assert mv.best_over_line == ("B2", 2.5, 1.90)
    assert mv.best_under_line == ("B3", 3.5, 2.00)
    assert mv.best_over[0] == mv.best_over_line[0]
    assert mv.best_under[0] == mv.best_under_line[0]


def test_short_milestone_is_not_the_best_over():
    """1.04 on 4.5 is not a modelled bet. Quote the real number (closest to even / consensus)."""
    lines = [ms("Palmerbet", 4.5, 1.04), ms("Sportsbet", 9.5, 1.80), ms("TAB", 9.5, 1.85)]
    mv = market_view(lines)
    assert mv.kind == "milestone" and mv.consensus_line == 9.5
    assert mv.best_over_quote is not None
    assert mv.best_over_quote.line == 9.5
    assert mv.best_over_quote.price == 1.85
    assert 1.04 not in {mv.best_over_quote.price}


def test_unmodelable_shorts_yield_no_best_over():
    lines = [ms("Palmerbet", 4.5, 1.04), ms("Sportsbet", 4.5, 1.10)]
    mv = market_view(lines)
    assert mv.consensus_line == 4.5
    assert mv.best_over_quote is None


def test_market_view_milestone_fallback_picks_closest_to_even():
    lines = [ms("B1", 1.5, 1.30), ms("B1", 2.5, 1.95), ms("B1", 3.5, 3.40), ms("B2", 2.5, 1.80)]
    mv = market_view(lines)
    assert mv.kind == "milestone" and mv.consensus_line == 2.5
    assert mv.best_over == ("B1", 1.95)
    assert mv.best_over_quote is not None and mv.best_over_quote.books == ("B1",)


def test_book_main_line_is_most_even():
    lines = [ou("B1", 1.5, 1.40, 2.80), ou("B1", 2.5, 1.88, 1.92), ou("B1", 3.5, 2.90, 1.38)]
    mv = market_view(lines)
    assert mv.consensus_line == 2.5


def _hist() -> PropHistoryFile:
    l = lambda book, line, o, u: PropHistoryLine(book=book, player="A B", playerKey="a b", stat="threeMade", kind="ou", line=line, overDecimal=o, underDecimal=u)  # noqa: E731
    return PropHistoryFile(
        format=1,
        gameKey="g",
        homeTeam="H",
        awayTeam="A",
        commenceTime="2026-10-03T09:30:00.000Z",
        mode="delta",
        firstCapturedAt="t0",
        lastCapturedAt="t2",
        captures=[
            PropHistoryCapture(capturedAt="t0", boardSize=2, upserts=[l("B1", 1.5, 1.9, 1.9), l("B2", 1.5, 1.85, 1.95)], removed=[]),
            PropHistoryCapture(capturedAt="t1", boardSize=2, upserts=[l("B1", 2.5, 1.9, 1.9)], removed=["B1|a b|threeMade|ou|1.5"]),
            PropHistoryCapture(capturedAt="t2", boardSize=2, upserts=[l("B2", 2.5, 1.9, 1.9)], removed=["B2|a b|threeMade|ou|1.5"]),
        ],
    )


def test_replay_and_movement():
    h = _hist()
    state = replay_history(h, 0)
    assert len(state) == 2
    final = replay_history(h, 2)
    assert sorted(l.line for l in final.values()) == [2.5, 2.5]
    mv = movement(h, "a b", "threeMade")
    assert mv is not None and mv.first_line == 1.5 and mv.last_line == 2.5
    assert mv.line_delta == pytest.approx(1.0)
    assert movement(h, "nobody", "threeMade") is None


def test_movement_opens_at_first_two_way_capture():
    """Milestones post first; the O/U appears later. Open = first O/U capture."""
    ms_line = PropHistoryLine(book="B1", player="A B", playerKey="a b", stat="threeMade", kind="milestone", line=1.5, overDecimal=1.7, underDecimal=None)
    ou1 = PropHistoryLine(book="B1", player="A B", playerKey="a b", stat="threeMade", kind="ou", line=2.5, overDecimal=1.9, underDecimal=1.9)
    ou2 = PropHistoryLine(book="B1", player="A B", playerKey="a b", stat="threeMade", kind="ou", line=3.5, overDecimal=1.9, underDecimal=1.9)
    h = PropHistoryFile(
        format=1, gameKey="g", homeTeam="H", awayTeam="A", commenceTime="2026-10-03T09:30:00.000Z", mode="delta",
        firstCapturedAt="t0", lastCapturedAt="t2",
        captures=[
            PropHistoryCapture(capturedAt="t0", boardSize=1, upserts=[ms_line], removed=[]),
            PropHistoryCapture(capturedAt="t1", boardSize=2, upserts=[ou1], removed=[]),
            PropHistoryCapture(capturedAt="t2", boardSize=2, upserts=[ou2], removed=["B1|a b|threeMade|ou|2.5"]),
        ],
    )
    mv = movement(h, "a b", "threeMade")
    assert mv is not None
    assert (mv.first_kind, mv.last_kind) == ("ou", "ou")
    assert (mv.first_at, mv.captures) == ("t1", 2)
    assert mv.line_delta == pytest.approx(1.0)
