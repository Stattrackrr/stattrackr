#!/usr/bin/env python3
"""
Shared helpers for AFL disposals model scripts.
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import math
import os
import re
import urllib.parse
import urllib.request
from typing import Dict, Iterable, List, Optional, Tuple


ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA_DIR = os.path.join(ROOT_DIR, "data")
MODEL_DIR = os.path.join(DATA_DIR, "afl-model")


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def now_iso() -> str:
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def slug_time() -> str:
    return dt.datetime.utcnow().strftime("%Y%m%d-%H%M%S")


def read_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: str, payload: dict) -> None:
    ensure_dir(os.path.dirname(path))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=True)


def write_csv(path: str, rows: List[dict], fieldnames: List[str]) -> None:
    ensure_dir(os.path.dirname(path))
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def get_json(url: str, timeout: int = 45) -> dict:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "stattrackr-afl-model/1.0",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        data = res.read().decode("utf-8")
        return json.loads(data)


def normalize_name(value: str) -> str:
    s = str(value or "").strip().lower()
    s = s.replace("-", " ")
    s = re.sub(r"[^a-z0-9'\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def normalize_team(value: str) -> str:
    s = str(value or "").strip().lower()
    s = re.sub(r"[^a-z0-9]", "", s)
    return s


def parse_date(value: str) -> Optional[dt.date]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return dt.date.fromisoformat(raw[:10])
    except ValueError:
        return None


def to_float(value) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        n = float(value)
        return n if math.isfinite(n) else None
    s = str(value).strip()
    if not s:
        return None
    try:
        n = float(s)
        return n if math.isfinite(n) else None
    except ValueError:
        return None


def mean(nums: Iterable[float]) -> Optional[float]:
    values = [float(x) for x in nums if x is not None and math.isfinite(float(x))]
    if not values:
        return None
    return sum(values) / len(values)


def stddev(nums: Iterable[float]) -> Optional[float]:
    values = [float(x) for x in nums if x is not None and math.isfinite(float(x))]
    if len(values) < 2:
        return None
    m = sum(values) / len(values)
    var = sum((v - m) ** 2 for v in values) / (len(values) - 1)
    return math.sqrt(var)


def rolling(values: List[float], n: int) -> List[float]:
    if n <= 0:
        return []
    return values[:n]


TEAM_ALIASES: Dict[str, str] = {
    "crows": "adelaide",
    "adelaidecrows": "adelaide",
    "lions": "brisbane",
    "brisbanelions": "brisbane",
    "blues": "carlton",
    "carltonblues": "carlton",
    "magpies": "collingwood",
    "collingwoodmagpies": "collingwood",
    "bombers": "essendon",
    "essendonbombers": "essendon",
    "dockers": "fremantle",
    "fremantledockers": "fremantle",
    "cats": "geelong",
    "geelongcats": "geelong",
    "suns": "goldcoast",
    "goldcoastsuns": "goldcoast",
    "giants": "gws",
    "greaterwesternsydneygiants": "gws",
    "gwsgiants": "gws",
    "hawks": "hawthorn",
    "hawthornhawks": "hawthorn",
    "demons": "melbourne",
    "melbournedemons": "melbourne",
    "kangaroos": "northmelbourne",
    "north": "northmelbourne",
    "northmelbournekangaroos": "northmelbourne",
    "power": "portadelaide",
    "portadelaidepower": "portadelaide",
    "tigers": "richmond",
    "richmondtigers": "richmond",
    "saints": "stkilda",
    "stkildasaints": "stkilda",
    "swans": "sydney",
    "sydneyswans": "sydney",
    "eagles": "westcoast",
    "westcoasteagles": "westcoast",
    "bulldogs": "westernbulldogs",
    "footscray": "westernbulldogs",
    "westernbulldogs": "westernbulldogs",
    "footscraybulldogs": "westernbulldogs",
}

TEAM_STATE_BY_KEY: Dict[str, str] = {
    "adelaide": "SA",
    "portadelaide": "SA",
    "brisbane": "QLD",
    "goldcoast": "QLD",
    "carlton": "VIC",
    "collingwood": "VIC",
    "essendon": "VIC",
    "geelong": "VIC",
    "hawthorn": "VIC",
    "melbourne": "VIC",
    "northmelbourne": "VIC",
    "richmond": "VIC",
    "stkilda": "VIC",
    "westernbulldogs": "VIC",
    "fremantle": "WA",
    "westcoast": "WA",
    "gws": "NSW",
    "sydney": "NSW",
}

TEAM_HOME_VENUES_BY_KEY: Dict[str, set[str]] = {
    "adelaide": {"adelaideoval"},
    "portadelaide": {"adelaideoval"},
    "brisbane": {"gabba"},
    "goldcoast": {"peoplefirststadium"},
    "carlton": {"mcg", "marvelstadium"},
    "collingwood": {"mcg"},
    "essendon": {"marvelstadium", "mcg"},
    "geelong": {"gmhbastadium"},
    "hawthorn": {"mcg", "utasstadium"},
    "melbourne": {"mcg"},
    "northmelbourne": {"marvelstadium", "blundstonearena"},
    "richmond": {"mcg"},
    "stkilda": {"marvelstadium"},
    "westernbulldogs": {"marvelstadium", "marsstadium"},
    "fremantle": {"optusstadium"},
    "westcoast": {"optusstadium"},
    "gws": {"engiestadium", "manukaoval"},
    "sydney": {"scg"},
}

VENUE_ALIASES: Dict[str, str] = {
    "melbournecricketground": "mcg",
    "docklandsstadium": "marvelstadium",
    "etihadstadium": "marvelstadium",
    "telstradome": "marvelstadium",
    "thegabba": "gabba",
    "kardiniapark": "gmhbastadium",
    "perthstadium": "optusstadium",
    "metriconstadium": "peoplefirststadium",
    "sydneyshowgroundstadium": "engiestadium",
    "showgroundstadium": "engiestadium",
    "giantsstadium": "engiestadium",
    "universityoftasmaniastadium": "utasstadium",
    "yorkpark": "utasstadium",
    "belleriveoval": "blundstonearena",
    "cazalysstadium": "cazalysstadium",
}

VENUE_STATE_BY_KEY: Dict[str, str] = {
    "adelaideoval": "SA",
    "gabba": "QLD",
    "peoplefirststadium": "QLD",
    "mcg": "VIC",
    "marvelstadium": "VIC",
    "gmhbastadium": "VIC",
    "marsstadium": "VIC",
    "blundstonearena": "TAS",
    "utasstadium": "TAS",
    "optusstadium": "WA",
    "engiestadium": "NSW",
    "scg": "NSW",
    "manukaoval": "ACT",
}


def canonical_team_key(value: str) -> str:
    k = normalize_team(value)
    if not k:
        return ""
    if k in TEAM_STATE_BY_KEY:
        return k
    alias = TEAM_ALIASES.get(k)
    if alias:
        return alias
    # Fuzzy fallback.
    for base in TEAM_STATE_BY_KEY.keys():
        if base in k or k in base:
            return base
    return k


def canonical_venue_key(value: str) -> str:
    v = normalize_team(value)
    if not v:
        return ""
    if v in VENUE_STATE_BY_KEY:
        return v
    alias = VENUE_ALIASES.get(v)
    if alias:
        return alias
    for base in VENUE_STATE_BY_KEY.keys():
        if base in v or v in base:
            return base
    return v


def team_state(value: str) -> Optional[str]:
    key = canonical_team_key(value)
    return TEAM_STATE_BY_KEY.get(key)


def venue_state(value: str) -> Optional[str]:
    key = canonical_venue_key(value)
    return VENUE_STATE_BY_KEY.get(key)


def shared_home_venue_flag(team_a: str, team_b: str) -> float:
    a = TEAM_HOME_VENUES_BY_KEY.get(canonical_team_key(team_a), set())
    b = TEAM_HOME_VENUES_BY_KEY.get(canonical_team_key(team_b), set())
    if not a or not b:
        return 0.0
    return 1.0 if len(a.intersection(b)) > 0 else 0.0


def true_home_flag(team: str, opponent: str, venue: str) -> float:
    v = canonical_venue_key(venue)
    if not v:
        return 0.0
    team_home = TEAM_HOME_VENUES_BY_KEY.get(canonical_team_key(team), set())
    opp_home = TEAM_HOME_VENUES_BY_KEY.get(canonical_team_key(opponent), set())
    if v in team_home and v not in opp_home:
        return 1.0
    return 0.0


def interstate_travel_flag(team: str, venue: str) -> float:
    t_state = team_state(team)
    v_state = venue_state(venue)
    if not t_state or not v_state:
        return 0.0
    return 1.0 if t_state != v_state else 0.0


def primary_home_venue_key(team: str) -> str:
    venues = TEAM_HOME_VENUES_BY_KEY.get(canonical_team_key(team), set())
    if not venues:
        return ""
    return sorted(list(venues))[0]


def venue_keys_for_team_home_grounds(team: str) -> set:
    """
    Canonical venue keys where this team is designated home (AFL home grounds).
    Used when scoring upcoming fixtures: the match is played at the home team's venue(s).
    """
    ck = canonical_team_key(team)
    if not ck:
        return set()
    out = set()
    for raw in TEAM_HOME_VENUES_BY_KEY.get(ck, set()) or set():
        vk = canonical_venue_key(str(raw))
        if vk:
            out.add(vk)
    pk = primary_home_venue_key(team)
    if pk:
        out.add(canonical_venue_key(pk))
    return {x for x in out if x}


def read_oa_team_stats_by_team(season: int) -> Dict[str, Dict[str, float]]:
    path = os.path.join(DATA_DIR, f"afl-team-rankings-{season}-oa.json")
    if not os.path.exists(path):
        return {}
    payload = read_json(path)
    out: Dict[str, Dict[str, float]] = {}
    for row in payload.get("teams", []) or []:
        team = normalize_team(row.get("team", ""))
        stats = row.get("stats", {}) or {}
        if not team:
            continue
        mapped: Dict[str, float] = {}
        # OA stat columns from FootyWire team rankings.
        for code, key in (
            ("D", "disposals"),
            ("K", "kicks"),
            ("HB", "handballs"),
            ("CP", "contested_possessions"),
            ("UP", "uncontested_possessions"),
            ("CL", "clearances"),
            ("I50", "inside_50s"),
            ("MG", "meters_gained"),
        ):
            val = to_float(stats.get(code))
            if val is not None:
                mapped[key] = float(val)
        if mapped:
            out[team] = mapped
    return out


def read_ta_team_stats_by_team(season: int) -> Dict[str, Dict[str, float]]:
    path = os.path.join(DATA_DIR, f"afl-team-rankings-{season}-ta.json")
    if not os.path.exists(path):
        return {}
    payload = read_json(path)
    out: Dict[str, Dict[str, float]] = {}
    for row in payload.get("teams", []) or []:
        team = canonical_team_key(str(row.get("team", "")))
        stats = row.get("stats", {}) or {}
        if not team:
            continue
        mapped: Dict[str, float] = {}
        for code, key in (
            ("D", "disposals"),
            ("K", "kicks"),
            ("HB", "handballs"),
            ("CL", "clearances"),
            ("I50", "inside_50s"),
            ("MG", "meters_gained"),
        ):
            val = to_float(stats.get(code))
            if val is not None:
                mapped[key] = float(val)
        if mapped:
            out[team] = mapped
    return out


def read_oa_disposals_by_team(season: int) -> Dict[str, float]:
    raw = read_oa_team_stats_by_team(season)
    out: Dict[str, float] = {}
    for team, stats in raw.items():
        val = stats.get("disposals")
        if val is not None:
            out[team] = val
    return out


def read_dvp_disposals_by_opponent_position(season: int) -> Dict[str, Dict[str, Dict[str, float]]]:
    path = os.path.join(DATA_DIR, f"afl-dvp-{season}.json")
    if not os.path.exists(path):
        return {}
    payload = read_json(path)
    rows = payload.get("rows", []) if isinstance(payload, dict) else []
    if not isinstance(rows, list):
        return {}
    out: Dict[str, Dict[str, Dict[str, float]]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        opp = canonical_team_key(str(row.get("opponent", "")))
        pos = str(row.get("position", "")).strip().upper()
        if pos not in ("DEF", "MID", "FWD", "RUC") or not opp:
            continue
        idx_raw = row.get("indexVsLeague") if isinstance(row.get("indexVsLeague"), dict) else {}
        ppg_raw = row.get("perPlayerGame") if isinstance(row.get("perPlayerGame"), dict) else {}
        idx = to_float(idx_raw.get("disposals")) if isinstance(idx_raw, dict) else None
        ppg = to_float(ppg_raw.get("disposals")) if isinstance(ppg_raw, dict) else None
        if idx is None and ppg is None:
            continue
        if opp not in out:
            out[opp] = {}
        out[opp][pos] = {
            "index": float(idx) if idx is not None else 1.0,
            "ppg": float(ppg) if ppg is not None else 0.0,
        }
    return out


def read_dfs_usage_by_player(season: int) -> Dict[str, Dict[str, float]]:
    candidates = [
        os.path.join(DATA_DIR, f"afl-dfs-usage-{season}.json"),
        os.path.join(DATA_DIR, "afl-dfs-usage-latest.json"),
    ]
    payload = None
    for path in candidates:
        if os.path.exists(path):
            payload = read_json(path)
            break
    if not payload:
        return {}
    out: Dict[str, Dict[str, float]] = {}
    for p in payload.get("players", []) or []:
        key = normalize_name(str(p.get("name", "")))
        if not key:
            continue
        cba = to_float(p.get("cbaPct"))
        kickins = to_float(p.get("kickIns"))
        out[key] = {
            "cba_pct": float(cba) if cba is not None else 0.0,
            "kickins": float(kickins) if kickins is not None else 0.0,
        }
    return out


def map_dfs_position_group_to_role_bucket(group: str) -> Optional[str]:
    g = str(group or "").strip().lower()
    if not g:
        return None
    if "inside midfielder" in g:
        return "MID"
    if "ruck" in g:
        return "RUC"
    if "forward" in g:
        return "FWD"
    if "defender" in g or "kicker" in g:
        return "DEF"
    return None


def read_dfs_role_map_by_player(season: int) -> Dict[str, Dict[str, str]]:
    candidates = [
        os.path.join(DATA_DIR, f"afl-dfs-role-map-{season}.json"),
        os.path.join(DATA_DIR, "afl-dfs-role-map-latest.json"),
    ]
    payload = None
    for path in candidates:
        if os.path.exists(path):
            payload = read_json(path)
            break
    if not payload:
        return {}
    out: Dict[str, Dict[str, str]] = {}
    for p in payload.get("players", []) or []:
        key = normalize_name(str(p.get("name", "")))
        if not key:
            continue
        role_group = str(p.get("roleGroup", "")).strip()
        role_bucket = str(p.get("roleBucket", "")).strip().upper()
        if role_bucket not in {"DEF", "MID", "FWD", "RUC"}:
            role_bucket = map_dfs_position_group_to_role_bucket(role_group) or ""
        if role_bucket:
            out[key] = {
                "role_group": role_group,
                "role_bucket": role_bucket,
            }
    return out


def approx_team_match(target: str, teams_map: Dict[str, float]) -> Optional[float]:
    t = normalize_team(target)
    if not t:
        return None
    if t in teams_map:
        return teams_map[t]
    for key, val in teams_map.items():
        if key in t or t in key:
            return val
    return None


def implied_prob_from_american(odds_str: str) -> Optional[float]:
    s = str(odds_str or "").strip().upper()
    if not s or s == "N/A":
        return None
    try:
        n = float(s)
    except ValueError:
        return None
    if n == 0:
        return None
    if n > 0:
        return 100.0 / (n + 100.0)
    return abs(n) / (abs(n) + 100.0)


def novig_probs(over_odds: str, under_odds: str) -> Tuple[Optional[float], Optional[float]]:
    p_over = implied_prob_from_american(over_odds)
    p_under = implied_prob_from_american(under_odds)
    if p_over is None or p_under is None:
        return None, None
    total = p_over + p_under
    if total <= 0:
        return None, None
    return p_over / total, p_under / total


def normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def fetch_player_logs(
    base_url: str,
    season: int,
    player_name: str,
    team: str,
    include_quarters: bool = False,
    include_both: bool = False,
    strict_season: bool = True,
    use_disk_cache: bool = True,
    cache_ttl_minutes: int = 720,
    force_fetch: bool = False,
) -> List[dict]:
    cache_path = ""
    if use_disk_cache and not force_fetch:
        key_name = normalize_name(player_name).replace(" ", "_")
        key_team = normalize_team(team)
        cache_dir = os.path.join(MODEL_DIR, "cache", "player-logs")
        ensure_dir(cache_dir)
        cache_path = os.path.join(
            cache_dir,
            f"{season}_{key_team}_{key_name}_{'q1' if include_quarters else 'q0'}.json",
        )
        if os.path.exists(cache_path):
            try:
                age_seconds = max(0.0, (dt.datetime.now().timestamp() - os.path.getmtime(cache_path)))
                if age_seconds <= max(60.0, float(cache_ttl_minutes) * 60.0):
                    payload = read_json(cache_path)
                    games = payload.get("games", []) if isinstance(payload, dict) else []
                    if isinstance(games, list):
                        return games
            except Exception:
                pass

    params = {
        "season": str(season),
        "player_name": player_name,
        "team": team,
        "strict_season": "true" if strict_season else "false",
        "include_both": "true" if include_both else "false",
        "include_quarters": "true" if include_quarters else "false",
        "force_fetch": "1" if force_fetch else "0",
    }
    url = f"{base_url.rstrip('/')}/api/afl/player-game-logs?{urllib.parse.urlencode(params)}"
    payload = get_json(url)
    games = payload.get("games", [])
    out = games if isinstance(games, list) else []
    if use_disk_cache and cache_path:
        try:
            write_json(cache_path, {"savedAt": now_iso(), "games": out})
        except Exception:
            pass
    return out
