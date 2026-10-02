"""Typed access to thresholds.toml (the single thresholds config)."""

from __future__ import annotations

import tomllib
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from nbl_engine.paths import ENGINE_ROOT


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SamplesCfg(_Strict):
    min_games_current: int = Field(ge=1)
    small_sample_games: int = Field(ge=1)
    min_minutes_avg: float = Field(ge=0)
    h2h_min_games: int = Field(ge=1)
    with_without_min_games: int = Field(ge=1)
    team_min_games: int = Field(ge=1)


class SeasonsCfg(_Strict):
    current_year: int
    h2h_prior_years: list[int]


class FreshnessCfg(_Strict):
    max_stats_age_hours: float = Field(gt=0)
    max_odds_age_hours: float = Field(gt=0)


class FormCfg(_Strict):
    l5_vs_season_delta_pct: float = Field(ge=0)
    l5_vs_season_delta_abs: float = Field(ge=0)


class HitRateCfg(_Strict):
    lean_min: float = Field(ge=0, le=1)
    strong_min: float = Field(ge=0, le=1)
    under_max: float = Field(ge=0, le=1)


class RankBandCfg(_Strict):
    top_rank: int = Field(ge=1)
    bottom_rank: int = Field(ge=1)


class UsageCfg(_Strict):
    usage_delta_points: float = Field(ge=0)
    with_without_delta_pct: float = Field(ge=0)


class ShotsCfg(_Strict):
    three_share_min: float = Field(ge=0, le=1)
    opp_three_pct_rank_top: int = Field(ge=1)
    opp_three_pct_rank_bottom: int = Field(ge=1)
    zone_share_min: float = Field(ge=0, le=1)
    zone_rank_top: int = Field(ge=1)
    zone_rank_bottom: int = Field(ge=1)
    zone_edge_min: float = Field(ge=0, le=1)


class ReboundingCfg(_Strict):
    top_rank: int = Field(ge=1)
    bottom_rank: int = Field(ge=1)
    edge_min: float = Field(ge=0, le=1)
    reb_pct_trend_points: float = Field(ge=0)


class MinutesCfg(_Strict):
    avoid_trend_delta: float
    positive_trend_delta: float


class LineMovementCfg(_Strict):
    min_move: float = Field(ge=0)


class RestCfg(_Strict):
    short_rest_days: int = Field(ge=0)


class ScoringCfg(_Strict):
    strong_score: float
    lean_score: float
    strong_min_categories: int = Field(ge=1)
    lean_min_categories: int = Field(ge=1)
    conflict_ratio: float = Field(ge=0, le=1)


class WeightsCfg(_Strict):
    form: float
    hit_rate: float
    matchup_allowed: float
    pace: float
    usage: float
    shot_profile: float
    rebounding: float
    minutes: float
    home_away: float
    h2h: float
    injury_impact: float
    line_movement: float

    def for_category(self, category: str) -> float:
        return float(getattr(self, category))


class Thresholds(_Strict):
    samples: SamplesCfg
    seasons: SeasonsCfg
    freshness: FreshnessCfg
    form: FormCfg
    hit_rate: HitRateCfg
    matchup: RankBandCfg
    pace: RankBandCfg
    usage: UsageCfg
    shots: ShotsCfg
    rebounding: ReboundingCfg
    minutes: MinutesCfg
    line_movement: LineMovementCfg
    rest: RestCfg
    scoring: ScoringCfg
    weights: WeightsCfg


DEFAULT_THRESHOLDS_PATH = ENGINE_ROOT / "thresholds.toml"


@lru_cache(maxsize=4)
def load_thresholds(path: Path | None = None) -> Thresholds:
    file = path or DEFAULT_THRESHOLDS_PATH
    with open(file, "rb") as fh:
        data = tomllib.load(fh)
    return Thresholds.model_validate(data)
