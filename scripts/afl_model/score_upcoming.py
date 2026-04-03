#!/usr/bin/env python3
"""
Score upcoming AFL disposals props using the latest trained artifact.

Usage:
  python scripts/afl_model/score_upcoming.py --base-url http://localhost:3000
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import os
import pickle
import urllib.parse
from datetime import date
from typing import Dict, List, Optional

from common import (
    DATA_DIR,
    MODEL_DIR,
    canonical_team_key,
    canonical_venue_key,
    get_json,
    interstate_travel_flag,
    mean,
    normal_cdf,
    normalize_name,
    normalize_team,
    now_iso,
    novig_probs,
    parse_date,
    primary_home_venue_key,
    read_dfs_usage_by_player,
    read_dvp_disposals_by_opponent_position,
    read_oa_team_stats_by_team,
    read_ta_team_stats_by_team,
    rolling,
    shared_home_venue_flag,
    slug_time,
    stddev,
    to_float,
    read_json,
    write_json,
    fetch_player_logs,
)
from build_dataset import FEATURE_COLUMNS
from train_disposals_model import baseline_predict_row

HISTORY_DIR = os.path.join(MODEL_DIR, "history")
LINE_HISTORY_PATH = os.path.join(HISTORY_DIR, "disposals-line-history.json")


def model_predict(artifact: dict, model_obj, feature_map: Dict[str, float]) -> float:
    if artifact.get("modelType") == "baseline" or model_obj is None:
        return baseline_predict_row(feature_map)
    vec = [[feature_map[c] for c in FEATURE_COLUMNS]]
    pred = model_obj.predict(vec)[0]
    return max(0.0, float(pred))


def build_feature_map(
    games: List[dict],
    opp_allow_disposals: Optional[float],
    next_game_date: Optional[object],
    next_venue_key: str,
    is_true_home: float,
    is_shared_home_away_venue: float,
    is_interstate_travel: float,
    opp_role_disp_index: Optional[float],
    opp_role_disp_ppg: Optional[float],
    team_ta_disposals: Optional[float],
    opp_ta_disposals: Optional[float],
) -> Optional[Dict[str, float]]:
    if not games:
        return None
    # Newest first for rolling windows.
    games_sorted = sorted(
        games,
        key=lambda g: str(g.get("date") or g.get("game_date") or ""),
        reverse=True,
    )
    disposals = [to_float(g.get("disposals")) for g in games_sorted]
    disposals = [x for x in disposals if x is not None]
    if len(disposals) < 3:
        return None

    tog = [to_float(g.get("percent_played")) for g in games_sorted]
    cp = [to_float(g.get("contested_possessions")) for g in games_sorted]
    up = [to_float(g.get("uncontested_possessions")) for g in games_sorted]
    cl = [to_float(g.get("clearances")) for g in games_sorted]
    i50 = [to_float(g.get("inside_50s")) for g in games_sorted]
    mg = [to_float(g.get("meters_gained")) for g in games_sorted]

    latest_date = parse_date(str(games_sorted[0].get("date") or games_sorted[0].get("game_date") or ""))
    prev_date = parse_date(str(games_sorted[1].get("date") or games_sorted[1].get("game_date") or "")) if len(games_sorted) > 1 else None
    rest_days = 7.0
    if latest_date and next_game_date is not None:
        try:
            gap_days = float((next_game_date - latest_date).days)
            if math.isfinite(gap_days):
                rest_days = float(max(3.0, gap_days))
        except Exception:
            pass
    elif latest_date and prev_date:
        rest_days = float(max(3, (latest_date - prev_date).days))
    rest_short_le5 = 1.0 if rest_days <= 5.0 else 0.0
    rest_normal_6_8 = 1.0 if 6.0 <= rest_days <= 8.0 else 0.0
    rest_long_ge9 = 1.0 if rest_days >= 9.0 else 0.0
    post_bye_team = 1.0 if rest_days >= 11.0 else 0.0

    roll3_disp = float(mean(rolling(disposals, 3)) or 0.0)
    roll10_disp = float(mean(rolling(disposals, 10)) or 0.0)
    roll3_tog = float(mean(rolling([x for x in tog if x is not None], 3)) or 0.0)
    roll10_tog = float(mean(rolling([x for x in tog if x is not None], 10)) or 0.0)
    roll3_cp = float(mean(rolling([x for x in cp if x is not None], 3)) or 0.0)
    roll10_cp = float(mean(rolling([x for x in cp if x is not None], 10)) or 0.0)
    roll3_up = float(mean(rolling([x for x in up if x is not None], 3)) or 0.0)
    roll10_up = float(mean(rolling([x for x in up if x is not None], 10)) or 0.0)
    roll3_cl = float(mean(rolling([x for x in cl if x is not None], 3)) or 0.0)
    roll10_cl = float(mean(rolling([x for x in cl if x is not None], 10)) or 0.0)
    role_delta_cl = roll3_cl - roll10_cl

    venue_games = [g for g in games_sorted if canonical_venue_key(str(g.get("venue") or "")) == next_venue_key and next_venue_key]
    venue_disposals = [to_float(g.get("disposals")) for g in venue_games]
    venue_disposals = [x for x in venue_disposals if x is not None]
    venue_tog = [to_float(g.get("percent_played")) for g in venue_games]
    venue_tog = [x for x in venue_tog if x is not None]
    venue_player_disp_last5 = float(mean(rolling(venue_disposals, 5)) or 0.0)
    venue_player_tog_last5 = float(mean(rolling(venue_tog, 5)) or 0.0)

    recent_tog = [x for x in tog[:5] if x is not None]
    low_tog_count = len([x for x in recent_tog if x < 65.0])
    selection_low_tog_rate_last5 = float(low_tog_count / len(recent_tog)) if recent_tog else 0.0
    selection_tog_std_last5 = float(stddev(recent_tog) or 0.0)
    selection_games_since_low_tog = 10.0
    for idx, tg in enumerate([x for x in tog if x is not None]):
        if tg < 65.0:
            selection_games_since_low_tog = float(idx)
            break

    game_pace_disposals_avg = float(mean([x for x in [team_ta_disposals, opp_ta_disposals] if x is not None]) or 0.0)

    return {
        "roll3_mean": float(mean(rolling(disposals, 3)) or 0.0),
        "roll5_mean": float(mean(rolling(disposals, 5)) or 0.0),
        "roll10_mean": float(mean(rolling(disposals, 10)) or 0.0),
        "roll5_std": float(stddev(rolling(disposals, 5)) or 0.0),
        "roll10_std": float(stddev(rolling(disposals, 10)) or 0.0),
        "lag1": float(disposals[0]),
        "games_history": float(len(disposals)),
        "tog_roll5_mean": float(mean(rolling([x for x in tog if x is not None], 5)) or 0.0),
        "cp_roll5_mean": float(mean(rolling([x for x in cp if x is not None], 5)) or 0.0),
        "up_roll5_mean": float(mean(rolling([x for x in up if x is not None], 5)) or 0.0),
        "cl_roll5_mean": float(mean(rolling([x for x in cl if x is not None], 5)) or 0.0),
        "i50_roll5_mean": float(mean(rolling([x for x in i50 if x is not None], 5)) or 0.0),
        "mg_roll5_mean": float(mean(rolling([x for x in mg if x is not None], 5)) or 0.0),
        "rest_days": rest_days,
        "rest_short_le5": rest_short_le5,
        "rest_normal_6_8": rest_normal_6_8,
        "rest_long_ge9": rest_long_ge9,
        "post_bye_team": post_bye_team,
        "is_true_home": float(is_true_home or 0.0),
        "is_shared_home_away_venue": float(is_shared_home_away_venue or 0.0),
        "is_interstate_travel": float(is_interstate_travel or 0.0),
        "venue_player_disp_last5": venue_player_disp_last5,
        "venue_player_tog_last5": venue_player_tog_last5,
        "selection_low_tog_rate_last5": selection_low_tog_rate_last5,
        "selection_tog_std_last5": selection_tog_std_last5,
        "selection_games_since_low_tog": selection_games_since_low_tog,
        "opp_role_disp_index": float(opp_role_disp_index or 1.0),
        "opp_role_disp_ppg": float(opp_role_disp_ppg or 0.0),
        "team_ta_disposals": float(team_ta_disposals or 0.0),
        "opp_ta_disposals": float(opp_ta_disposals or 0.0),
        "game_pace_disposals_avg": game_pace_disposals_avg,
        "opp_allow_disposals": float(opp_allow_disposals or 0.0),
        "opp_allow_kicks": 0.0,
        "opp_allow_handballs": 0.0,
        "opp_allow_cp": 0.0,
        "opp_allow_up": 0.0,
        "opp_allow_clearances": 0.0,
        "opp_allow_i50": 0.0,
        "opp_allow_mg": 0.0,
        "delta_disp_3v10": roll3_disp - roll10_disp,
        "delta_tog_3v10": roll3_tog - roll10_tog,
        "delta_cp_3v10": roll3_cp - roll10_cp,
        "delta_up_3v10": roll3_up - roll10_up,
        "delta_cl_3v10": role_delta_cl,
        "cba_momentum_proxy": 0.0,
    }


def oa_value_for_opponent(
    opponent: str,
    oa_stats_by_team: Dict[str, Dict[str, float]],
    key: str,
) -> Optional[float]:
    target = normalize_name(opponent).replace(" ", "")
    if not target:
        return None
    direct = oa_stats_by_team.get(target)
    if direct and key in direct:
        return direct[key]
    for team_key, stats in oa_stats_by_team.items():
        if team_key in target or target in team_key:
            if key in stats:
                return stats[key]
    return None


def infer_role_bucket_from_games(games: List[dict]) -> str:
    if not games:
        return "MID"
    recent = sorted(
        games,
        key=lambda g: str(g.get("date") or g.get("game_date") or ""),
        reverse=True,
    )[:5]
    hitouts = [to_float(x.get("hitouts")) for x in recent]
    clearances = [to_float(x.get("clearances")) for x in recent]
    rebounds = [to_float(x.get("rebounds")) for x in recent]
    intercepts = [to_float(x.get("intercepts")) for x in recent]
    marks_i50 = [to_float(x.get("marks_inside_50")) for x in recent]

    ho = float(mean([x for x in hitouts if x is not None]) or 0.0)
    cl = float(mean([x for x in clearances if x is not None]) or 0.0)
    rb = float(mean([x for x in rebounds if x is not None]) or 0.0)
    itc = float(mean([x for x in intercepts if x is not None]) or 0.0)
    mi50 = float(mean([x for x in marks_i50 if x is not None]) or 0.0)

    if ho >= 8.0:
        return "RUC"
    if cl >= 2.5:
        return "MID"
    if rb >= 2.5 or itc >= 4.0:
        return "DEF"
    if mi50 >= 0.8:
        return "FWD"
    return "MID"


def latest_artifact_path() -> str:
    p = os.path.join(MODEL_DIR, "models", "latest-model.json")
    if not os.path.exists(p):
        raise FileNotFoundError("latest-model.json not found. Run train_disposals_model.py first.")
    return p


def load_model_object(artifact: dict):
    rel = artifact.get("modelPicklePath")
    if not rel:
        return None
    path = os.path.join(MODEL_DIR, rel.replace("/", os.sep))
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        return pickle.load(f)


def parse_float(v, default=0.0) -> float:
    n = to_float(v)
    return default if n is None else float(n)


def inverse_normal_cdf(p: float) -> float:
    # Acklam inverse normal approximation (sufficient for probability anchoring).
    p = float(p)
    if p <= 0.0:
        return -10.0
    if p >= 1.0:
        return 10.0

    a = [
        -3.969683028665376e01,
        2.209460984245205e02,
        -2.759285104469687e02,
        1.383577518672690e02,
        -3.066479806614716e01,
        2.506628277459239e00,
    ]
    b = [
        -5.447609879822406e01,
        1.615858368580409e02,
        -1.556989798598866e02,
        6.680131188771972e01,
        -1.328068155288572e01,
    ]
    c = [
        -7.784894002430293e-03,
        -3.223964580411365e-01,
        -2.400758277161838e00,
        -2.549732539343734e00,
        4.374664141464968e00,
        2.938163982698783e00,
    ]
    d = [
        7.784695709041462e-03,
        3.224671290700398e-01,
        2.445134137142996e00,
        3.754408661907416e00,
    ]

    plow = 0.02425
    phigh = 1.0 - plow
    if p < plow:
        q = math.sqrt(-2.0 * math.log(p))
        return (
            (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
            / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0)
        )
    if p > phigh:
        q = math.sqrt(-2.0 * math.log(1.0 - p))
        return -(
            (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]
        ) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0)
        )
    q = p - 0.5
    r = q * q
    return (
        (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    ) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0)


def market_implied_expected(line: float, sigma: float, market_p_over: Optional[float]) -> Optional[float]:
    if market_p_over is None or sigma <= 0.0:
        return None
    p = min(0.98, max(0.02, float(market_p_over)))
    z = inverse_normal_cdf(1.0 - p)
    return float(line - (sigma * z))


def load_weather_context() -> tuple[Dict[str, dict], Dict[str, dict]]:
    path = os.path.join(DATA_DIR, "afl-weather-upcoming.json")
    if not os.path.exists(path):
        return {}, {}
    try:
        payload = read_json(path)
    except Exception:
        return {}, {}
    games = payload.get("games", []) if isinstance(payload, dict) else []
    if not isinstance(games, list):
        return {}, {}
    by_id: Dict[str, dict] = {}
    by_match: Dict[str, dict] = {}
    for g in games:
        if not isinstance(g, dict):
            continue
        gid = str(g.get("gameId") or "").strip()
        home = normalize_team(str(g.get("homeTeam") or ""))
        away = normalize_team(str(g.get("awayTeam") or ""))
        date = str(g.get("commenceTime") or "")[:10]
        if gid:
            by_id[gid] = g
        if home and away and date:
            by_match[f"{home}|{away}|{date}"] = g
    return by_id, by_match


def weather_adjustment(weather: dict) -> float:
    precip = float(to_float(weather.get("precipitationMm")) or 0.0)
    wind = float(to_float(weather.get("windKmh")) or 0.0)
    temp = float(to_float(weather.get("temperatureC")) or 0.0)

    adj = 0.0
    if precip >= 2.0:
        adj -= 2.4
    elif precip >= 0.8:
        adj -= 1.4
    elif precip > 0.0:
        adj -= 0.7

    if wind >= 30.0:
        adj -= 1.2
    elif wind >= 22.0:
        adj -= 0.8
    elif wind >= 16.0:
        adj -= 0.35

    # Calm, dry conditions generally support cleaner disposals.
    if precip <= 0.05 and wind <= 10.0:
        adj += 0.35
    if precip <= 0.05 and 15.0 <= temp <= 24.0:
        adj += 0.15

    return max(-3.0, min(0.8, adj))


def week_key_from_date(d: Optional[date]) -> str:
    if d is None:
        return ""
    iso = d.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def normalize_bookmaker_key(name: str) -> str:
    return normalize_name(name).replace(" ", "")


def read_line_history() -> List[dict]:
    if not os.path.exists(LINE_HISTORY_PATH):
        return []
    try:
        payload = read_json(LINE_HISTORY_PATH)
        rows = payload.get("rows", []) if isinstance(payload, dict) else []
        return rows if isinstance(rows, list) else []
    except Exception:
        return []


def write_line_history(rows: List[dict]) -> None:
    os.makedirs(HISTORY_DIR, exist_ok=True)
    write_json(
        LINE_HISTORY_PATH,
        {
            "generatedAt": now_iso(),
            "count": len(rows),
            "rows": rows,
        },
    )


def select_lowest_line_rows(out_rows: List[dict]) -> List[dict]:
    by_player_week: Dict[str, dict] = {}
    for row in out_rows:
        player = str(row.get("playerName") or "").strip()
        line = to_float(row.get("line"))
        game_date = parse_date(str(row.get("commenceTime") or "")[:10])
        if not player or line is None or game_date is None:
            continue
        wk = week_key_from_date(game_date)
        if not wk:
            continue
        key = f"{normalize_name(player)}|{wk}"
        existing = by_player_week.get(key)
        if existing is None:
            by_player_week[key] = row
            continue
        existing_line = to_float(existing.get("line"))
        if existing_line is None or line < existing_line:
            by_player_week[key] = row
            continue
        if line == existing_line:
            # Stable tie-breaker.
            book = str(row.get("bookmaker") or "")
            existing_book = str(existing.get("bookmaker") or "")
            if normalize_bookmaker_key(book) < normalize_bookmaker_key(existing_book):
                by_player_week[key] = row
    return list(by_player_week.values())


def upsert_line_history(existing_rows: List[dict], lowest_rows: List[dict]) -> List[dict]:
    by_key: Dict[str, dict] = {}
    for row in existing_rows:
        snap_key = str(row.get("snapshotKey") or "").strip()
        if snap_key:
            by_key[snap_key] = row

    for row in lowest_rows:
        player = str(row.get("playerName") or "").strip()
        game_date = parse_date(str(row.get("commenceTime") or "")[:10])
        wk = week_key_from_date(game_date)
        line = float(to_float(row.get("line")) or 0.0)
        if not player or not wk:
            continue
        snap_key = f"{normalize_name(player)}|{wk}"
        current = by_key.get(snap_key, {})
        current_line = to_float(current.get("line"))
        should_replace_core = current_line is None or line <= current_line
        if should_replace_core:
            current.update(
                {
                    "snapshotKey": snap_key,
                    "capturedAt": now_iso(),
                    "weekKey": wk,
                    "gameDate": str(row.get("commenceTime") or "")[:10],
                    "commenceTime": row.get("commenceTime"),
                    "playerName": player,
                    "homeTeam": row.get("homeTeam"),
                    "awayTeam": row.get("awayTeam"),
                    "playerTeam": row.get("playerTeam"),
                    "opponentTeam": row.get("opponentTeam"),
                    "bookmaker": row.get("bookmaker"),
                    "line": round(line, 2),
                    "modelExpectedDisposals": round(float(to_float(row.get("expectedDisposals")) or 0.0), 2),
                    "modelEdge": round(float(to_float(row.get("edgeVsMarket")) or 0.0), 4) if row.get("edgeVsMarket") is not None else None,
                }
            )
        by_key[snap_key] = current

    merged = list(by_key.values())
    merged.sort(key=lambda r: str(r.get("gameDate") or ""), reverse=True)
    return merged


def enrich_line_history_actuals(rows: List[dict], base_url: str) -> List[dict]:
    if not rows:
        return rows
    logs_cache: Dict[str, List[dict]] = {}
    today = parse_date(now_iso()[:10])
    for row in rows:
        if row.get("actualDisposals") is not None:
            continue
        game_date = parse_date(str(row.get("gameDate") or ""))
        if game_date is None or (today is not None and game_date > today):
            continue
        player = str(row.get("playerName") or "").strip()
        player_team = str(row.get("playerTeam") or "").strip()
        if not player or not player_team:
            continue
        cache_key = f"{normalize_name(player)}|{normalize_team(player_team)}"
        games = logs_cache.get(cache_key)
        if games is None:
            seasons = []
            if game_date is not None:
                seasons.append(game_date.year)
                seasons.append(game_date.year - 1)
            seasons.extend([date.today().year, date.today().year - 1])
            seen = set()
            games = []
            for season in seasons:
                if season in seen:
                    continue
                seen.add(season)
                try:
                    games.extend(fetch_player_logs(base_url, season, player, player_team))
                except Exception:
                    pass
            logs_cache[cache_key] = games

        target_opp = normalize_team(str(row.get("opponentTeam") or ""))
        matched = None
        for g in games:
            g_date = parse_date(str(g.get("date") or g.get("game_date") or ""))
            if g_date != game_date:
                continue
            if target_opp:
                g_opp = normalize_team(str(g.get("opponent") or ""))
                if g_opp and g_opp != target_opp:
                    continue
            matched = g
            break
        if matched is None:
            continue
        actual_disp = to_float(matched.get("disposals"))
        if actual_disp is None:
            continue
        actual_tog = to_float(matched.get("percent_played"))
        line = float(to_float(row.get("line")) or 0.0)
        model_expected = to_float(row.get("modelExpectedDisposals"))
        row["actualDisposals"] = round(float(actual_disp), 2)
        row["actualTog"] = round(float(actual_tog), 2) if actual_tog is not None else None
        row["differenceLine"] = round(float(actual_disp) - line, 2)
        row["differenceModel"] = round(float(actual_disp) - float(model_expected), 2) if model_expected is not None else None
        row["resultColor"] = "green" if float(actual_disp) >= line else "red"
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:3000")
    parser.add_argument("--artifact", default="")
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--concurrency", type=int, default=50)
    parser.add_argument("--batch-size", type=int, default=50)
    args = parser.parse_args()

    artifact_path = args.artifact.strip() or latest_artifact_path()
    with open(artifact_path, "r", encoding="utf-8") as f:
        artifact = json.load(f)
    model_obj = load_model_object(artifact)
    residual_std = max(2.0, parse_float(artifact.get("residualStd"), 6.0))

    list_url = f"{args.base_url.rstrip('/')}/api/afl/player-props/list?enrich=false"
    payload = get_json(list_url)
    rows = payload.get("data", []) if isinstance(payload, dict) else []
    rows = [r for r in rows if str(r.get("statType") or "") == "disposals"]

    oa_stats_map = read_oa_team_stats_by_team(args.season)
    ta_stats_map = read_ta_team_stats_by_team(args.season)
    if not ta_stats_map:
        ta_stats_map = read_ta_team_stats_by_team(args.season - 1)
    dvp_by_opp_pos = read_dvp_disposals_by_opponent_position(args.season)
    if not dvp_by_opp_pos:
        dvp_by_opp_pos = read_dvp_disposals_by_opponent_position(args.season - 1)
    dfs_usage_map = read_dfs_usage_by_player(args.season)
    weather_by_id, weather_by_match = load_weather_context()
    logs_cache: Dict[str, List[dict]] = {}
    out_rows: List[dict] = []

    # Pre-fetch all unique player/team logs in concurrent batches.
    unique_player_team: Dict[str, tuple[str, str]] = {}
    for r in rows:
        player = str(r.get("playerName") or "").strip()
        if not player:
            continue
        player_team = str(r.get("playerTeam") or "").strip()
        if not player_team:
            player_team = str(r.get("homeTeam") or "").strip()
        if not player_team:
            continue
        key = f"{normalize_name(player)}|{normalize_team(player_team)}"
        if key not in unique_player_team:
            unique_player_team[key] = (player, player_team)

    fetch_tasks = list(unique_player_team.items())
    batch_size = max(1, int(args.batch_size))
    max_workers = max(1, int(args.concurrency))

    def fetch_logs_task(item: tuple[str, tuple[str, str]]) -> tuple[str, List[dict]]:
        cache_key, (player, player_team) = item
        games: List[dict] = []
        for season in (args.season, args.season - 1, args.season - 2):
            try:
                games.extend(fetch_player_logs(args.base_url, season, player, player_team))
            except Exception:
                pass
        return cache_key, games

    for i in range(0, len(fetch_tasks), batch_size):
        batch = fetch_tasks[i : i + batch_size]
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(fetch_logs_task, item) for item in batch]
            for fut in concurrent.futures.as_completed(futures):
                try:
                    cache_key, games = fut.result()
                    logs_cache[cache_key] = games
                except Exception:
                    continue

    for r in rows:
        player = str(r.get("playerName") or "").strip()
        home = str(r.get("homeTeam") or "").strip()
        away = str(r.get("awayTeam") or "").strip()
        line = parse_float(r.get("line"), 0.0)
        if not player or not home or not away:
            continue

        # Resolve player team from available field if present, else infer from opponent side.
        player_team = str(r.get("playerTeam") or "").strip()
        if not player_team:
            # Fallback: use home team by default.
            player_team = home
        opponent = away if normalize_team(player_team) == normalize_team(home) else home
        player_is_home = 1.0 if normalize_team(player_team) == normalize_team(home) else 0.0
        shared_home_away = shared_home_venue_flag(player_team, opponent)
        is_true_home = 1.0 if player_is_home >= 0.5 and shared_home_away < 0.5 else 0.0
        next_venue_key = canonical_venue_key(primary_home_venue_key(home))
        is_interstate_travel = 0.0 if player_is_home >= 0.5 else interstate_travel_flag(player_team, next_venue_key)

        team_key = canonical_team_key(player_team)
        opponent_key = canonical_team_key(opponent)
        team_ta_disposals = to_float((ta_stats_map.get(team_key, {}) or {}).get("disposals"))
        opp_ta_disposals = to_float((ta_stats_map.get(opponent_key, {}) or {}).get("disposals"))
        opp_allow_disposals = oa_value_for_opponent(opponent, oa_stats_map, "disposals")
        opp_allow_kicks = oa_value_for_opponent(opponent, oa_stats_map, "kicks")
        opp_allow_handballs = oa_value_for_opponent(opponent, oa_stats_map, "handballs")
        opp_allow_cp = oa_value_for_opponent(opponent, oa_stats_map, "contested_possessions")
        opp_allow_up = oa_value_for_opponent(opponent, oa_stats_map, "uncontested_possessions")
        opp_allow_clearances = oa_value_for_opponent(opponent, oa_stats_map, "clearances")
        opp_allow_i50 = oa_value_for_opponent(opponent, oa_stats_map, "inside_50s")
        opp_allow_mg = oa_value_for_opponent(opponent, oa_stats_map, "meters_gained")

        cache_key = f"{normalize_name(player)}|{normalize_team(player_team)}"
        games = logs_cache.get(cache_key) or []
        role_bucket = infer_role_bucket_from_games(games)
        opp_role = dvp_by_opp_pos.get(opponent_key, {}).get(role_bucket, {})
        opp_role_disp_index = to_float(opp_role.get("index"))
        opp_role_disp_ppg = to_float(opp_role.get("ppg"))

        next_game_date = parse_date(str(r.get("commenceTime") or ""))

        feat = build_feature_map(
            games,
            opp_allow_disposals,
            next_game_date,
            next_venue_key,
            is_true_home,
            shared_home_away,
            is_interstate_travel,
            opp_role_disp_index,
            opp_role_disp_ppg,
            team_ta_disposals,
            opp_ta_disposals,
        )
        if feat is None:
            continue
        feat["opp_allow_kicks"] = float(opp_allow_kicks or 0.0)
        feat["opp_allow_handballs"] = float(opp_allow_handballs or 0.0)
        feat["opp_allow_cp"] = float(opp_allow_cp or 0.0)
        feat["opp_allow_up"] = float(opp_allow_up or 0.0)
        feat["opp_allow_clearances"] = float(opp_allow_clearances or 0.0)
        feat["opp_allow_i50"] = float(opp_allow_i50 or 0.0)
        feat["opp_allow_mg"] = float(opp_allow_mg or 0.0)
        usage = dfs_usage_map.get(normalize_name(player), {})
        feat["dfs_cba_pct"] = float(to_float(usage.get("cba_pct")) or 0.0)
        feat["dfs_kickins"] = float(to_float(usage.get("kickins")) or 0.0)
        feat["cba_momentum_proxy"] = (feat["dfs_cba_pct"] / 100.0) * float(feat.get("delta_cl_3v10") or 0.0)

        raw_expected = model_predict(artifact, model_obj, feat)
        wx = None
        gid = str(r.get("gameId") or "").strip()
        if gid:
            wx = weather_by_id.get(gid)
        if wx is None:
            match_key = f"{normalize_team(home)}|{normalize_team(away)}|{str(r.get('commenceTime') or '')[:10]}"
            wx = weather_by_match.get(match_key)
        wx_weather = (wx or {}).get("weather", {}) if isinstance(wx, dict) else {}
        wx_adj = weather_adjustment(wx_weather) if isinstance(wx_weather, dict) and wx_weather else 0.0
        expected = max(0.0, raw_expected + wx_adj)
        player_std = stddev([to_float(g.get("disposals")) for g in games if to_float(g.get("disposals")) is not None] or [])
        sigma = max(2.0, (residual_std * 0.7) + ((player_std or residual_std) * 0.3))

        z = (line - expected) / sigma if sigma > 0 else 0.0
        p_over = 1.0 - normal_cdf(z)
        p_under = 1.0 - p_over

        market_over, market_under = novig_probs(str(r.get("overOdds") or ""), str(r.get("underOdds") or ""))
        market_expected = market_implied_expected(line, sigma, market_over)
        market_blend_weight = 0.22 if market_expected is not None else 0.0
        market_blend_max_shift = 2.25
        market_blend_applied_shift = 0.0
        if market_expected is not None:
            # Cap market anchor influence so it nudges but never mirrors books.
            raw_shift = market_blend_weight * (market_expected - expected)
            market_blend_applied_shift = max(-market_blend_max_shift, min(market_blend_max_shift, raw_shift))
            expected = expected + market_blend_applied_shift
            z = (line - expected) / sigma if sigma > 0 else 0.0
            p_over = 1.0 - normal_cdf(z)
            p_under = 1.0 - p_over

        edge_over = (p_over - market_over) if market_over is not None else None

        out_rows.append(
            {
                "projectionKey": f"{normalize_name(player)}|{normalize_team(home)}|{normalize_team(away)}|{line}",
                "playerName": player,
                "homeTeam": home,
                "awayTeam": away,
                "playerTeam": player_team,
                "opponentTeam": opponent,
                "gameId": r.get("gameId"),
                "commenceTime": r.get("commenceTime"),
                "bookmaker": r.get("bookmaker"),
                "line": line,
                "overOdds": r.get("overOdds"),
                "underOdds": r.get("underOdds"),
                "rawExpectedDisposals": round(raw_expected, 2),
                "weatherAdjustment": round(wx_adj, 2),
                "marketImpliedExpectedDisposals": round(market_expected, 2) if market_expected is not None else None,
                "marketBlendWeight": round(market_blend_weight, 3),
                "marketBlendShift": round(market_blend_applied_shift, 2),
                "expectedDisposals": round(expected, 2),
                "sigma": round(sigma, 2),
                "pOver": round(p_over, 4),
                "pUnder": round(p_under, 4),
                "marketPOver": round(market_over, 4) if market_over is not None else None,
                "marketPUnder": round(market_under, 4) if market_under is not None else None,
                "edgeVsMarket": round(edge_over, 4) if edge_over is not None else None,
                "weatherContext": wx_weather if isinstance(wx_weather, dict) else None,
                "featureSnapshot": {k: round(float(v), 4) for k, v in feat.items()},
            }
        )

    out_rows.sort(key=lambda x: abs(x.get("edgeVsMarket") or 0.0), reverse=True)
    lowest_rows = select_lowest_line_rows(out_rows)
    existing_history = read_line_history()
    merged_history = upsert_line_history(existing_history, lowest_rows)
    merged_history = enrich_line_history_actuals(merged_history, args.base_url)
    write_line_history(merged_history)

    ts = slug_time()
    projections_dir = os.path.join(MODEL_DIR, "projections")
    os.makedirs(projections_dir, exist_ok=True)

    out = {
        "generatedAt": now_iso(),
        "modelVersion": artifact.get("version"),
        "modelType": artifact.get("modelType"),
        "rows": out_rows,
        "count": len(out_rows),
    }
    versioned_path = os.path.join(projections_dir, f"disposals-projections-{ts}.json")
    latest_path = os.path.join(MODEL_DIR, "latest-disposals-projections.json")
    write_json(versioned_path, out)
    write_json(latest_path, out)
    print(f"Scored projections: {versioned_path} ({len(out_rows)} rows)")


if __name__ == "__main__":
    main()
