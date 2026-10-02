"""Template narrative in an analyst's voice.

Every sentence is either a claim's ``as_text`` verbatim, an inference's
``reason`` (itself composed of claim text), or fixed connective wording that
contains no numbers. The verifier checks that property afterwards.
"""

from __future__ import annotations

from nbl_engine.evidence.fmt import line_text
from nbl_engine.models.records import ClaimRecord, GateResult, InferenceRecord, Tier

CATEGORY_ORDER = (
    "hit_rate",
    "form",
    "minutes",
    "usage",
    "matchup_allowed",
    "shot_profile",
    "rebounding",
    "pace",
    "home_away",
    "h2h",
    "injury_impact",
    "line_movement",
)

CATEGORY_LABEL = {
    "hit_rate": "Hit rate",
    "form": "Form",
    "minutes": "Minutes",
    "usage": "Usage",
    "matchup_allowed": "Matchup",
    "shot_profile": "Shot profile",
    "rebounding": "Rebounding",
    "pace": "Pace",
    "home_away": "Venue",
    "h2h": "Head-to-head",
    "injury_impact": "Injuries",
    "line_movement": "Line movement",
}


def _claim_text(claims: list[ClaimRecord], metric: str) -> str | None:
    for c in claims:
        if c.metric == metric:
            return c.as_text
    return None


def _flag_note(claims: list[ClaimRecord]) -> str:
    small = any("small_sample" in c.flags for c in claims if c.category != "context")
    prior = any("prior_season" in c.flags for c in claims)
    notes = []
    if small:
        notes.append("Sample sizes are small this early in the season; treat every read as provisional.")
    if prior:
        notes.append("Head-to-head context includes prior-season games, which are shown for context and never counted as current form.")
    return " ".join(notes)


def build_narrative(
    player_name: str,
    stat_label: str,
    line: float | None,
    tier: Tier,
    side: str,
    claims: list[ClaimRecord],
    inferences: list[InferenceRecord],
    gates: list[GateResult],
) -> str:
    parts: list[str] = []
    market = _claim_text(claims, "line_consensus")
    if market:
        parts.append(market)

    failed = [g for g in gates if not g.passed]
    if failed:
        parts.append("Verdict: " + ("AVOID" if tier == "AVOID" else "NO EDGE") + f" on {player_name} {stat_label}.")
        parts.append("Hard gate not met: " + "; ".join(f"{g.gate} ({g.detail})" for g in failed) + ".")
        status = _claim_text(claims, "self_injury_status")
        if status:
            parts.append(status)
        note = _flag_note(claims)
        if note:
            parts.append(note)
        return " ".join(parts)

    by_cat = {i.category: i for i in inferences}
    supporting = [by_cat[c] for c in CATEGORY_ORDER if c in by_cat and by_cat[c].status == "confirmed" and by_cat[c].direction == side]
    opposing = [by_cat[c] for c in CATEGORY_ORDER if c in by_cat and by_cat[c].status == "confirmed" and by_cat[c].direction not in (side, "neutral")]
    unknown = [by_cat[c] for c in CATEGORY_ORDER if c in by_cat and by_cat[c].status == "cannot_determine"]
    flat = [by_cat[c] for c in CATEGORY_ORDER if c in by_cat and by_cat[c].status == "not_confirmed"]

    if tier in ("STRONG", "LEAN"):
        parts.append(f"Verdict: {tier} {side.upper()} {line_text(line)} {stat_label} for {player_name}.")
    elif tier == "AVOID":
        parts.append(f"Verdict: AVOID {player_name} {stat_label}; the evidence conflicts or a red flag is present.")
    else:
        parts.append(f"Verdict: NO EDGE on {player_name} {stat_label}.")

    if supporting:
        parts.append("What supports it:")
        for inf in supporting:
            parts.append(f"{CATEGORY_LABEL[inf.category]}: {inf.reason}")
    if opposing:
        parts.append("What pushes back:")
        for inf in opposing:
            parts.append(f"{CATEGORY_LABEL[inf.category]}: {inf.reason}")
    if flat:
        parts.append("Checked and neutral:")
        for inf in flat:
            parts.append(f"{CATEGORY_LABEL[inf.category]}: {inf.reason}")
    if unknown:
        parts.append("Could not be determined from stored data: " + ", ".join(CATEGORY_LABEL[i.category] for i in unknown) + ".")

    for metric in ("best_over_line", "best_under_line", "book_ou_board", "book_milestone_board", "h2h_games", "game_total", "home_spread", "rest_days"):
        t = _claim_text(claims, metric)
        if t:
            parts.append(t)

    note = _flag_note(claims)
    if note:
        parts.append(note)
    return " ".join(parts)
