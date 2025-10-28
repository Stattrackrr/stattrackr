#!/usr/bin/env python
# -*- coding: utf-8 -*-

import argparse
import json
import sys
from typing import Dict

from nba_api.stats.endpoints import TeamGameLog
import requests

# Static NBA mapping (matches app/api/nba/dvp)
ABBR_TO_TEAM_ID = {
    'ATL': 1610612737, 'BOS': 1610612738, 'BKN': 1610612751, 'CHA': 1610612766, 'CHI': 1610612741,
    'CLE': 1610612739, 'DAL': 1610612742, 'DEN': 1610612743, 'DET': 1610612765, 'GSW': 1610612744,
    'HOU': 1610612745, 'IND': 1610612754, 'LAC': 1610612746, 'LAL': 1610612747, 'MEM': 1610612763,
    'MIA': 1610612748, 'MIL': 1610612749, 'MIN': 1610612750, 'NOP': 1610612740, 'NYK': 1610612752,
    'OKC': 1610612760, 'ORL': 1610612753, 'PHI': 1610612755, 'PHX': 1610612756, 'POR': 1610612757,
    'SAC': 1610612758, 'SAS': 1610612759, 'TOR': 1610612761, 'UTA': 1610612762, 'WAS': 1610612764,
}
TEAM_ID_TO_ABBR = {v: k for k, v in ABBR_TO_TEAM_ID.items()}

BUCKETS_KEYS = ['PG', 'SG', 'SF', 'PF', 'C']

import re

def norm_name(s: str) -> str:
    s = (s or '').lower()
    s = re.sub(r"[^a-z\s]", ' ', s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b", ' ', s)
    s = re.sub(r"\s+", ' ', s).strip()
    return s


def fetch_depth_chart_buckets(base_url: str, team_abbr: str) -> Dict[str, str]:
    try:
        url = f"{base_url}/api/depth-chart?team={team_abbr}"
        r = requests.get(url, timeout=10)
        if r.status_code != 200:
            return {}
        js = r.json()
        dc = js.get('depthChart') or {}
        mapping: Dict[str, str] = {}
        for k in BUCKETS_KEYS:
            arr = dc.get(k) or []
            for p in arr:
                name = p if isinstance(p, str) else (p.get('name') if isinstance(p, dict) else None)
                if name:
                    mapping[norm_name(name)] = k
        return mapping
    except Exception:
        return {}


def season_label_from_year(y: int) -> str:
    return f"{y}-{str((y + 1) % 100).zfill(2)}"


NBA_BASE = "https://stats.nba.com/stats"
NBA_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.nba.com",
    "Referer": "https://www.nba.com/stats/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "x-nba-stats-origin": "stats",
    "x-nba-stats-token": "true",
}


def nba_fetch(path_and_query: str) -> dict:
    url = f"{NBA_BASE}/{path_and_query}"
    r = requests.get(url, headers=NBA_HEADERS, timeout=15)
    r.raise_for_status()
    return r.json()


def idx(headers: list, *names: str) -> int:
    lower = [str(h or '').lower() for h in headers]
    for n in names:
        try:
            i = lower.index(n.lower())
            if i >= 0:
                return i
        except ValueError:
            pass
    return -1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--team', required=True, help='Team abbreviation, e.g. MIL')
    ap.add_argument('--season', type=int, required=True, help='Season start year, e.g. 2025 for 2025-26')
    ap.add_argument('--games', type=int, default=20, help='Max games to sample (newest first)')
    ap.add_argument('--metric', default='pts', choices=['pts','reb','ast','fg3m','stl','blk'])
    ap.add_argument('--host', default='http://localhost:3000', help='Base URL for local depth-chart API')
    args = ap.parse_args()

    team = (args.team or '').upper()
    team_id = ABBR_TO_TEAM_ID.get(team)
    if not team_id:
        print(json.dumps({'success': False, 'error': f'Unknown team: {team}'}))
        return 0

    season_label = season_label_from_year(int(args.season))

    def compute_for_season(start_year: int):
        s_label = season_label_from_year(int(start_year))
        gl_local = TeamGameLog(team_id=team_id, season=s_label, season_type_all_star='Regular Season')
        dfl = gl_local.get_data_frames()[0]
        gids = [str(x) for x in list(dfl['Game_ID'])][: max(1, min(args.games, 50))]

        totals_l = {k: 0.0 for k in BUCKETS_KEYS}
        processed_l = 0

        for gid in gids:
            # Fetch boxscore via stats.nba.com (more reliable than nba_api wrapper here)
            try:
                bs = nba_fetch(f"boxscoretraditionalv2?GameID={gid}&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0&RangeType=0")
            except Exception:
                continue
            rs = bs.get('resultSets') or []
            pset = None
            for rset in rs:
                if str(rset.get('name') or '').lower().find('player') >= 0:
                    pset = rset
                    break
            if pset is None and rs:
                pset = rs[0]
            headers = pset.get('headers') if pset else []
            rows = pset.get('rowSet') if pset else []
            if not headers or not rows:
                continue

            iTeamId = idx(headers, 'TEAM_ID')
            iTeamAbbr = idx(headers, 'TEAM_ABBREVIATION')
            iPlayer = idx(headers, 'PLAYER_NAME')
            iStartPos = idx(headers, 'START_POSITION')
            iPTS = idx(headers, 'PTS')
            iREB = idx(headers, 'REB')
            iAST = idx(headers, 'AST')
            iFG3M = idx(headers, 'FG3M')
            iSTL = idx(headers, 'STL')
            iBLK = idx(headers, 'BLK')

            # Determine opponent team for the target team
            opp_row = next((r for r in rows if int(r[iTeamId]) != team_id), None)
            if not opp_row:
                continue
            opp_id = int(opp_row[iTeamId])
            opp_abbr = TEAM_ID_TO_ABBR.get(opp_id) or str(opp_row[iTeamAbbr] or '')
            if not opp_abbr:
                continue

            depth_map = fetch_depth_chart_buckets(args.host, opp_abbr)
            game_buckets = {k: 0.0 for k in BUCKETS_KEYS}

            # Iterate opponent rows only
            for r in rows:
                if int(r[iTeamId]) != opp_id:
                    continue
                player_name = str(r[iPlayer] or '')
                start_pos = str(r[iStartPos] or '').upper()

                if args.metric == 'pts': val = float(r[iPTS] or 0)
                elif args.metric == 'reb': val = float(r[iREB] or 0)
                elif args.metric == 'ast': val = float(r[iAST] or 0)
                elif args.metric == 'fg3m': val = float(r[iFG3M] or 0)
                elif args.metric == 'stl': val = float(r[iSTL] or 0)
                elif args.metric == 'blk': val = float(r[iBLK] or 0)
                else: val = float(r[iPTS] or 0)
                if val == 0:
                    continue

                key = depth_map.get(norm_name(player_name))
                if key in BUCKETS_KEYS:
                    game_buckets[key] += val
                    continue

                # Heuristic single-bucket fallback
                # Note: Using only available columns here
                ast = float(r[iAST] or 0)
                tov = 0.0
                fg3a = 0.0
                reb = float(r[iREB] or 0)
                blk = float(r[iBLK] or 0)

                if start_pos == 'G':
                    bucket = 'PG' if (ast >= 5 or tov >= 4) else 'SG'
                elif start_pos == 'F':
                    bucket = 'PF' if (reb >= 8 or blk >= 2) else 'SF'
                elif start_pos == 'C':
                    bucket = 'C'
                else:
                    bucket = 'PF' if reb >= 7 else 'C'
                game_buckets[bucket] += val

            for k in BUCKETS_KEYS:
                totals_l[k] += game_buckets[k]
            processed_l += 1

        per_game_l = {k: (totals_l[k] / processed_l) if processed_l else 0.0 for k in BUCKETS_KEYS}
        return s_label, processed_l, totals_l, per_game_l

    # Try requested season first
    s1_label, processed, totals, per_game = compute_for_season(args.season)

    # Fallback to previous season if no processed games
    if processed == 0:
        s2_label, processed2, totals2, per_game2 = compute_for_season(args.season - 1)
        if processed2 > 0:
            season_label = s2_label
            processed = processed2
            totals = totals2
            per_game = per_game2

    out = {
        'success': True,
        'team': team,
        'season': season_label,
        'metric': args.metric,
        'sample_games': processed,
        'perGame': per_game,
        'totals': totals,
    }
    print(json.dumps(out))
    return 0


if __name__ == '__main__':
    sys.exit(main())
