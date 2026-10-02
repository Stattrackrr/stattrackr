"""Stored-odds features: current lines per book, consensus, and movement from history.

Odds are context only. Nothing here converts prices to probabilities.
"""

from __future__ import annotations

from dataclasses import dataclass
from statistics import median

from nbl_engine.models.raw import PropHistoryFile, PropHistoryLine, SnapLine

EVEN_MONEY_DECIMAL = 1.90  # reference for choosing the most balanced of several lines
MIN_MODEL_DECIMAL = 1.50  # 1.04-style shorts are not a modelled bet unless the user names that line


@dataclass(frozen=True)
class BookLine:
    book: str
    line: float
    kind: str  # "ou" | "milestone"
    over_decimal: float | None
    under_decimal: float | None


def _main_line_for_book(lines: list[SnapLine | PropHistoryLine]) -> BookLine | None:
    """The book's primary O/U: two-way priced line with the most even prices."""
    two_way = [l for l in lines if l.kind == "ou" and l.overDecimal and l.underDecimal]
    pool = two_way or [l for l in lines if l.kind == "ou" and (l.overDecimal or l.underDecimal)]
    if not pool:
        return None
    pool.sort(key=lambda l: (abs((l.overDecimal or 0) - (l.underDecimal or 0)) if l.overDecimal and l.underDecimal else 9.0, l.line))
    best = pool[0]
    return BookLine(best.book, best.line, "ou", best.overDecimal, best.underDecimal)


def _main_milestone_for_book(lines: list[SnapLine | PropHistoryLine]) -> BookLine | None:
    """When a book only posts milestones, the one priced closest to even money."""
    ms = [l for l in lines if l.kind == "milestone" and l.overDecimal]
    if not ms:
        return None
    ms.sort(key=lambda l: (abs(float(l.overDecimal or 0) - EVEN_MONEY_DECIMAL), l.line))
    best = ms[0]
    return BookLine(best.book, best.line, "milestone", best.overDecimal, None)


@dataclass(frozen=True)
class BestQuote:
    """One side of the board: the easiest line, the best price there, every book tied."""

    line: float
    price: float
    books: tuple[str, ...]

    @property
    def book(self) -> str:
        return self.books[0]


def _model_price(price: float | None) -> bool:
    return price is not None and float(price) + 1e-9 >= MIN_MODEL_DECIMAL


def _best_over_quote(pool: list[BookLine]) -> BestQuote | None:
    opts = [
        (m.book, m.line, m.over_decimal)
        for m in pool
        if m.over_decimal and (m.kind == "ou" or _model_price(m.over_decimal))
    ]
    if not opts:
        return None
    best_line = min(t[1] for t in opts)
    at_line = [t for t in opts if abs(t[1] - best_line) < 1e-9]
    best_price = max(t[2] for t in at_line)
    books = tuple(sorted(t[0] for t in at_line if abs(t[2] - best_price) < 1e-9))
    return BestQuote(best_line, best_price, books)


def _best_under_quote(pool: list[BookLine]) -> BestQuote | None:
    opts = [
        (m.book, m.line, m.under_decimal)
        for m in pool
        if m.under_decimal and (m.kind == "ou" or _model_price(m.under_decimal))
    ]
    if not opts:
        return None
    best_line = max(t[1] for t in opts)
    at_line = [t for t in opts if abs(t[1] - best_line) < 1e-9]
    best_price = max(t[2] for t in at_line)
    books = tuple(sorted(t[0] for t in at_line if abs(t[2] - best_price) < 1e-9))
    return BestQuote(best_line, best_price, books)


@dataclass(frozen=True)
class MarketView:
    kind: str  # "ou" | "milestone" | "none"
    consensus_line: float | None
    book_lines: tuple[BookLine, ...]
    best_over: tuple[str, float] | None  # (first book, price) — same quote as best_over_line
    best_under: tuple[str, float] | None
    best_over_line: tuple[str, float, float] | None = None  # (first book, line, price)
    best_under_line: tuple[str, float, float] | None = None
    ou_book_lines: tuple[BookLine, ...] = ()
    milestone_book_lines: tuple[BookLine, ...] = ()
    best_over_quote: BestQuote | None = None
    best_under_quote: BestQuote | None = None

    @property
    def books(self) -> int:
        return len(self.book_lines)


def consensus_line(lines: list[float]) -> float:
    """The most common posted line; ties resolved toward the median, then lower."""
    counts: dict[float, int] = {}
    for l in lines:
        counts[l] = counts.get(l, 0) + 1
    med = float(median(lines))
    return sorted(counts, key=lambda l: (-counts[l], abs(l - med), l))[0]


def market_view(lines: list[SnapLine | PropHistoryLine]) -> MarketView:
    by_book: dict[str, list[SnapLine | PropHistoryLine]] = {}
    for l in lines:
        by_book.setdefault(l.book, []).append(l)
    ou_mains = [m for m in (_main_line_for_book(v) for v in by_book.values()) if m]
    ms_mains = [m for m in (_main_milestone_for_book(v) for v in by_book.values()) if m]
    ou_mains.sort(key=lambda b: b.book)
    ms_mains.sort(key=lambda b: b.book)
    kind = "ou"
    mains = ou_mains
    if not mains:
        mains = ms_mains
        kind = "milestone" if mains else "none"
    if not mains:
        return MarketView("none", None, (), None, None)
    consensus = consensus_line([m.line for m in mains])
    line_pool = ou_mains or ms_mains
    if not ou_mains and ms_mains:
        # Milestone-only: quote the consensus number, not the cheapest 1.04 gimme.
        at_cons = [m for m in ms_mains if abs(m.line - consensus) < 1e-9]
        line_pool = at_cons or ms_mains
    over_q = _best_over_quote(line_pool)
    under_q = _best_under_quote(ou_mains)
    return MarketView(
        kind,
        consensus,
        tuple(mains),
        (over_q.book, over_q.price) if over_q else None,
        (under_q.book, under_q.price) if under_q else None,
        best_over_line=(over_q.book, over_q.line, over_q.price) if over_q else None,
        best_under_line=(under_q.book, under_q.line, under_q.price) if under_q else None,
        ou_book_lines=tuple(ou_mains),
        milestone_book_lines=tuple(ms_mains),
        best_over_quote=over_q,
        best_under_quote=under_q,
    )


def select_lines(lines: list[SnapLine], player_key: str, stat: str) -> list[SnapLine]:
    return [l for l in lines if l.playerKey == player_key and l.stat == stat]


# ---------------------------------------------------------------- history

def replay_history(hist: PropHistoryFile, upto_index: int) -> dict[str, PropHistoryLine]:
    """Board state after applying captures[0..upto_index]."""
    state: dict[str, PropHistoryLine] = {}
    for cap in hist.captures[: upto_index + 1]:
        for l in cap.upserts:
            state[f"{l.book}|{l.playerKey}|{l.stat}|{l.kind}|{l.line}"] = l
        for key in cap.removed:
            state.pop(key, None)
    return state


@dataclass(frozen=True)
class Movement:
    captures: int
    first_at: str
    last_at: str
    first_line: float | None
    last_line: float | None
    first_kind: str
    last_kind: str

    @property
    def line_delta(self) -> float | None:
        if self.first_line is None or self.last_line is None or self.first_kind != self.last_kind:
            return None
        return self.last_line - self.first_line


def movement(hist: PropHistoryFile, player_key: str, stat: str) -> Movement | None:
    """Open vs current for one player/stat.

    Books post milestones first and the two-way O/U a few hours before tip, so
    the "open" is the first capture whose market kind matches the current kind
    (first O/U capture when an O/U exists now). Captures counted are those
    from that open onwards.
    """
    if not hist.captures:
        return None
    n = len(hist.captures)
    views: list[MarketView] = []
    state: dict[str, PropHistoryLine] = {}
    for cap in hist.captures:
        for l in cap.upserts:
            state[f"{l.book}|{l.playerKey}|{l.stat}|{l.kind}|{l.line}"] = l
        for key in cap.removed:
            state.pop(key, None)
        views.append(market_view([l for l in state.values() if l.playerKey == player_key and l.stat == stat]))
    last = views[-1]
    if last.kind == "none":
        return None
    open_idx = next(i for i, v in enumerate(views) if v.kind == last.kind)
    first = views[open_idx]
    return Movement(
        captures=n - open_idx,
        first_at=hist.captures[open_idx].capturedAt,
        last_at=hist.captures[-1].capturedAt,
        first_line=first.consensus_line,
        last_line=last.consensus_line,
        first_kind=first.kind,
        last_kind=last.kind,
    )
