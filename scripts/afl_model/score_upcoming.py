#!/usr/bin/env python3
"""
Score upcoming AFL disposals props using the latest trained artifact.

Usage:
  python scripts/afl_model/score_upcoming.py --base-url http://localhost:3000
"""

from __future__ import annotations

import argparse
import bisect
import concurrent.futures
import json
import joblib
import math
import os
import pickle
import urllib.parse
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from common import (
    DATA_DIR,
    MODEL_DIR,
    canonical_team_key,
    canonical_venue_key,
    venue_keys_for_team_home_grounds,
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
    read_dfs_role_map_by_player,
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


def artifact_feature_columns(artifact: dict, model_obj) -> List[str]:
    cols = artifact.get("featureColumns")
    if isinstance(cols, list):
        cleaned = [str(c).strip() for c in cols if str(c).strip()]
        if cleaned:
            return cleaned
    # Fallback for older artifacts that may not include explicit feature columns.
    expected_n = getattr(model_obj, "n_features_in_", None)
    if isinstance(expected_n, int) and expected_n > 0:
        return FEATURE_COLUMNS[:expected_n]
    return FEATURE_COLUMNS


def model_predict(artifact: dict, model_obj, feature_map: Dict[str, float]) -> float:
    if artifact.get("modelType") == "baseline" or model_obj is None:
        return baseline_predict_row(feature_map)
    feature_columns = artifact_feature_columns(artifact, model_obj)
    vec = [[float(feature_map.get(c, 0.0)) for c in feature_columns]]
    pred = model_obj.predict(vec)[0]
    return max(0.0, float(pred))


def clamp_prob(p: float) -> float:
    return max(1e-6, min(1.0 - 1e-6, float(p)))


def load_calibration_for_artifact(artifact: dict) -> dict:
    rel = str(artifact.get("calibrationPath") or "").strip()
    if rel:
        abs_path = os.path.join(MODEL_DIR, rel.replace("/", os.sep))
        if os.path.exists(abs_path):
            try:
                return read_json(abs_path)
            except Exception:
                pass
    for fallback in ("latest-calibration.json", "latest-candidate-calibration.json"):
        abs_path = os.path.join(MODEL_DIR, "models", fallback)
        if not os.path.exists(abs_path):
            continue
        try:
            payload = read_json(abs_path)
            target_version = str(payload.get("modelVersion") or "").strip()
            if not target_version or target_version == str(artifact.get("version") or ""):
                return payload
        except Exception:
            continue
    return {"method": "identity"}


def apply_calibration(prob: float, calibration: dict) -> float:
    method = str(calibration.get("method") or "identity").strip().lower()
    p = clamp_prob(prob)
    if method == "platt":
        try:
            a = float(calibration.get("a"))
            b = float(calibration.get("b"))
            s = math.log(p / (1.0 - p))
            return clamp_prob(1.0 / (1.0 + math.exp(-((a * s) + b))))
        except Exception:
            return p
    if method == "isotonic":
        x_vals = calibration.get("xThresholds")
        y_vals = calibration.get("yThresholds")
        if not isinstance(x_vals, list) or not isinstance(y_vals, list):
            return p
        if len(x_vals) != len(y_vals) or len(x_vals) < 2:
            return p
        try:
            x = [float(v) for v in x_vals]
            y = [clamp_prob(float(v)) for v in y_vals]
        except Exception:
            return p
        if p <= x[0]:
            return y[0]
        if p >= x[-1]:
            return y[-1]
        idx = bisect.bisect_left(x, p)
        x0, x1 = x[idx - 1], x[idx]
        y0, y1 = y[idx - 1], y[idx]
        if abs(x1 - x0) < 1e-12:
            return y0
        ratio = (p - x0) / (x1 - x0)
        return clamp_prob(y0 + (ratio * (y1 - y0)))
    return p


def build_feature_map(
    games: List[dict],
    opp_allow_disposals: Optional[float],
    next_game_date: Optional[object],
    fixture_venue_keys: set,
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

    roll5_disp_mean = float(mean(rolling(disposals, 5)) or 0.0)
    roll5_tog_mean = float(mean(rolling([x for x in tog if x is not None], 5)) or 0.0)

    vk = fixture_venue_keys or set()
    venue_games = [
        g
        for g in games_sorted
        if canonical_venue_key(str(g.get("venue") or "")) in vk
        and vk
    ]
    venue_disposals = [to_float(g.get("disposals")) for g in venue_games]
    venue_disposals = [x for x in venue_disposals if x is not None]
    venue_tog = [to_float(g.get("percent_played")) for g in venue_games]
    venue_tog = [x for x in venue_tog if x is not None]
    venue_player_disp_last5 = float(mean(rolling(venue_disposals, 5)) or 0.0)
    venue_player_tog_last5 = float(mean(rolling(venue_tog, 5)) or 0.0)
    if not venue_games:
        venue_player_disp_last5 = roll5_disp_mean
        venue_player_tog_last5 = roll5_tog_mean

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


def role_feature_flags(role_bucket: str) -> Dict[str, float]:
    role = str(role_bucket or "").strip().upper()
    return {
        "role_is_def": 1.0 if role == "DEF" else 0.0,
        "role_is_mid": 1.0 if role == "MID" else 0.0,
        "role_is_fwd": 1.0 if role == "FWD" else 0.0,
        "role_is_ruc": 1.0 if role == "RUC" else 0.0,
    }


def dfs_role_group_key(role_group: str) -> str:
    g = str(role_group or "").strip().lower()
    if "key forward" in g:
        return "key_fwd"
    if "small/medium forward" in g or "general forward" in g:
        return "gen_fwd"
    if "inside midfielder" in g:
        return "ins_mid"
    if g == "ruck" or "ruck" in g:
        return "ruck"
    if "wing/attacking defender" in g or "wing defender" in g:
        return "wng_def"
    if "general defender" in g:
        return "gen_def"
    if "designated kicker" in g:
        return "des_kck"
    return "unclassified"


def dfs_role_group_flags(role_group: str) -> Dict[str, float]:
    key = dfs_role_group_key(role_group)
    flags = {
        "dfs_role_key_fwd": 0.0,
        "dfs_role_gen_fwd": 0.0,
        "dfs_role_ins_mid": 0.0,
        "dfs_role_ruck": 0.0,
        "dfs_role_wng_def": 0.0,
        "dfs_role_gen_def": 0.0,
        "dfs_role_des_kck": 0.0,
        "dfs_role_unclassified": 0.0,
    }
    map_key_to_col = {
        "key_fwd": "dfs_role_key_fwd",
        "gen_fwd": "dfs_role_gen_fwd",
        "ins_mid": "dfs_role_ins_mid",
        "ruck": "dfs_role_ruck",
        "wng_def": "dfs_role_wng_def",
        "gen_def": "dfs_role_gen_def",
        "des_kck": "dfs_role_des_kck",
        "unclassified": "dfs_role_unclassified",
    }
    flags[map_key_to_col[key]] = 1.0
    return flags


def _matchup_key(team_a: str, team_b: str) -> str:
    a = canonical_team_key(team_a)
    b = canonical_team_key(team_b)
    if not a or not b:
        return ""
    x, y = sorted([a, b])
    return f"{x}|{y}"


def infer_player_team_from_games(home_team: str, away_team: str, games: List[dict], fallback_team: str = "") -> str:
    home_key = normalize_team(home_team)
    away_key = normalize_team(away_team)
    fallback_key = normalize_team(fallback_team)
    valid_keys = {k for k in [home_key, away_key] if k}

    if fallback_key in valid_keys:
        return fallback_team
    if not valid_keys:
        return fallback_team

    scores: Dict[str, float] = {k: 0.0 for k in valid_keys}
    for g in games:
        g_team = normalize_team(str(g.get("team") or ""))
        g_opp = normalize_team(str(g.get("opponent") or ""))
        if g_team in scores:
            scores[g_team] += 2.0
        # If the player's logged opponent matches one side, player's team is likely the other side.
        if g_opp == home_key and away_key in scores:
            scores[away_key] += 1.0
        elif g_opp == away_key and home_key in scores:
            scores[home_key] += 1.0

    if not scores:
        return fallback_team
    best_key = max(scores.items(), key=lambda item: item[1])[0]
    if best_key == home_key:
        return home_team
    if best_key == away_key:
        return away_team
    return fallback_team


def _position_label_to_role_bucket(label: str, idx: int = -1) -> Optional[str]:
    p = str(label or "").strip().upper()
    if p in {"FB", "HB", "B"}:
        return "DEF"
    if p in {"C", "W", "MID"}:
        return "MID"
    if p in {"HF", "FF", "FWD"}:
        return "FWD"
    if p in {"FOL", "FOLL", "FOLLOWERS"}:
        # FootyWire "Fol" row is usually [ruck-rover, ruck, rover].
        if idx == 1:
            return "RUC"
        return "MID"
    return None


def _entry_player_name(entry: Any) -> str:
    if isinstance(entry, dict):
        return str(entry.get("name") or "").strip()
    return str(entry or "").strip()


def _build_footywire_match_role_lookup(payload: dict) -> Dict[str, Dict[str, Dict[str, str]]]:
    """
    Returns:
      {
        "<teamA|teamB>": {
          "<team_key>": {
            "<normalized_player_name>": "<role_bucket DEF|MID|FWD|RUC>"
          }
        }
      }
    """
    matches = payload.get("matches")
    if not isinstance(matches, list):
        return {}

    out: Dict[str, Dict[str, Dict[str, str]]] = {}
    for match in matches:
        if not isinstance(match, dict):
            continue
        home_team = str(match.get("home_team") or "").strip()
        away_team = str(match.get("away_team") or "").strip()
        home_key = canonical_team_key(home_team)
        away_key = canonical_team_key(away_team)
        mu_key = _matchup_key(home_team, away_team)
        if not home_key or not away_key or not mu_key:
            continue

        team_map = out.setdefault(mu_key, {home_key: {}, away_key: {}})
        positions = match.get("positions")
        if not isinstance(positions, list):
            continue

        for row in positions:
            if not isinstance(row, dict):
                continue
            pos_label = str(row.get("position") or "").strip()
            home_players = row.get("home_players")
            away_players = row.get("away_players")
            if isinstance(home_players, list):
                for idx, entry in enumerate(home_players):
                    name = _entry_player_name(entry)
                    if not name:
                        continue
                    role_bucket = _position_label_to_role_bucket(pos_label, idx=idx)
                    if role_bucket:
                        team_map[home_key][normalize_name(name)] = role_bucket
            if isinstance(away_players, list):
                for idx, entry in enumerate(away_players):
                    name = _entry_player_name(entry)
                    if not name:
                        continue
                    role_bucket = _position_label_to_role_bucket(pos_label, idx=idx)
                    if role_bucket:
                        team_map[away_key][normalize_name(name)] = role_bucket

        # Interchange fallback: assign MID only when player has no role yet.
        interchange = match.get("interchange")
        if isinstance(interchange, dict):
            inter_home = interchange.get("home")
            inter_away = interchange.get("away")
            if isinstance(inter_home, list):
                for name in inter_home:
                    nk = normalize_name(_entry_player_name(name))
                    if nk and nk not in team_map[home_key]:
                        team_map[home_key][nk] = "MID"
            if isinstance(inter_away, list):
                for name in inter_away:
                    nk = normalize_name(_entry_player_name(name))
                    if nk and nk not in team_map[away_key]:
                        team_map[away_key][nk] = "MID"
    return out


def fetch_latest_footywire_roles(base_url: str) -> Dict[str, Dict[str, Dict[str, str]]]:
    try:
        url = f"{base_url.rstrip('/')}/api/afl/footywire-team-selections?refresh=1"
        payload = get_json(url)
        if isinstance(payload, dict) and str(payload.get("error") or "").strip():
            return {}
        if not isinstance(payload, dict):
            return {}
        return _build_footywire_match_role_lookup(payload)
    except Exception:
        return {}


def resolve_footywire_roles_for_fixture(
    footywire_roles_by_match: Dict[str, Dict[str, Dict[str, str]]],
    home: str,
    away: str,
) -> Dict[str, Dict[str, str]]:
    want = _matchup_key(home, away)
    if want and want in footywire_roles_by_match:
        return footywire_roles_by_match[want]
    hk = canonical_team_key(home)
    ak = canonical_team_key(away)
    if not hk or not ak:
        return {}
    for mu_key, teams_map in footywire_roles_by_match.items():
        parts = mu_key.split("|", 1)
        if len(parts) != 2:
            continue
        if {parts[0], parts[1]} == {hk, ak}:
            return teams_map
    return {}


def lookup_lineup_role_from_matchup(
    matchup_roles_by_team: Dict[str, Dict[str, str]],
    team_key: str,
    player: str,
) -> Optional[str]:
    pn = normalize_name(player)
    if not pn:
        return None
    tmap = matchup_roles_by_team.get(team_key, {}) or {}
    if pn in tmap:
        r = str(tmap.get(pn) or "").strip().upper()
        return r or None
    pn_compact = "".join(ch for ch in pn if ch.isalnum())
    for nk, role in tmap.items():
        if not nk:
            continue
        nk_compact = "".join(ch for ch in nk if ch.isalnum())
        if nk_compact and nk_compact == pn_compact:
            r = str(role or "").strip().upper()
            return r or None
    best: Optional[str] = None
    best_len = 0
    for nk, role in tmap.items():
        if not nk or len(nk) < 5:
            continue
        if nk in pn or pn in nk:
            ln = min(len(nk), len(pn))
            if ln > best_len:
                best_len = ln
                best = str(role or "").strip().upper() or None
    return best


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
    try:
        return joblib.load(path)
    except Exception:
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
                    "overOdds": row.get("overOdds"),
                    "underOdds": row.get("underOdds"),
                    "modelExpectedDisposals": round(float(to_float(row.get("expectedDisposals")) or 0.0), 2),
                    "modelEdge": round(float(to_float(row.get("edgeVsMarket")) or 0.0), 4) if row.get("edgeVsMarket") is not None else None,
                }
            )
        by_key[snap_key] = current

    merged = list(by_key.values())
    merged.sort(key=lambda r: str(r.get("gameDate") or ""), reverse=True)
    return merged


def _settle_fetch_logs(
    base_url: str,
    seasons: List[int],
    player: str,
    team_candidates: List[str],
    force_fetch: bool = False,
) -> List[dict]:
    games: List[dict] = []
    seen_team: set[str] = set()
    for team in team_candidates:
        team_name = str(team or "").strip()
        if not team_name:
            continue
        team_key = normalize_team(team_name)
        if team_key in seen_team:
            continue
        seen_team.add(team_key)
        for season in seasons:
            try:
                games.extend(
                    fetch_player_logs(
                        base_url,
                        season,
                        player,
                        team_name,
                        include_both=True,
                        strict_season=False,
                        use_disk_cache=True,
                        cache_ttl_minutes=720,
                        force_fetch=force_fetch,
                    )
                )
            except Exception:
                pass
    return games


def _resolve_settled_game_match(row: dict, games: List[dict]) -> Optional[dict]:
    game_date = parse_date(str(row.get("gameDate") or ""))
    if game_date is None:
        return None
    target_opp = canonical_team_key(str(row.get("opponentTeam") or ""))
    best: Optional[dict] = None
    best_rank: Optional[tuple] = None
    for g in games:
        if not isinstance(g, dict):
            continue
        g_date = parse_date(str(g.get("date") or g.get("game_date") or ""))
        if g_date is None:
            continue
        day_delta = abs((g_date - game_date).days)
        if day_delta > 1:
            continue
        g_opp = canonical_team_key(str(g.get("opponent") or ""))
        opp_match = bool(target_opp and g_opp and g_opp == target_opp)
        # Prefer exact opponent + exact date, then close-by date fallback.
        rank = (0 if opp_match else 1, day_delta)
        if best_rank is None or rank < best_rank:
            best = g
            best_rank = rank
    return best


def enrich_line_history_actuals(rows: List[dict], base_url: str) -> List[dict]:
    if not rows:
        return rows
    logs_cache: Dict[str, List[dict]] = {}
    today = parse_date(now_iso()[:10])
    completed_game_keys = {
        (
            str(r.get("gameDate") or ""),
            str(r.get("homeTeam") or ""),
            str(r.get("awayTeam") or ""),
        )
        for r in rows
        if r.get("actualDisposals") is not None
    }
    for row in rows:
        if row.get("actualDisposals") is not None:
            continue
        game_date = parse_date(str(row.get("gameDate") or ""))
        if game_date is None or (today is not None and game_date > today):
            continue
        player = str(row.get("playerName") or "").strip()
        if not player:
            continue
        team_candidates = [
            str(row.get("playerTeam") or "").strip(),
            str(row.get("homeTeam") or "").strip(),
            str(row.get("awayTeam") or "").strip(),
        ]
        seasons = []
        if game_date is not None:
            seasons.append(game_date.year)
            seasons.append(game_date.year - 1)
        seasons.extend([date.today().year, date.today().year - 1])
        seen = set()
        deduped_seasons = []
        for season in seasons:
            if season in seen:
                continue
            seen.add(season)
            deduped_seasons.append(season)
        cache_key = normalize_name(player)
        games = logs_cache.get(cache_key)
        if games is None:
            games = _settle_fetch_logs(base_url, deduped_seasons, player, team_candidates, force_fetch=False)
            logs_cache[cache_key] = games

        matched = _resolve_settled_game_match(row, games)
        if matched is None and games:
            # If cached logs exist but did not match, one fresh pull can resolve stale rows after completed games.
            refreshed = _settle_fetch_logs(base_url, deduped_seasons, player, team_candidates, force_fetch=True)
            if refreshed:
                logs_cache[cache_key] = refreshed
                games = refreshed
                matched = _resolve_settled_game_match(row, games)
        if matched is None:
            game_key = (
                str(row.get("gameDate") or ""),
                str(row.get("homeTeam") or ""),
                str(row.get("awayTeam") or ""),
            )
            # If this game is already clearly completed (other rows settled) and we still
            # cannot match this player log, treat as void so it does not stay pending forever.
            if game_key in completed_game_keys:
                line = to_float(row.get("line"))
                if line is not None:
                    model_expected = to_float(row.get("modelExpectedDisposals"))
                    row["actualDisposals"] = round(float(line), 2)
                    row["actualTog"] = None
                    row["differenceLine"] = 0.0
                    row["differenceModel"] = (
                        round(float(line) - float(model_expected), 2) if model_expected is not None else None
                    )
                    row["resultColor"] = "gray"
                    row["isVoid"] = True
                    row["voidReason"] = "no_player_log_after_game_complete"
                    row["settledAt"] = now_iso()
                    completed_game_keys.add(game_key)
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
        row["isVoid"] = False
        row["voidReason"] = None
        row["settledAt"] = now_iso()
        game_key = (
            str(row.get("gameDate") or ""),
            str(row.get("homeTeam") or ""),
            str(row.get("awayTeam") or ""),
        )
        completed_game_keys.add(game_key)
    return rows


def _projection_game_key(row: dict) -> str:
    return "|".join(
        [
            normalize_team(str(row.get("homeTeam") or "")),
            normalize_team(str(row.get("awayTeam") or "")),
            str(row.get("commenceTime") or "")[:10],
        ]
    )


def _to_recommended_side(row: dict) -> str:
    side = str(row.get("recommendedSide") or "").strip().upper()
    if side in {"OVER", "UNDER"}:
        return side
    return ""


def _pick_unique_players_sorted(candidates: List[dict], limit: int) -> List[dict]:
    seen_players: set[str] = set()
    picked: List[dict] = []
    for row in candidates:
        player_key = normalize_name(str(row.get("playerName") or ""))
        if not player_key or player_key in seen_players:
            continue
        seen_players.add(player_key)
        picked.append(row)
        if len(picked) >= limit:
            break
    return picked


def _recompute_recommendation_fields(
    row: dict,
    min_edge: float,
    min_confidence: float,
    max_abs_weather_adjustment: float,
) -> None:
    market_over = to_float(row.get("marketPOver"))
    market_under = to_float(row.get("marketPUnder"))
    p_over = to_float(row.get("pOver"))
    p_under = to_float(row.get("pUnder"))

    edge_over = (p_over - market_over) if (p_over is not None and market_over is not None) else None
    edge_under = (p_under - market_under) if (p_under is not None and market_under is not None) else None
    row["edgeVsMarket"] = round(edge_over, 4) if edge_over is not None else None
    row["edgeVsMarketUnder"] = round(edge_under, 4) if edge_under is not None else None

    best_side = None
    best_edge = None
    best_prob = None
    if edge_over is not None and edge_under is not None:
        if edge_over >= edge_under:
            best_side = "OVER"
            best_edge = float(edge_over)
            best_prob = float(p_over or 0.0)
        else:
            best_side = "UNDER"
            best_edge = float(edge_under)
            best_prob = float(p_under or 0.0)
    elif edge_over is not None:
        best_side = "OVER"
        best_edge = float(edge_over)
        best_prob = float(p_over or 0.0)
    elif edge_under is not None:
        best_side = "UNDER"
        best_edge = float(edge_under)
        best_prob = float(p_under or 0.0)

    row["recommendedSide"] = best_side
    row["recommendedEdge"] = round(best_edge, 4) if best_edge is not None else None
    row["recommendedProb"] = round(best_prob, 4) if best_prob is not None else None

    existing_reasons = [str(r) for r in (row.get("recommendationReasons") or [])]
    keep_reasons = [r for r in existing_reasons if r not in {"no_market_pair", "edge_below_threshold", "confidence_below_threshold"}]
    reasons = list(keep_reasons)
    if best_side is None or best_edge is None or best_prob is None:
        reasons.append("no_market_pair")
    else:
        if best_edge < float(min_edge):
            reasons.append("edge_below_threshold")
        if best_prob < float(min_confidence):
            reasons.append("confidence_below_threshold")
    wx_adj = float(to_float(row.get("weatherAdjustment")) or 0.0)
    if abs(wx_adj) > float(max_abs_weather_adjustment) and "weather_high_variance" not in reasons:
        reasons.append("weather_high_variance")
    row["recommendationReasons"] = reasons
    row["isRecommendedPick"] = len(reasons) == 0


def _recent_settled_over_rate(rows: List[dict], lookback: int) -> Optional[float]:
    settled: List[dict] = []
    for row in rows:
        if row.get("isVoid") is True:
            continue
        actual = to_float(row.get("actualDisposals"))
        line = to_float(row.get("line"))
        if actual is None or line is None:
            continue
        settled.append(row)
    if not settled:
        return None
    # Prefer latest settled rows first.
    settled.sort(key=lambda r: str(r.get("settledAt") or r.get("capturedAt") or ""), reverse=True)
    n = max(10, int(lookback))
    window = settled[:n]
    if not window:
        return None
    overs = 0
    for row in window:
        actual = float(to_float(row.get("actualDisposals")) or 0.0)
        line = float(to_float(row.get("line")) or 0.0)
        if actual >= line:
            overs += 1
    return float(overs / len(window))


def apply_adaptive_side_balance(
    rows: List[dict],
    line_history_rows: List[dict],
    target_over_rate: Optional[float],
    lookback_settled: int,
    strength: float,
    max_shift: float,
    min_rows: int,
    min_edge: float,
    min_confidence: float,
    max_abs_weather_adjustment: float,
) -> dict:
    k = max(0.0, min(2.0, float(strength)))
    max_step = max(0.0, min(0.20, float(max_shift)))
    min_count = max(10, int(min_rows))

    eligible = [r for r in rows if to_float(r.get("pOver")) is not None and to_float(r.get("marketPOver")) is not None]
    if len(eligible) < min_count:
        return {
            "mode": "adaptive",
            "applied": False,
            "reason": "insufficient_rows",
            "eligibleRows": len(eligible),
        }

    avg_model_over = mean([float(to_float(r.get("pOver")) or 0.0) for r in eligible]) or 0.5
    avg_market_over = mean([float(to_float(r.get("marketPOver")) or 0.0) for r in eligible]) or 0.5
    history_over = _recent_settled_over_rate(line_history_rows, lookback_settled)

    if target_over_rate is not None and math.isfinite(float(target_over_rate)):
        target_over = max(0.35, min(0.65, float(target_over_rate)))
        target_source = "arg"
    else:
        # Auto-target from live market center + recent realized side-rate.
        # This keeps probability mass anchored to today's slate while still learning from outcomes.
        hist_component = history_over if history_over is not None else avg_market_over
        target_over = max(0.42, min(0.56, (0.65 * float(avg_market_over)) + (0.35 * float(hist_component))))
        target_source = "auto"

    delta = float(target_over - avg_model_over)
    shift = max(-max_step, min(max_step, delta * k))
    if abs(shift) < 1e-6:
        return {
            "mode": "adaptive",
            "applied": False,
            "reason": "already_centered",
            "eligibleRows": len(eligible),
            "avgModelOverBefore": round(avg_model_over, 4),
            "avgMarketOver": round(avg_market_over, 4),
            "recentSettledOverRate": round(history_over, 4) if history_over is not None else None,
            "targetOverRate": round(target_over, 4),
            "targetSource": target_source,
        }

    for row in rows:
        p_over = to_float(row.get("pOver"))
        market_over = to_float(row.get("marketPOver"))
        if p_over is None or market_over is None:
            continue
        # Positive shift nudges toward OVER ceiling; negative shift nudges toward UNDER floor.
        if shift >= 0:
            adjusted = clamp_prob(float(p_over) + (shift * (1.0 - float(p_over))))
        else:
            adjusted = clamp_prob(float(p_over) + (shift * float(p_over)))
        row["sideBalanceShiftApplied"] = round(adjusted - float(p_over), 4)
        row["pOver"] = round(adjusted, 4)
        row["pUnder"] = round(1.0 - adjusted, 4)
        _recompute_recommendation_fields(row, min_edge, min_confidence, max_abs_weather_adjustment)

    avg_model_over_after = mean([float(to_float(r.get("pOver")) or 0.0) for r in eligible]) or avg_model_over
    return {
        "mode": "adaptive",
        "applied": True,
        "eligibleRows": len(eligible),
        "avgModelOverBefore": round(avg_model_over, 4),
        "avgModelOverAfter": round(avg_model_over_after, 4),
        "avgMarketOver": round(avg_market_over, 4),
        "recentSettledOverRate": round(history_over, 4) if history_over is not None else None,
        "targetOverRate": round(target_over, 4),
        "targetSource": target_source,
        "appliedShift": round(shift, 4),
    }


def assign_top3_game_ranks(
    rows: List[dict], max_same_side: int = 2, opposite_edge_tolerance: float = 0.02
) -> None:
    by_game: Dict[str, List[dict]] = {}
    for row in rows:
        game_key = _projection_game_key(row)
        row["gameKey"] = game_key
        by_game.setdefault(game_key, []).append(row)

    for game_key, game_rows in by_game.items():
        candidates: List[dict] = []
        for row in game_rows:
            if not bool(row.get("isRecommendedPick")):
                continue
            edge = to_float(row.get("recommendedEdge"))
            prob = to_float(row.get("recommendedProb"))
            if edge is None or prob is None:
                continue
            candidates.append(row)

        # Deterministic ordering: edge desc, prob desc, player name asc, bookmaker asc, line asc, projectionKey asc.
        candidates.sort(
            key=lambda r: (
                -(to_float(r.get("recommendedEdge")) or -999.0),
                -(to_float(r.get("recommendedProb")) or -999.0),
                normalize_name(str(r.get("playerName") or "")),
                normalize_name(str(r.get("bookmaker") or "")),
                to_float(r.get("line")) or 0.0,
                str(r.get("projectionKey") or ""),
            )
        )

        # Deterministic ranking: highest edge/probability with one row per player.
        selected = _pick_unique_players_sorted(candidates, limit=3)
        rank_by_player: Dict[str, int] = {}
        for idx, row in enumerate(selected, start=1):
            player_key = normalize_name(str(row.get("playerName") or ""))
            if player_key and player_key not in rank_by_player:
                rank_by_player[player_key] = idx

        for row in game_rows:
            player_key = normalize_name(str(row.get("playerName") or ""))
            rank = rank_by_player.get(player_key)
            row["recommendedPlayerRankInGame"] = rank if rank is not None else None
            row["isTop3PickInGame"] = bool(rank is not None and rank <= 3)
            row["top3RankingVersion"] = "edge_prob_player_deterministic_v4"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:3000")
    parser.add_argument("--artifact", default="")
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--concurrency", type=int, default=50)
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--latest-output-path", default="")
    parser.add_argument("--min-edge", type=float, default=0.045)
    parser.add_argument("--min-confidence", type=float, default=0.57)
    parser.add_argument("--max-abs-weather-adjustment", type=float, default=2.2)
    parser.add_argument("--prob-market-blend-weight", type=float, default=0.18)
    parser.add_argument("--prob-market-blend-max-shift", type=float, default=0.09)
    parser.add_argument("--top3-max-same-side", type=int, default=2)
    parser.add_argument("--top3-opposite-edge-tolerance", type=float, default=0.02)
    parser.add_argument("--lineup-role-weight", type=float, default=0.7)
    parser.add_argument("--side-balance-target-over-rate", type=float, default=-1.0)
    parser.add_argument("--side-balance-lookback-settled", type=int, default=200)
    parser.add_argument("--side-balance-strength", type=float, default=0.9)
    parser.add_argument("--side-balance-max-shift", type=float, default=0.09)
    parser.add_argument("--side-balance-min-rows", type=int, default=40)
    parser.add_argument("--only-player-name", default="")
    parser.add_argument("--only-home-team", default="")
    parser.add_argument("--only-away-team", default="")
    args = parser.parse_args()

    artifact_path = args.artifact.strip() or latest_artifact_path()
    with open(artifact_path, "r", encoding="utf-8") as f:
        artifact = json.load(f)
    model_obj = load_model_object(artifact)
    calibration = load_calibration_for_artifact(artifact)
    residual_std = max(2.0, parse_float(artifact.get("residualStd"), 6.0))

    list_url = f"{args.base_url.rstrip('/')}/api/afl/player-props/list?enrich=false"
    payload = get_json(list_url)
    rows = payload.get("data", []) if isinstance(payload, dict) else []
    rows = [r for r in rows if str(r.get("statType") or "") == "disposals"]
    only_player_name = normalize_name(args.only_player_name)
    only_home_team = normalize_team(args.only_home_team)
    only_away_team = normalize_team(args.only_away_team)
    if only_player_name:
        filtered_rows: List[dict] = []
        for r in rows:
            if normalize_name(str(r.get("playerName") or "")) != only_player_name:
                continue
            if only_home_team and normalize_team(str(r.get("homeTeam") or "")) != only_home_team:
                continue
            if only_away_team and normalize_team(str(r.get("awayTeam") or "")) != only_away_team:
                continue
            filtered_rows.append(r)
        rows = filtered_rows

    oa_stats_map = read_oa_team_stats_by_team(args.season)
    ta_stats_map = read_ta_team_stats_by_team(args.season)
    if not ta_stats_map:
        ta_stats_map = read_ta_team_stats_by_team(args.season - 1)
    dvp_by_opp_pos = read_dvp_disposals_by_opponent_position(args.season)
    if not dvp_by_opp_pos:
        dvp_by_opp_pos = read_dvp_disposals_by_opponent_position(args.season - 1)
    footywire_roles_by_match = fetch_latest_footywire_roles(args.base_url)
    dfs_role_map = read_dfs_role_map_by_player(args.season)
    dfs_usage_map = read_dfs_usage_by_player(args.season)
    weather_by_id, weather_by_match = load_weather_context()
    logs_cache: Dict[str, List[dict]] = {}
    out_rows: List[dict] = []

    # Pre-fetch all plausible player/team logs in concurrent batches.
    # When playerTeam is missing from list rows, fetch both home and away so we can infer the
    # correct side from logs before building opponent-context features.
    unique_player_team: Dict[str, tuple[str, str]] = {}
    for r in rows:
        player = str(r.get("playerName") or "").strip()
        if not player:
            continue
        home_team = str(r.get("homeTeam") or "").strip()
        away_team = str(r.get("awayTeam") or "").strip()
        player_team = str(r.get("playerTeam") or "").strip()

        candidate_teams: List[str] = []
        if player_team:
            candidate_teams.append(player_team)
        else:
            if home_team:
                candidate_teams.append(home_team)
            if away_team:
                candidate_teams.append(away_team)

        seen_team_keys: set[str] = set()
        for candidate_team in candidate_teams:
            team_key = normalize_team(candidate_team)
            if not team_key or team_key in seen_team_keys:
                continue
            seen_team_keys.add(team_key)
            key = f"{normalize_name(player)}|{team_key}"
            if key not in unique_player_team:
                unique_player_team[key] = (player, candidate_team)

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

        row_player_team = str(r.get("playerTeam") or "").strip()
        player_key = normalize_name(player)
        home_norm = normalize_team(home)
        away_norm = normalize_team(away)

        home_cache_key = f"{player_key}|{home_norm}"
        away_cache_key = f"{player_key}|{away_norm}"
        home_games = logs_cache.get(home_cache_key) or []
        away_games = logs_cache.get(away_cache_key) or []
        candidate_games = [*home_games, *away_games]

        player_team = infer_player_team_from_games(home, away, candidate_games, row_player_team)
        if not player_team:
            player_team = home

        player_team_norm = normalize_team(player_team)
        if player_team_norm == away_norm:
            opponent = home
        elif player_team_norm == home_norm:
            opponent = away
        else:
            player_team = home
            player_team_norm = home_norm
            opponent = away
        player_is_home = 1.0 if player_team_norm == home_norm else 0.0
        shared_home_away = shared_home_venue_flag(player_team, opponent)
        is_true_home = 1.0 if player_is_home >= 0.5 and shared_home_away < 0.5 else 0.0
        fixture_venue_keys = venue_keys_for_team_home_grounds(home)
        next_venue_key = sorted(fixture_venue_keys)[0] if fixture_venue_keys else canonical_venue_key(primary_home_venue_key(home))
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

        cache_key = f"{player_key}|{player_team_norm}"
        games = logs_cache.get(cache_key) or candidate_games
        recent_role_bucket = infer_role_bucket_from_games(games)
        dfs_role_row = dfs_role_map.get(normalize_name(player), {}) or {}
        dfs_role_bucket = str(dfs_role_row.get("role_bucket") or "").strip().upper()
        dfs_role_group = str(dfs_role_row.get("role_group") or "").strip()
        dfs_role_flags = dfs_role_group_flags(dfs_role_group)
        matchup_roles = resolve_footywire_roles_for_fixture(footywire_roles_by_match, home, away)
        lineup_role_bucket = lookup_lineup_role_from_matchup(matchup_roles, team_key, player)
        role_bucket = lineup_role_bucket or (dfs_role_bucket if dfs_role_bucket in {"DEF", "MID", "FWD", "RUC"} else recent_role_bucket)
        opp_role = dvp_by_opp_pos.get(opponent_key, {}).get(role_bucket, {})
        opp_role_disp_index = to_float(opp_role.get("index"))
        opp_role_disp_ppg = to_float(opp_role.get("ppg"))
        role_lineup_weight = max(0.0, min(1.0, float(args.lineup_role_weight)))
        if lineup_role_bucket:
            recent_opp_role = dvp_by_opp_pos.get(opponent_key, {}).get(recent_role_bucket, {})
            recent_idx = to_float(recent_opp_role.get("index"))
            recent_ppg = to_float(recent_opp_role.get("ppg"))
            if recent_idx is not None and opp_role_disp_index is not None:
                opp_role_disp_index = (role_lineup_weight * opp_role_disp_index) + ((1.0 - role_lineup_weight) * recent_idx)
            if recent_ppg is not None and opp_role_disp_ppg is not None:
                opp_role_disp_ppg = (role_lineup_weight * opp_role_disp_ppg) + ((1.0 - role_lineup_weight) * recent_ppg)
        role_flags = role_feature_flags(role_bucket)

        next_game_date = parse_date(str(r.get("commenceTime") or ""))

        feat = build_feature_map(
            games,
            opp_allow_disposals,
            next_game_date,
            fixture_venue_keys,
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
        feat["role_is_def"] = role_flags["role_is_def"]
        feat["role_is_mid"] = role_flags["role_is_mid"]
        feat["role_is_fwd"] = role_flags["role_is_fwd"]
        feat["role_is_ruc"] = role_flags["role_is_ruc"]
        feat["lineup_role_available"] = 1.0 if lineup_role_bucket else 0.0
        feat["lineup_role_confidence"] = role_lineup_weight if lineup_role_bucket else 0.25
        feat["dfs_role_key_fwd"] = dfs_role_flags["dfs_role_key_fwd"]
        feat["dfs_role_gen_fwd"] = dfs_role_flags["dfs_role_gen_fwd"]
        feat["dfs_role_ins_mid"] = dfs_role_flags["dfs_role_ins_mid"]
        feat["dfs_role_ruck"] = dfs_role_flags["dfs_role_ruck"]
        feat["dfs_role_wng_def"] = dfs_role_flags["dfs_role_wng_def"]
        feat["dfs_role_gen_def"] = dfs_role_flags["dfs_role_gen_def"]
        feat["dfs_role_des_kck"] = dfs_role_flags["dfs_role_des_kck"]
        feat["dfs_role_unclassified"] = dfs_role_flags["dfs_role_unclassified"]

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
        p_over_raw = 1.0 - normal_cdf(z)
        p_over = apply_calibration(p_over_raw, calibration)
        p_under = 1.0 - p_over
        p_over_calibrated = p_over
        p_under_calibrated = p_under

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
            p_over_raw = 1.0 - normal_cdf(z)
            p_over = apply_calibration(p_over_raw, calibration)
            p_under = 1.0 - p_over
            p_over_calibrated = p_over
            p_under_calibrated = p_under

        # Phase 2: blend calibrated model probability toward market to reduce one-sided slates.
        prob_market_blend_weight = float(args.prob_market_blend_weight) if market_over is not None else 0.0
        prob_market_blend_max_shift = max(0.0, float(args.prob_market_blend_max_shift))
        prob_market_blend_shift = 0.0
        if market_over is not None and prob_market_blend_weight > 0.0:
            raw_prob_shift = prob_market_blend_weight * (float(market_over) - float(p_over))
            prob_market_blend_shift = max(-prob_market_blend_max_shift, min(prob_market_blend_max_shift, raw_prob_shift))
            p_over = max(0.02, min(0.98, float(p_over) + prob_market_blend_shift))
            p_under = 1.0 - p_over

        edge_over = (p_over - market_over) if market_over is not None else None
        edge_under = (p_under - market_under) if market_under is not None else None

        best_side = None
        best_edge = None
        best_prob = None
        if edge_over is not None and edge_under is not None:
            if edge_over >= edge_under:
                best_side = "OVER"
                best_edge = float(edge_over)
                best_prob = float(p_over)
            else:
                best_side = "UNDER"
                best_edge = float(edge_under)
                best_prob = float(p_under)
        elif edge_over is not None:
            best_side = "OVER"
            best_edge = float(edge_over)
            best_prob = float(p_over)
        elif edge_under is not None:
            best_side = "UNDER"
            best_edge = float(edge_under)
            best_prob = float(p_under)

        recommendation_reasons: List[str] = []
        if best_side is None or best_edge is None or best_prob is None:
            recommendation_reasons.append("no_market_pair")
        else:
            if best_edge < float(args.min_edge):
                recommendation_reasons.append("edge_below_threshold")
            if best_prob < float(args.min_confidence):
                recommendation_reasons.append("confidence_below_threshold")
        if abs(float(wx_adj)) > float(args.max_abs_weather_adjustment):
            recommendation_reasons.append("weather_high_variance")
        should_publish = len(recommendation_reasons) == 0

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
                "pOverRaw": round(p_over_raw, 4),
                "pUnderRaw": round(1.0 - p_over_raw, 4),
                "pOverCalibrated": round(p_over_calibrated, 4),
                "pUnderCalibrated": round(p_under_calibrated, 4),
                "pOver": round(p_over, 4),
                "pUnder": round(p_under, 4),
                "marketPOver": round(market_over, 4) if market_over is not None else None,
                "marketPUnder": round(market_under, 4) if market_under is not None else None,
                "probMarketBlendWeight": round(prob_market_blend_weight, 3),
                "probMarketBlendShift": round(prob_market_blend_shift, 4),
                "edgeVsMarket": round(edge_over, 4) if edge_over is not None else None,
                "edgeVsMarketUnder": round(edge_under, 4) if edge_under is not None else None,
                "recommendedSide": best_side,
                "recommendedEdge": round(best_edge, 4) if best_edge is not None else None,
                "recommendedProb": round(best_prob, 4) if best_prob is not None else None,
                "isRecommendedPick": bool(should_publish),
                "recommendationReasons": recommendation_reasons,
                "selectionPolicy": {
                    "minEdge": float(args.min_edge),
                    "minConfidence": float(args.min_confidence),
                    "maxAbsWeatherAdjustment": float(args.max_abs_weather_adjustment),
                    "probMarketBlendWeight": float(args.prob_market_blend_weight),
                    "probMarketBlendMaxShift": float(args.prob_market_blend_max_shift),
                },
                "roleSignals": {
                    "recentRoleBucket": recent_role_bucket,
                    "dfsRoleBucket": dfs_role_bucket or None,
                    "dfsRoleGroup": dfs_role_group or None,
                    "lineupRoleBucket": lineup_role_bucket,
                    "resolvedRoleBucket": role_bucket,
                    "lineupRoleWeight": float(args.lineup_role_weight),
                },
                "top3Policy": {
                    "maxSameSide": int(args.top3_max_same_side),
                    "oppositeEdgeTolerance": float(args.top3_opposite_edge_tolerance),
                },
                "calibrationMethod": calibration.get("method", "identity"),
                "weatherContext": wx_weather if isinstance(wx_weather, dict) else None,
                "featureSnapshot": {k: round(float(v), 4) for k, v in feat.items()},
            }
        )

    existing_history = read_line_history()
    out_rows.sort(key=lambda x: abs(x.get("edgeVsMarket") or 0.0), reverse=True)
    side_balance_diag = apply_adaptive_side_balance(
        out_rows,
        line_history_rows=existing_history,
        target_over_rate=(
            float(args.side_balance_target_over_rate)
            if float(args.side_balance_target_over_rate) >= 0.0
            else None
        ),
        lookback_settled=int(args.side_balance_lookback_settled),
        strength=float(args.side_balance_strength),
        max_shift=float(args.side_balance_max_shift),
        min_rows=int(args.side_balance_min_rows),
        min_edge=float(args.min_edge),
        min_confidence=float(args.min_confidence),
        max_abs_weather_adjustment=float(args.max_abs_weather_adjustment),
    )
    out_rows.sort(key=lambda x: abs(x.get("edgeVsMarket") or 0.0), reverse=True)
    assign_top3_game_ranks(
        out_rows,
        max_same_side=max(1, int(args.top3_max_same_side)),
        opposite_edge_tolerance=max(0.0, float(args.top3_opposite_edge_tolerance)),
    )
    lowest_rows = select_lowest_line_rows(out_rows)
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
        "sideBalance": side_balance_diag,
        "rows": out_rows,
        "count": len(out_rows),
    }
    versioned_path = os.path.join(projections_dir, f"disposals-projections-{ts}.json")
    latest_path = args.latest_output_path.strip() or os.path.join(MODEL_DIR, "latest-disposals-projections.json")
    write_json(versioned_path, out)
    if only_player_name:
        existing_rows: List[dict] = []
        existing_model_version = artifact.get("version")
        existing_model_type = artifact.get("modelType")
        try:
            with open(latest_path, "r", encoding="utf-8") as f:
                latest_doc = json.load(f)
            if isinstance(latest_doc, dict):
                latest_rows = latest_doc.get("rows", [])
                if isinstance(latest_rows, list):
                    existing_rows = [row for row in latest_rows if isinstance(row, dict)]
                existing_model_version = latest_doc.get("modelVersion", existing_model_version)
                existing_model_type = latest_doc.get("modelType", existing_model_type)
        except Exception:
            existing_rows = []

        def same_filtered_scope(row: dict) -> bool:
            if normalize_name(str(row.get("playerName") or "")) != only_player_name:
                return False
            if only_home_team and normalize_team(str(row.get("homeTeam") or "")) != only_home_team:
                return False
            if only_away_team and normalize_team(str(row.get("awayTeam") or "")) != only_away_team:
                return False
            return True

        merged_rows = [row for row in existing_rows if not same_filtered_scope(row)]
        merged_rows.extend(out_rows)
        merged_payload = {
            "generatedAt": out.get("generatedAt"),
            "modelVersion": out.get("modelVersion") or existing_model_version,
            "modelType": out.get("modelType") or existing_model_type,
            "rows": merged_rows,
            "count": len(merged_rows),
        }
        write_json(latest_path, merged_payload)
    else:
        write_json(latest_path, out)
    print(f"Scored projections: {versioned_path} ({len(out_rows)} rows)")


if __name__ == "__main__":
    main()
