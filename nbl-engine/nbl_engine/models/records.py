"""Engine records: claims (facts), inferences (rule outcomes), picks (output).

Every statement the engine makes downstream must trace to a ClaimRecord, and
every ClaimRecord traces to a stored dataset and its as_of timestamp.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Category = Literal[
    "form",
    "hit_rate",
    "matchup_allowed",
    "pace",
    "usage",
    "shot_profile",
    "rebounding",
    "minutes",
    "home_away",
    "h2h",
    "injury_impact",
    "line_movement",
    "context",  # odds / schedule facts that never vote
]

Direction = Literal["over", "under", "neutral"]
Status = Literal["confirmed", "not_confirmed", "cannot_determine"]
Tier = Literal["STRONG", "LEAN", "NO EDGE", "AVOID"]

ClaimFlag = Literal[
    "small_sample",
    "prior_season",
    "stale",
    "derived",
    "milestone_line",
]


class _Rec(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ClaimRecord(_Rec):
    """One verifiable fact computed from stored data."""

    id: str
    category: Category
    subject: str  # e.g. "player:<id>", "team:MEL", "game:<gameKey>"
    stat: str  # engine stat key (threeMade, points, ...) or "-" for non-stat facts
    metric: str  # e.g. "l5_mean", "season_hit_rate", "opp_allowed_rank"
    value: float | int | str | None
    unit: str = ""  # "per_game", "rate", "rank", "minutes", "days", "decimal"
    sample_n: int | None = None
    window: str = ""  # "season", "L5", "L10", "h2h", "home", "away", ...
    comparison: float | None = None  # the line the fact was measured against, if any
    source_dataset: str  # file / dir under data/ the value came from
    source_as_of: str  # ISO timestamp from the dataset (generatedAt / capturedAt)
    as_text: str  # the only sentence narrative may use for this claim
    flags: list[ClaimFlag] = Field(default_factory=list)


class InferenceRecord(_Rec):
    """Outcome of one registered rule over the claims."""

    rule_id: str
    category: Category
    direction: Direction
    status: Status
    weight: float
    claim_ids: list[str]
    reason: str  # built only from claim as_text fragments + the rule's fixed wording


class GateResult(_Rec):
    gate: str
    passed: bool
    detail: str


class VerifierResult(_Rec):
    passed: bool
    issues: list[str] = Field(default_factory=list)
    numbers_checked: int = 0


class BookLineSummary(_Rec):
    book: str
    kind: str
    line: float
    over_decimal: float | None = None
    under_decimal: float | None = None


class LineSummary(_Rec):
    consensus_line: float | None
    books: int
    best_over_decimal: float | None
    best_over_book: str | None
    best_under_decimal: float | None
    best_under_book: str | None
    kind: Literal["ou", "milestone", "none"]
    captured_at: str | None
    best_over_line: float | None = None
    best_over_line_book: str | None = None
    best_over_line_decimal: float | None = None
    best_under_line: float | None = None
    best_under_line_book: str | None = None
    best_under_line_decimal: float | None = None
    best_over_books: list[str] = Field(default_factory=list)
    best_under_books: list[str] = Field(default_factory=list)
    book_lines: list[BookLineSummary] = Field(default_factory=list)


class PickRecord(_Rec):
    engine_version: str
    run_date: str
    game_key: str
    game_label: str  # "AWY@HOM"
    tipoff_utc: str
    player_id: str
    player_name: str
    team_code: str
    opponent_code: str
    is_home: bool
    stat: str
    stat_label: str
    line: float | None
    side: Direction
    tier: Tier
    score_over: float
    score_under: float
    confirmed_categories: list[str]
    gates: list[GateResult]
    line_summary: LineSummary
    claims: list[ClaimRecord]
    inferences: list[InferenceRecord]
    narrative: str
    verifier: VerifierResult
    evidence_sha256: str
    data_as_of: dict[str, str]
    skips: list[dict] = Field(default_factory=list)


class GradedPick(_Rec):
    game_key: str
    player_id: str
    player_name: str
    stat: str
    line: float | None
    side: Direction
    tier: Tier
    actual: float | None
    result: Literal["WIN", "LOSS", "PUSH", "NO_RESULT", "NO_PICK"]
    source_match_id: str | None
