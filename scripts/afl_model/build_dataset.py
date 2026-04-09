#!/usr/bin/env python3
"""
Build AFL disposals training dataset from live API game logs.

Usage:
  python scripts/afl_model/build_dataset.py --base-url http://localhost:3000
"""

from __future__ import annotations

import argparse
import concurrent.futures
import os
from typing import Dict, List, Optional, Tuple

from common import (
    DATA_DIR,
    MODEL_DIR,
    canonical_team_key,
    canonical_venue_key,
    ensure_dir,
    interstate_travel_flag,
    mean,
    normalize_name,
    now_iso,
    parse_date,
    read_dvp_disposals_by_opponent_position,
    read_json,
    read_dfs_usage_by_player,
    read_dfs_role_map_by_player,
    read_oa_team_stats_by_team,
    read_ta_team_stats_by_team,
    rolling,
    shared_home_venue_flag,
    slug_time,
    stddev,
    to_float,
    true_home_flag,
    write_csv,
    write_json,
    fetch_player_logs,
)


FEATURE_COLUMNS = [
    "roll3_mean",
    "roll5_mean",
    "roll10_mean",
    "roll5_std",
    "roll10_std",
    "lag1",
    "games_history",
    "tog_roll5_mean",
    "cp_roll5_mean",
    "up_roll5_mean",
    "cl_roll5_mean",
    "i50_roll5_mean",
    "mg_roll5_mean",
    "rest_days",
    "rest_short_le5",
    "rest_normal_6_8",
    "rest_long_ge9",
    "post_bye_team",
    "is_true_home",
    "is_shared_home_away_venue",
    "is_interstate_travel",
    "venue_player_disp_last5",
    "venue_player_tog_last5",
    "selection_low_tog_rate_last5",
    "selection_tog_std_last5",
    "selection_games_since_low_tog",
    "opp_role_disp_index",
    "opp_role_disp_ppg",
    "team_ta_disposals",
    "opp_ta_disposals",
    "game_pace_disposals_avg",
    "opp_allow_disposals",
    "opp_allow_kicks",
    "opp_allow_handballs",
    "opp_allow_cp",
    "opp_allow_up",
    "opp_allow_clearances",
    "opp_allow_i50",
    "opp_allow_mg",
    "dfs_cba_pct",
    "dfs_kickins",
    "delta_disp_3v10",
    "delta_tog_3v10",
    "delta_cp_3v10",
    "delta_up_3v10",
    "delta_cl_3v10",
    "cba_momentum_proxy",
    "role_is_def",
    "role_is_mid",
    "role_is_fwd",
    "role_is_ruc",
    "lineup_role_available",
    "lineup_role_confidence",
    "dfs_role_key_fwd",
    "dfs_role_gen_fwd",
    "dfs_role_ins_mid",
    "dfs_role_ruck",
    "dfs_role_wng_def",
    "dfs_role_gen_def",
    "dfs_role_des_kck",
    "dfs_role_unclassified",
]


def build_player_pool(seasons: List[int]) -> Dict[str, Dict[str, str]]:
    players: Dict[str, Dict[str, str]] = {}
    for season in seasons:
        path = os.path.join(DATA_DIR, f"afl-league-player-stats-{season}.json")
        if not os.path.exists(path):
            continue
        payload = read_json(path)
        for p in payload.get("players", []) or []:
            name = str(p.get("name", "")).strip()
            team = str(p.get("team", "")).strip()
            if not name or not team:
                continue
            key = normalize_name(name)
            if key not in players:
                players[key] = {"name": name, "team": team}
    return players


def game_date_key(g: dict, fallback_idx: int) -> Tuple[int, int, int]:
    d = parse_date(str(g.get("date") or g.get("game_date") or ""))
    if d is None:
        # Keep stable ordering even when date is missing.
        return (1900, 1, fallback_idx)
    return (d.year, d.month, d.day)


def safe_feature(v, default: float = 0.0) -> float:
    n = to_float(v)
    return float(default if n is None else n)


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


def infer_role_bucket(history: List[dict]) -> str:
    if not history:
        return "MID"
    recent = history[-5:]
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


def build_rows_for_player(
    player_name: str,
    team: str,
    season: int,
    games: List[dict],
    oa_stats_by_team: Dict[str, Dict[str, float]],
    ta_stats_by_team: Dict[str, Dict[str, float]],
    dvp_by_opp_pos: Dict[str, Dict[str, Dict[str, float]]],
    dfs_usage_by_player: Dict[str, Dict[str, float]],
    dfs_role_by_player: Dict[str, Dict[str, str]],
) -> List[dict]:
    rows: List[dict] = []
    if not games:
        return rows

    # API is usually newest -> oldest; we need oldest -> newest for leak-free features.
    sorted_games = sorted(
        games,
        key=lambda g: game_date_key(g, int(to_float(g.get("game_number")) or 0)),
    )

    history: List[dict] = []
    for g in sorted_games:
        disp = to_float(g.get("disposals"))
        if disp is None:
            continue
        prev_disposals = [to_float(x.get("disposals")) for x in history]
        prev_disposals = [x for x in prev_disposals if x is not None]
        if len(prev_disposals) < 3:
            history.append(g)
            continue

        tog_hist = [to_float(x.get("percent_played")) for x in history]
        cp_hist = [to_float(x.get("contested_possessions")) for x in history]
        up_hist = [to_float(x.get("uncontested_possessions")) for x in history]
        cl_hist = [to_float(x.get("clearances")) for x in history]
        i50_hist = [to_float(x.get("inside_50s")) for x in history]
        mg_hist = [to_float(x.get("meters_gained")) for x in history]
        roll5_prev_disp = float(mean(rolling(prev_disposals[::-1], 5)) or 0.0)
        roll5_prev_tog = float(mean(rolling([x for x in tog_hist if x is not None][::-1], 5)) or 0.0)

        game_date = parse_date(str(g.get("date") or g.get("game_date") or ""))
        prev_date = parse_date(str(history[-1].get("date") or history[-1].get("game_date") or "")) if history else None
        rest_days = None
        if game_date and prev_date:
            rest_days = (game_date - prev_date).days
        rest_days_value = float(rest_days if rest_days is not None else 7.0)
        rest_short_le5 = 1.0 if rest_days_value <= 5.0 else 0.0
        rest_normal_6_8 = 1.0 if 6.0 <= rest_days_value <= 8.0 else 0.0
        rest_long_ge9 = 1.0 if rest_days_value >= 9.0 else 0.0
        post_bye_team = 1.0 if rest_days_value >= 11.0 else 0.0

        opponent = str(g.get("opponent") or "").strip()
        team_key = canonical_team_key(team)
        opponent_key = canonical_team_key(opponent)
        venue = str(g.get("venue") or "").strip()
        venue_key = canonical_venue_key(venue)
        is_shared_home_away_venue = shared_home_venue_flag(team, opponent)
        is_true_home = true_home_flag(team, opponent, venue_key)
        is_interstate_travel = interstate_travel_flag(team, venue_key)
        opp_allow_disposals = oa_value_for_opponent(opponent, oa_stats_by_team, "disposals")
        opp_allow_kicks = oa_value_for_opponent(opponent, oa_stats_by_team, "kicks")
        opp_allow_handballs = oa_value_for_opponent(opponent, oa_stats_by_team, "handballs")
        opp_allow_cp = oa_value_for_opponent(opponent, oa_stats_by_team, "contested_possessions")
        opp_allow_up = oa_value_for_opponent(opponent, oa_stats_by_team, "uncontested_possessions")
        opp_allow_clearances = oa_value_for_opponent(opponent, oa_stats_by_team, "clearances")
        opp_allow_i50 = oa_value_for_opponent(opponent, oa_stats_by_team, "inside_50s")
        opp_allow_mg = oa_value_for_opponent(opponent, oa_stats_by_team, "meters_gained")

        usage = dfs_usage_by_player.get(normalize_name(player_name), {})
        dfs_cba_pct = to_float(usage.get("cba_pct")) or 0.0
        dfs_kickins = to_float(usage.get("kickins")) or 0.0
        dfs_role = dfs_role_by_player.get(normalize_name(player_name), {})
        dfs_role_bucket = str(dfs_role.get("role_bucket") or "").strip().upper()
        dfs_role_group = str(dfs_role.get("role_group") or "").strip()
        dfs_role_flags = dfs_role_group_flags(dfs_role_group)

        venue_games = [
            x for x in history if canonical_venue_key(str(x.get("venue") or "")) == venue_key and venue_key
        ]
        venue_prev_disposals = [to_float(x.get("disposals")) for x in venue_games]
        venue_prev_disposals = [x for x in venue_prev_disposals if x is not None]
        venue_prev_tog = [to_float(x.get("percent_played")) for x in venue_games]
        venue_prev_tog = [x for x in venue_prev_tog if x is not None]
        if not venue_games:
            venue_player_disp_last5 = roll5_prev_disp
            venue_player_tog_last5 = roll5_prev_tog
        else:
            venue_player_disp_last5 = float(mean(rolling(venue_prev_disposals[::-1], 5)) or 0.0)
            venue_player_tog_last5 = float(mean(rolling(venue_prev_tog[::-1], 5)) or 0.0)

        recent_tog = [to_float(x.get("percent_played")) for x in history[-5:]]
        recent_tog = [x for x in recent_tog if x is not None]
        low_tog_count = len([x for x in recent_tog if x < 65.0])
        selection_low_tog_rate_last5 = float(low_tog_count / len(recent_tog)) if recent_tog else 0.0
        selection_tog_std_last5 = float(stddev(recent_tog) or 0.0)
        games_since_low_tog = 10.0
        for idx, tg in enumerate([to_float(x.get("percent_played")) for x in history[::-1]]):
            if tg is None:
                continue
            if tg < 65.0:
                games_since_low_tog = float(idx)
                break

        role_bucket = dfs_role_bucket if dfs_role_bucket in {"DEF", "MID", "FWD", "RUC"} else infer_role_bucket(history)
        role_flags = role_feature_flags(role_bucket)
        opp_role = dvp_by_opp_pos.get(opponent_key, {}).get(role_bucket, {})
        opp_role_disp_index = to_float(opp_role.get("index"))
        opp_role_disp_ppg = to_float(opp_role.get("ppg"))

        team_ta_disposals = to_float((ta_stats_by_team.get(team_key, {}) or {}).get("disposals"))
        opp_ta_disposals = to_float((ta_stats_by_team.get(opponent_key, {}) or {}).get("disposals"))
        game_pace_disposals_avg = mean([x for x in [team_ta_disposals, opp_ta_disposals] if x is not None])

        delta_disp_3v10 = (mean(rolling(prev_disposals[::-1], 3)) or 0.0) - (mean(rolling(prev_disposals[::-1], 10)) or 0.0)
        delta_tog_3v10 = (mean(rolling([x for x in tog_hist if x is not None][::-1], 3)) or 0.0) - (
            mean(rolling([x for x in tog_hist if x is not None][::-1], 10)) or 0.0
        )
        delta_cp_3v10 = (mean(rolling([x for x in cp_hist if x is not None][::-1], 3)) or 0.0) - (
            mean(rolling([x for x in cp_hist if x is not None][::-1], 10)) or 0.0
        )
        delta_up_3v10 = (mean(rolling([x for x in up_hist if x is not None][::-1], 3)) or 0.0) - (
            mean(rolling([x for x in up_hist if x is not None][::-1], 10)) or 0.0
        )
        delta_cl_3v10 = (mean(rolling([x for x in cl_hist if x is not None][::-1], 3)) or 0.0) - (
            mean(rolling([x for x in cl_hist if x is not None][::-1], 10)) or 0.0
        )
        cba_momentum_proxy = (float(dfs_cba_pct) / 100.0) * float(delta_cl_3v10)

        row = {
            "player_name": player_name,
            "team": team,
            "season": season,
            "round": str(g.get("round") or ""),
            "date": str(g.get("date") or g.get("game_date") or ""),
            "opponent": opponent,
            "target_disposals": disp,
            "roll3_mean": safe_feature(mean(rolling(prev_disposals[::-1], 3))),
            "roll5_mean": safe_feature(mean(rolling(prev_disposals[::-1], 5))),
            "roll10_mean": safe_feature(mean(rolling(prev_disposals[::-1], 10))),
            "roll5_std": safe_feature(stddev(rolling(prev_disposals[::-1], 5))),
            "roll10_std": safe_feature(stddev(rolling(prev_disposals[::-1], 10))),
            "lag1": safe_feature(prev_disposals[-1] if prev_disposals else 0.0),
            "games_history": float(len(prev_disposals)),
            "tog_roll5_mean": safe_feature(mean(rolling([x for x in tog_hist if x is not None][::-1], 5))),
            "cp_roll5_mean": safe_feature(mean(rolling([x for x in cp_hist if x is not None][::-1], 5))),
            "up_roll5_mean": safe_feature(mean(rolling([x for x in up_hist if x is not None][::-1], 5))),
            "cl_roll5_mean": safe_feature(mean(rolling([x for x in cl_hist if x is not None][::-1], 5))),
            "i50_roll5_mean": safe_feature(mean(rolling([x for x in i50_hist if x is not None][::-1], 5))),
            "mg_roll5_mean": safe_feature(mean(rolling([x for x in mg_hist if x is not None][::-1], 5))),
            "rest_days": safe_feature(rest_days, 7.0),
            "rest_short_le5": rest_short_le5,
            "rest_normal_6_8": rest_normal_6_8,
            "rest_long_ge9": rest_long_ge9,
            "post_bye_team": post_bye_team,
            "is_true_home": is_true_home,
            "is_shared_home_away_venue": is_shared_home_away_venue,
            "is_interstate_travel": is_interstate_travel,
            "venue_player_disp_last5": safe_feature(venue_player_disp_last5, 0.0),
            "venue_player_tog_last5": safe_feature(venue_player_tog_last5, 0.0),
            "selection_low_tog_rate_last5": safe_feature(selection_low_tog_rate_last5, 0.0),
            "selection_tog_std_last5": safe_feature(selection_tog_std_last5, 0.0),
            "selection_games_since_low_tog": safe_feature(games_since_low_tog, 10.0),
            "opp_role_disp_index": safe_feature(opp_role_disp_index, 1.0),
            "opp_role_disp_ppg": safe_feature(opp_role_disp_ppg, 0.0),
            "team_ta_disposals": safe_feature(team_ta_disposals, 0.0),
            "opp_ta_disposals": safe_feature(opp_ta_disposals, 0.0),
            "game_pace_disposals_avg": safe_feature(game_pace_disposals_avg, 0.0),
            "opp_allow_disposals": safe_feature(opp_allow_disposals, 0.0),
            "opp_allow_kicks": safe_feature(opp_allow_kicks, 0.0),
            "opp_allow_handballs": safe_feature(opp_allow_handballs, 0.0),
            "opp_allow_cp": safe_feature(opp_allow_cp, 0.0),
            "opp_allow_up": safe_feature(opp_allow_up, 0.0),
            "opp_allow_clearances": safe_feature(opp_allow_clearances, 0.0),
            "opp_allow_i50": safe_feature(opp_allow_i50, 0.0),
            "opp_allow_mg": safe_feature(opp_allow_mg, 0.0),
            "dfs_cba_pct": safe_feature(dfs_cba_pct, 0.0),
            "dfs_kickins": safe_feature(dfs_kickins, 0.0),
            "delta_disp_3v10": safe_feature(delta_disp_3v10, 0.0),
            "delta_tog_3v10": safe_feature(delta_tog_3v10, 0.0),
            "delta_cp_3v10": safe_feature(delta_cp_3v10, 0.0),
            "delta_up_3v10": safe_feature(delta_up_3v10, 0.0),
            "delta_cl_3v10": safe_feature(delta_cl_3v10, 0.0),
            "cba_momentum_proxy": safe_feature(cba_momentum_proxy, 0.0),
            "role_is_def": role_flags["role_is_def"],
            "role_is_mid": role_flags["role_is_mid"],
            "role_is_fwd": role_flags["role_is_fwd"],
            "role_is_ruc": role_flags["role_is_ruc"],
            # Historical training rows do not have confirmed lineup-role snapshots.
            "lineup_role_available": 0.0,
            "lineup_role_confidence": 0.25,
            "dfs_role_key_fwd": dfs_role_flags["dfs_role_key_fwd"],
            "dfs_role_gen_fwd": dfs_role_flags["dfs_role_gen_fwd"],
            "dfs_role_ins_mid": dfs_role_flags["dfs_role_ins_mid"],
            "dfs_role_ruck": dfs_role_flags["dfs_role_ruck"],
            "dfs_role_wng_def": dfs_role_flags["dfs_role_wng_def"],
            "dfs_role_gen_def": dfs_role_flags["dfs_role_gen_def"],
            "dfs_role_des_kck": dfs_role_flags["dfs_role_des_kck"],
            "dfs_role_unclassified": dfs_role_flags["dfs_role_unclassified"],
        }
        rows.append(row)
        history.append(g)

    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:3000")
    parser.add_argument("--seasons", default="2026,2025,2024")
    parser.add_argument("--concurrency", type=int, default=50)
    parser.add_argument("--batch-size", type=int, default=50)
    args = parser.parse_args()

    seasons = [int(x.strip()) for x in args.seasons.split(",") if x.strip()]
    players = build_player_pool(seasons)
    # Use previous-season OA for training rows to avoid look-ahead leakage within season.
    oa_maps = {}
    ta_maps = {}
    dvp_maps = {}
    for season in seasons:
        prev_map = read_oa_team_stats_by_team(season - 1)
        curr_map = read_oa_team_stats_by_team(season)
        oa_maps[season] = prev_map if prev_map else curr_map
        prev_ta = read_ta_team_stats_by_team(season - 1)
        curr_ta = read_ta_team_stats_by_team(season)
        ta_maps[season] = prev_ta if prev_ta else curr_ta
        dvp_maps[season] = read_dvp_disposals_by_opponent_position(season) or read_dvp_disposals_by_opponent_position(
            season - 1
        )
    dfs_usage_maps = {season: read_dfs_usage_by_player(season) for season in seasons}
    dfs_role_maps = {season: read_dfs_role_map_by_player(season) for season in seasons}
    out_rows: List[dict] = []

    tasks: List[Tuple[str, str, int]] = []
    for p in players.values():
        name = p["name"]
        team = p["team"]
        for season in seasons:
            tasks.append((name, team, season))

    batch_size = max(1, int(args.batch_size))
    max_workers = max(1, int(args.concurrency))

    def run_task(task: Tuple[str, str, int]) -> List[dict]:
        name, team, season = task
        try:
            games = fetch_player_logs(args.base_url, season, name, team, include_quarters=True)
        except Exception:
            return []
        return build_rows_for_player(
            name,
            team,
            season,
            games,
            oa_maps.get(season, {}),
            ta_maps.get(season, {}),
            dvp_maps.get(season, {}),
            dfs_usage_maps.get(season, {}),
            dfs_role_maps.get(season, {}),
        )

    for i in range(0, len(tasks), batch_size):
        batch = tasks[i : i + batch_size]
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(run_task, task) for task in batch]
            for fut in concurrent.futures.as_completed(futures):
                try:
                    rows = fut.result()
                except Exception:
                    rows = []
                if rows:
                    out_rows.extend(rows)

    ts = slug_time()
    ensure_dir(MODEL_DIR)
    dataset_dir = os.path.join(MODEL_DIR, "datasets")
    ensure_dir(dataset_dir)

    csv_path = os.path.join(dataset_dir, f"afl-disposals-train-{ts}.csv")
    json_path = os.path.join(dataset_dir, "latest-dataset.json")
    meta_path = os.path.join(dataset_dir, f"afl-disposals-train-{ts}.meta.json")

    fieldnames = [
        "player_name",
        "team",
        "season",
        "round",
        "date",
        "opponent",
        *FEATURE_COLUMNS,
        "target_disposals",
    ]
    write_csv(csv_path, out_rows, fieldnames)
    write_json(json_path, {"generatedAt": now_iso(), "rows": len(out_rows), "csvPath": csv_path})
    write_json(
        meta_path,
        {
            "generatedAt": now_iso(),
            "rows": len(out_rows),
            "seasons": seasons,
            "concurrency": max_workers,
            "batchSize": batch_size,
            "featureColumns": FEATURE_COLUMNS,
            "datasetCsvPath": csv_path,
        },
    )
    print(f"Built dataset: {csv_path} ({len(out_rows)} rows)")


if __name__ == "__main__":
    main()
