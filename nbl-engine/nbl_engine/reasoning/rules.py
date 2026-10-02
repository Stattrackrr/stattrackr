"""Registered reasoning rules.

Each rule inspects the claim set for exactly one category and returns one
InferenceRecord with status confirmed / not_confirmed / cannot_determine.
One rule per category guarantees no category votes twice.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from nbl_engine.config import Thresholds
from nbl_engine.models.records import ClaimRecord, Direction, InferenceRecord, Status

RuleFn = Callable[["ClaimIndex", Thresholds, str], InferenceRecord]
_RULES: dict[str, tuple[str, RuleFn]] = {}  # rule_id -> (category, fn)


def rule(rule_id: str, category: str) -> Callable[[RuleFn], RuleFn]:
    def deco(fn: RuleFn) -> RuleFn:
        if rule_id in _RULES:
            raise ValueError(f"duplicate rule id {rule_id}")
        _RULES[rule_id] = (category, fn)
        return fn

    return deco


def registered_rules() -> list[tuple[str, str, RuleFn]]:
    return [(rid, cat, fn) for rid, (cat, fn) in _RULES.items()]


@dataclass
class ClaimIndex:
    claims: list[ClaimRecord]

    def first(self, metric: str) -> ClaimRecord | None:
        for c in self.claims:
            if c.metric == metric:
                return c
        return None

    def many(self, prefix: str) -> list[ClaimRecord]:
        return [c for c in self.claims if c.metric.startswith(prefix)]

    def num(self, metric: str) -> float | None:
        c = self.first(metric)
        return float(c.value) if c and isinstance(c.value, (int, float)) else None

    def n(self, metric: str) -> int:
        c = self.first(metric)
        return int(c.sample_n or 0) if c else 0

    def ids(self, *metrics: str) -> list[str]:
        out: list[str] = []
        for m in metrics:
            c = self.first(m)
            if c:
                out.append(c.id)
        return out


def _rec(rule_id: str, category: str, direction: Direction, status: Status, weight: float, claim_ids: list[str], reason: str) -> InferenceRecord:
    return InferenceRecord(
        rule_id=rule_id,
        category=category,  # type: ignore[arg-type]
        direction=direction if status == "confirmed" else "neutral",
        status=status,
        weight=weight if status == "confirmed" else 0.0,
        claim_ids=claim_ids,
        reason=reason,
    )


def run_rules(claims: list[ClaimRecord], cfg: Thresholds, stat_key: str) -> list[InferenceRecord]:
    idx = ClaimIndex(claims)
    return [fn(idx, cfg, stat_key) for _, _, fn in registered_rules()]


# ------------------------------------------------------------------ rules

@rule("form_l5_vs_season", "form")
def form_rule(idx: ClaimIndex, cfg: Thresholds, stat: str) -> InferenceRecord:
    season, l5 = idx.first("season_mean"), idx.first("l5_mean")
    w = cfg.weights.form
    if not season or not l5:
        return _rec("form_l5_vs_season", "form", "neutral", "cannot_determine", w, idx.ids("season_mean", "l5_mean"), "No season or recent window stored.")
    if (l5.sample_n or 0) >= (season.sample_n or 0):
        return _rec("form_l5_vs_season", "form", "neutral", "cannot_determine", w, [season.id, l5.id], f"Recent window equals the whole season ({season.sample_n} game(s)); no form split yet.")
    s, r = float(season.value), float(l5.value)  # type: ignore[arg-type]
    delta = r - s
    need = max(cfg.form.l5_vs_season_delta_abs, abs(s) * cfg.form.l5_vs_season_delta_pct)
    if delta >= need:
        return _rec("form_l5_vs_season", "form", "over", "confirmed", w, [season.id, l5.id], f"{l5.as_text} {season.as_text}")
    if delta <= -need:
        return _rec("form_l5_vs_season", "form", "under", "confirmed", w, [season.id, l5.id], f"{l5.as_text} {season.as_text}")
    return _rec("form_l5_vs_season", "form", "neutral", "not_confirmed", w, [season.id, l5.id], f"{l5.as_text} {season.as_text} Difference inside the noise band.")


@rule("hit_rate_vs_line", "hit_rate")
def hit_rate_rule(idx: ClaimIndex, cfg: Thresholds, stat: str) -> InferenceRecord:
    c = idx.first("season_hit_rate")
    w = cfg.weights.hit_rate
    if not c:
        return _rec("hit_rate_vs_line", "hit_rate", "neutral", "cannot_determine", w, [], "No line to measure hit rate against.")
    if (c.sample_n or 0) < cfg.samples.min_games_current:
        return _rec("hit_rate_vs_line", "hit_rate", "neutral", "cannot_determine", w, [c.id], f"{c.as_text} Below the {cfg.samples.min_games_current}-game minimum.")
    rate = float(c.value) if c.value is not None else None
    streak = idx.first("streak")
    ids = [c.id] + ([streak.id] if streak else [])
    tail = f" {streak.as_text}" if streak else ""
    if rate is None:
        return _rec("hit_rate_vs_line", "hit_rate", "neutral", "cannot_determine", w, ids, c.as_text)
    if rate >= cfg.hit_rate.strong_min:
        return _rec("hit_rate_vs_line", "hit_rate", "over", "confirmed", w, ids, c.as_text + tail)
    if rate >= cfg.hit_rate.lean_min:
        return _rec("hit_rate_vs_line", "hit_rate", "over", "confirmed", round(w * 0.6, 4), ids, c.as_text + tail)
    if rate <= cfg.hit_rate.under_max:
        return _rec("hit_rate_vs_line", "hit_rate", "under", "confirmed", w if rate <= (1 - cfg.hit_rate.strong_min) else round(w * 0.6, 4), ids, c.as_text + tail)
    return _rec("hit_rate_vs_line", "hit_rate", "neutral", "not_confirmed", w, ids, c.as_text + tail)


@rule("opponent_allows_stat", "matchup_allowed")
def matchup_rule(idx: ClaimIndex, cfg: Thresholds, stat: str) -> InferenceRecord:
    allowed, rank = idx.first("opp_allowed_season"), idx.first("opp_allowed_rank")
    w = cfg.weights.matchup_allowed
    if not allowed:
        return _rec("opponent_allows_stat", "matchup_allowed", "neutral", "cannot_determine", w, [], "No opponent allowed data stored.")
    if not rank or (allowed.sample_n or 0) < cfg.samples.team_min_games:
        return _rec("opponent_allows_stat", "matchup_allowed", "neutral", "cannot_determine", w, [allowed.id], f"{allowed.as_text} Opponent below the {cfg.samples.team_min_games}-game minimum for ranking.")
    r = int(rank.value)  # type: ignore[arg-type]
    text = f"{allowed.as_text} {rank.as_text}"
    if r >= cfg.matchup.bottom_rank:
        return _rec("opponent_allows_stat", "matchup_allowed", "over", "confirmed", w, [allowed.id, rank.id], text)
    if r <= cfg.matchup.top_rank:
        return _rec("opponent_allows_stat", "matchup_allowed", "under", "confirmed", w, [allowed.id, rank.id], text)
    return _rec("opponent_allows_stat", "matchup_allowed", "neutral", "not_confirmed", w, [allowed.id, rank.id], f"{text} Middle of the table.")


@rule("opponent_pace", "pace")
def pace_rule(idx: ClaimIndex, cfg: Thresholds, stat: str) -> InferenceRecord:
    pace, rank = idx.first("opp_pace"), idx.first("opp_pace_rank")
    w = cfg.weights.pace
    if not pace or not rank:
        return _rec("opponent_pace", "pace", "neutral", "cannot_determine", w, idx.ids("opp_pace"), "Opponent pace not rankable yet.")
    r = int(rank.value)  # type: ignore[arg-type]
    if r >= cfg.pace.bottom_rank:
        return _rec("opponent_pace", "pace", "over", "confirmed", w, [pace.id, rank.id], pace.as_text)
    if r <= cfg.pace.top_rank:
        return _rec("opponent_pace", "pace", "under", "confirmed", w, [pace.id, rank.id], pace.as_text)
    return _rec("opponent_pace", "pace", "neutral", "not_confirmed", w, [pace.id, rank.id], f"{pace.as_text} Middle of the table.")


@rule("usage_trend", "usage")
def usage_rule(idx: ClaimIndex, cfg: Thresholds, stat: str) -> InferenceRecord:
    season, l5 = idx.first("usage_season"), idx.first("usage_l5")
    w = cfg.weights.usage
    if not season:
        return _rec("usage_trend", "usage", "neutral", "cannot_determine", w, [], "Usage could not be derived (team box incomplete).")
    if not l5:
        return _rec("usage_trend", "usage", "neutral", "cannot_determine", w, [season.id], f"{season.as_text} Recent window equals the season; no usage trend yet.")
    delta = float(l5.value) - float(season.value)  # type: ignore[arg-type]
    if delta >= cfg.usage.usage_delta_points:
        return _rec("usage_trend", "usage", "over", "confirmed", w, [season.id, l5.id], f"{l5.as_text} {season.as_text}")
    if delta <= -cfg.usage.usage_delta_points:
        return _rec("usage_trend", "usage", "under", "confirmed", w, [season.id, l5.id], f"{l5.as_text} {season.as_text}")
    return _rec("usage_trend", "usage", "neutral", "not_confirmed", w, [season.id, l5.id], f"{l5.as_text} {season.as_text} Usage steady.")


SCORING_STATS = frozenset({"threeMade", "points", "pra", "pr", "pa"})
REBOUND_STATS = frozenset({"rebounds", "ra", "pr", "pra"})


@rule("shot_profile_vs_opp", "shot_profile")
def shot_profile_rule(idx: ClaimIndex, cfg: Thresholds, stat: str) -> InferenceRecord:
    """3PM: three-point share vs opponent 3P% allowed rank.
    PTS / PRA / PR / PA: share of the player's scoring from zones the opponent
    leaks versus zones it protects (shot-chart FG% rank, 1 = hardest)."""
    rid = "shot_profile_vs_opp"
    w = cfg.weights.shot_profile
    if stat not in SCORING_STATS:
        return _rec(rid, "shot_profile", "neutral", "cannot_determine", w, [], "Shot profile applies to scoring stats only.")

    if stat == "threeMade":
        share, opp_pct = idx.first("three_share"), idx.first("opp_three_pct_allowed")
        att = idx.first("three_attempts_season")
        if not share or not opp_pct:
            return _rec(rid, "shot_profile", "neutral", "cannot_determine", w, idx.ids("three_share", "opp_three_pct_allowed", "three_attempts_season"), "Charted shot profile or opponent 3PT defence not stored.")
        ids = [share.id, opp_pct.id] + ([att.id] if att else [])
        text = f"{share.as_text} {opp_pct.as_text}" + (f" {att.as_text}" if att else "")
        rank = idx.first("opp_three_pct_rank")
        if float(share.value or 0) < cfg.shots.three_share_min:  # type: ignore[arg-type]
            return _rec(rid, "shot_profile", "neutral", "not_confirmed", w, ids, f"{text} Three-point share below {round(cfg.shots.three_share_min * 100)}%.")
        if not rank:
            return _rec(rid, "shot_profile", "neutral", "cannot_determine", w, ids, f"{text} Opponent 3P% not rankable yet.")
        r = int(rank.value)  # type: ignore[arg-type]
        if r >= cfg.shots.opp_three_pct_rank_bottom:
            return _rec(rid, "shot_profile", "over", "confirmed", w, ids + [rank.id], text)
        if r <= cfg.shots.opp_three_pct_rank_top:
            return _rec(rid, "shot_profile", "under", "confirmed", w, ids + [rank.id], text)
        return _rec(rid, "shot_profile", "neutral", "not_confirmed", w, ids + [rank.id], f"{text} Opponent 3PT defence mid-table.")

    edge = idx.first("zone_matchup_edge")
    zone_claims = idx.many("zone_share_") + idx.many("opp_zone_rank_") + idx.many("opp_zone_pts_")
    ids = [c.id for c in zone_claims] + ([edge.id] if edge else [])
    if not edge or edge.value is None:
        return _rec(rid, "shot_profile", "neutral", "cannot_determine", w, ids, "Charted zones for player or opponent not stored / not rankable yet.")
    text = " ".join(c.as_text for c in zone_claims) + f" {edge.as_text}"
    e = float(edge.value)  # type: ignore[arg-type]
    if e >= cfg.shots.zone_edge_min:
        return _rec(rid, "shot_profile", "over", "confirmed", w, ids, text)
    if e <= -cfg.shots.zone_edge_min:
        return _rec(rid, "shot_profile", "under", "confirmed", w, ids, text)
    return _rec(rid, "shot_profile", "neutral", "not_confirmed", w, ids, f"{text} Zone matchup is a wash.")


@rule("rebound_profile_vs_opp", "rebounding")
def rebounding_rule(idx: ClaimIndex, cfg: Thresholds, stat: str) -> InferenceRecord:
    """Player OREB/DREB split weighted by opponent OREB/DREB conceded rank (1 = hardest)."""
    rid = "rebound_profile_vs_opp"
    w = cfg.weights.rebounding
    if stat not in REBOUND_STATS:
        return _rec(rid, "rebounding", "neutral", "cannot_determine", w, [], "Rebounding profile applies to rebound stats only.")
    edge = idx.first("board_matchup_edge")
    parts = [c for m in ("oreb_mean", "oreb_share", "reb_pct_season", "reb_pct_l5", "opp_oreb_allowed", "opp_dreb_allowed") for c in [idx.first(m)] if c]
    ids = [c.id for c in parts] + ([edge.id] if edge else [])
    if not edge or edge.value is None:
        return _rec(rid, "rebounding", "neutral", "cannot_determine", w, ids, (" ".join(c.as_text for c in parts) + " Opponent boards not rankable yet.").strip())
    text = " ".join(c.as_text for c in parts) + f" {edge.as_text}"
    e = float(edge.value)  # type: ignore[arg-type]
    if e >= cfg.rebounding.edge_min:
        return _rec(rid, "rebounding", "over", "confirmed", w, ids, text)
    if e <= -cfg.rebounding.edge_min:
        return _rec(rid, "rebounding", "under", "confirmed", w, ids, text)
    return _rec(rid, "rebounding", "neutral", "not_confirmed", w, ids, f"{text} Rebounding matchup is a wash.")


@rule("minutes_trend", "minutes")
def minutes_rule(idx: ClaimIndex, cfg: Thresholds, stat: str) -> InferenceRecord:
    season, trend = idx.first("minutes_season_mean"), idx.first("minutes_trend")
    w = cfg.weights.minutes
    if not season:
        return _rec("minutes_trend", "minutes", "neutral", "cannot_determine", w, [], "No minutes stored.")
    if not trend:
        return _rec("minutes_trend", "minutes", "neutral", "cannot_determine", w, [season.id], f"{season.as_text} Recent window equals the season; no minutes trend yet.")
    d = float(trend.value)  # type: ignore[arg-type]
    if d >= cfg.minutes.positive_trend_delta:
        return _rec("minutes_trend", "minutes", "over", "confirmed", w, [season.id, trend.id], f"{season.as_text} {trend.as_text}")
    if d <= cfg.minutes.avoid_trend_delta:
        return _rec("minutes_trend", "minutes", "under", "confirmed", w, [season.id, trend.id], f"{season.as_text} {trend.as_text}")
    return _rec("minutes_trend", "minutes", "neutral", "not_confirmed", w, [season.id, trend.id], f"{season.as_text} {trend.as_text} Minutes steady.")


@rule("home_away_split", "home_away")
def home_away_rule(idx: ClaimIndex, cfg: Thresholds, stat: str) -> InferenceRecord:
    c = idx.first("home_mean") or idx.first("away_mean")
    w = cfg.weights.home_away
    if not c or (c.sample_n or 0) < 2:
        return _rec("home_away_split", "home_away", "neutral", "cannot_determine", w, [c.id] if c else [], "Not enough games at each venue yet.")
    season = idx.first("season_mean")
    if not season:
        return _rec("home_away_split", "home_away", "neutral", "cannot_determine", w, [c.id], c.as_text)
    v, s = float(c.value), float(season.value)  # type: ignore[arg-type]
    need = max(cfg.form.l5_vs_season_delta_abs, abs(s) * cfg.form.l5_vs_season_delta_pct)
    if v - s >= need:
        return _rec("home_away_split", "home_away", "over", "confirmed", w, [c.id, season.id], c.as_text)
    if s - v >= need:
        return _rec("home_away_split", "home_away", "under", "confirmed", w, [c.id, season.id], c.as_text)
    return _rec("home_away_split", "home_away", "neutral", "not_confirmed", w, [c.id, season.id], f"{c.as_text} No venue split.")


@rule("head_to_head", "h2h")
def h2h_rule(idx: ClaimIndex, cfg: Thresholds, stat: str) -> InferenceRecord:
    hr = idx.first("h2h_hit_rate")
    means = idx.many("h2h_mean_")
    games = idx.first("h2h_games")
    w = cfg.weights.h2h
    ids = ([hr.id] if hr else []) + ([games.id] if games else []) + [m.id for m in means]
    if not hr or (hr.sample_n or 0) < cfg.samples.h2h_min_games:
        return _rec("head_to_head", "h2h", "neutral", "cannot_determine", w, ids, (hr.as_text if hr else (games.as_text if games else "No stored head-to-head games against this opponent.")) + f" Needs {cfg.samples.h2h_min_games}+ meetings.")
    text = " ".join(c.as_text for c in ([hr, games] if games else [hr]) + means)
    rate = float(hr.value) if hr.value is not None else None
    if rate is None:
        return _rec("head_to_head", "h2h", "neutral", "cannot_determine", w, ids, text)
    if rate >= cfg.hit_rate.strong_min:
        return _rec("head_to_head", "h2h", "over", "confirmed", w, ids, text)
    if rate <= cfg.hit_rate.under_max:
        return _rec("head_to_head", "h2h", "under", "confirmed", w, ids, text)
    return _rec("head_to_head", "h2h", "neutral", "not_confirmed", w, ids, f"{text} Mixed head-to-head record.")


@rule("teammate_out_split", "injury_impact")
def injury_impact_rule(idx: ClaimIndex, cfg: Thresholds, stat: str) -> InferenceRecord:
    w = cfg.weights.injury_impact
    outs = idx.many("teammate_out")
    if not outs:
        return _rec("teammate_out_split", "injury_impact", "neutral", "cannot_determine", w, [], "No rotation teammate listed out on the stored injury list.")
    outs_text = " ".join(c.as_text for c in outs)
    # pair ww_with_<id> / ww_without_<id> claims by suffix
    pairs: list[tuple[ClaimRecord, ClaimRecord]] = []
    for with_c in idx.many("ww_with_"):
        suffix = with_c.metric[len("ww_with_"):]
        without_c = idx.first(f"ww_without_{suffix}")
        if without_c:
            pairs.append((with_c, without_c))
    all_ids = [c.id for c in outs] + [c.id for p in pairs for c in p]
    min_n = cfg.samples.with_without_min_games
    usable = [(a, b) for a, b in pairs if (a.sample_n or 0) >= min_n and (b.sample_n or 0) >= min_n and a.value is not None and b.value is not None]
    if not usable:
        return _rec("teammate_out_split", "injury_impact", "neutral", "cannot_determine", w, all_ids, f"{outs_text} Not enough games in both with/without buckets ({min_n}+ each).")
    # largest absolute swing decides; ties broken by claim id for determinism
    usable.sort(key=lambda p: (-abs(float(p[1].value) - float(p[0].value)), p[0].id))  # type: ignore[arg-type]
    with_c, without_c = usable[0]
    with_mean, without = float(with_c.value), float(without_c.value)  # type: ignore[arg-type]
    need = max(cfg.form.l5_vs_season_delta_abs, abs(with_mean) * cfg.usage.with_without_delta_pct)
    text = f"{outs_text} {with_c.as_text} {without_c.as_text}"
    if without - with_mean >= need:
        return _rec("teammate_out_split", "injury_impact", "over", "confirmed", w, all_ids, text)
    if with_mean - without >= need:
        return _rec("teammate_out_split", "injury_impact", "under", "confirmed", w, all_ids, text)
    return _rec("teammate_out_split", "injury_impact", "neutral", "not_confirmed", w, all_ids, f"{text} No material split.")


@rule("line_movement", "line_movement")
def line_movement_rule(idx: ClaimIndex, cfg: Thresholds, stat: str) -> InferenceRecord:
    c = idx.first("line_movement")
    w = cfg.weights.line_movement
    if not c or c.value is None:
        return _rec("line_movement", "line_movement", "neutral", "cannot_determine", w, [c.id] if c else [], c.as_text if c else "No line history.")
    d = float(c.value)  # type: ignore[arg-type]
    if d >= cfg.line_movement.min_move:
        return _rec("line_movement", "line_movement", "over", "confirmed", w, [c.id], c.as_text)
    if d <= -cfg.line_movement.min_move:
        return _rec("line_movement", "line_movement", "under", "confirmed", w, [c.id], c.as_text)
    return _rec("line_movement", "line_movement", "neutral", "not_confirmed", w, [c.id], f"{c.as_text} Below the movement threshold.")
