"""Load every dataset the engine uses, record provenance, and validate.

The DataStore is read-only. Each dataset is loaded from the files that exist;
missing or unparsable files are recorded as validation issues rather than
raising, so the pipeline can fail closed per feature instead of crashing.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from nbl_engine.config import Thresholds
from nbl_engine.ingest.teams import TeamRegistry
from nbl_engine.ingest.timeutil import hours_between, parse_iso
from nbl_engine.logging_utils import LOG
from nbl_engine.models.raw import (
    GameLogsIndexFile,
    GameOddsHistoryFile,
    InjuriesFile,
    LadderFile,
    LeaguePlayerStatsFile,
    LineupFile,
    PlayerLogFile,
    PropHistoryFile,
    PropSnapshotFile,
    RefreshStamp,
    RostersByTeamFile,
    ScheduleFile,
    ShotChartDefenseFile,
    ShotChartPlayerFile,
)
from nbl_engine.paths import DataPaths

def discover_player_log_years(logs_dir: Path) -> list[int]:
    """Years present as `*-YYYY.json` under player-logs/."""
    years: set[int] = set()
    if not logs_dir.exists():
        return []
    for path in logs_dir.glob("*.json"):
        tail = path.stem.rsplit("-", 1)[-1]
        if len(tail) == 4 and tail.isdigit():
            years.add(int(tail))
    return sorted(years)


@dataclass
class DatasetStatus:
    name: str
    path: str
    present: bool
    rows: int = 0
    as_of: str | None = None
    issues: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "path": self.path,
            "present": self.present,
            "rows": self.rows,
            "as_of": self.as_of,
            "issues": list(self.issues),
        }


def _read_json(path: Path) -> Any:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _load_model(path: Path, model: type[M], status: DatasetStatus) -> M | None:
    if not path.exists():
        status.present = False
        status.issues.append("missing")
        return None
    status.present = True
    try:
        return model.model_validate(_read_json(path))
    except (json.JSONDecodeError, OSError) as exc:
        status.issues.append(f"unreadable: {exc}")
    except ValidationError as exc:
        status.issues.append(f"schema: {exc.error_count()} error(s): {exc.errors()[0].get('msg', '')}")
    return None


@dataclass
class DataStore:
    """All loaded datasets for a run plus their validation statuses."""

    paths: DataPaths
    cfg: Thresholds
    run_time: datetime

    refresh_stamp: RefreshStamp | None = None
    schedules: dict[int, ScheduleFile] = field(default_factory=dict)
    ladder: LadderFile | None = None
    rosters: RostersByTeamFile | None = None
    league_stats: LeaguePlayerStatsFile | None = None
    injuries: InjuriesFile | None = None
    logs_index: dict[int, GameLogsIndexFile] = field(default_factory=dict)
    player_logs: dict[tuple[str, int], PlayerLogFile] = field(default_factory=dict)
    prop_snapshots: dict[str, PropSnapshotFile] = field(default_factory=dict)  # by gameKey
    prop_history: dict[str, PropHistoryFile] = field(default_factory=dict)
    game_odds_history: dict[str, GameOddsHistoryFile] = field(default_factory=dict)
    shot_players: dict[str, ShotChartPlayerFile] = field(default_factory=dict)  # by file stem
    shot_defense: dict[str, ShotChartDefenseFile] = field(default_factory=dict)  # by team code
    lineups: dict[str, LineupFile] = field(default_factory=dict)  # by fixtureId
    teams: TeamRegistry = field(default_factory=TeamRegistry)
    statuses: dict[str, DatasetStatus] = field(default_factory=dict)

    # ------------------------------------------------------------- loading
    @classmethod
    def load(cls, paths: DataPaths, cfg: Thresholds, run_time: datetime) -> "DataStore":
        store = cls(paths=paths, cfg=cfg, run_time=run_time)
        discovered = discover_player_log_years(paths.player_logs_dir)
        years = sorted({cfg.seasons.current_year, *cfg.seasons.h2h_prior_years, *discovered})
        store._load_stamp()
        store._load_schedules(years)
        store._load_season_files()
        store._load_player_logs(years)
        store._load_odds()
        store._load_shot_charts()
        store._load_lineups()
        store._validate_cross()
        return store

    def _status(self, name: str, path: Path) -> DatasetStatus:
        st = DatasetStatus(name=name, path=str(path.relative_to(self.paths.root)) if path.is_relative_to(self.paths.root) else str(path), present=False)
        self.statuses[name] = st
        return st

    def _load_stamp(self) -> None:
        st = self._status("refresh_stamp", self.paths.refresh_stamp)
        self.refresh_stamp = _load_model(self.paths.refresh_stamp, RefreshStamp, st)
        if self.refresh_stamp:
            st.rows = 1
            st.as_of = self.refresh_stamp.updatedAt

    def _load_schedules(self, years: list[int]) -> None:
        for year in years:
            st = self._status(f"schedule_{year}", self.paths.schedule(year))
            sched = _load_model(self.paths.schedule(year), ScheduleFile, st)
            if sched:
                self.schedules[year] = sched
                st.rows = len(sched.games)
                st.as_of = sched.generatedAt
        current = self.schedules.get(self.cfg.seasons.current_year)
        if current:
            self.teams = TeamRegistry.from_schedule(current.games)
        else:
            # fall back to any schedule so team resolution still works
            for sched in self.schedules.values():
                self.teams = TeamRegistry.from_schedule(sched.games)
                break

    def _load_season_files(self) -> None:
        year = self.cfg.seasons.current_year
        st = self._status("ladder", self.paths.ladder(year))
        self.ladder = _load_model(self.paths.ladder(year), LadderFile, st)
        if self.ladder:
            st.rows, st.as_of = len(self.ladder.teams), self.ladder.generatedAt

        st = self._status("rosters_by_team", self.paths.rosters_by_team(year))
        self.rosters = _load_model(self.paths.rosters_by_team(year), RostersByTeamFile, st)
        if self.rosters:
            st.rows, st.as_of = sum(len(t.players) for t in self.rosters.teams), self.rosters.generatedAt

        st = self._status("league_player_stats", self.paths.league_player_stats(year))
        self.league_stats = _load_model(self.paths.league_player_stats(year), LeaguePlayerStatsFile, st)
        if self.league_stats:
            st.rows, st.as_of = len(self.league_stats.players), self.league_stats.generatedAt

        st = self._status("injuries", self.paths.injuries)
        self.injuries = _load_model(self.paths.injuries, InjuriesFile, st)
        if self.injuries:
            st.rows, st.as_of = len(self.injuries.injuries), self.injuries.generatedAt

    def _load_player_logs(self, years: list[int]) -> None:
        for year in years:
            idx_path = self.paths.game_logs_index(year)
            st = self._status(f"player_logs_{year}", self.paths.player_logs_dir)
            index = _load_model(idx_path, GameLogsIndexFile, DatasetStatus(name="idx", path=str(idx_path), present=False))
            if index:
                self.logs_index[year] = index
                files = [self.paths.root / p.cacheFile for p in index.players]
            else:
                files = sorted(self.paths.player_logs_dir.glob(f"*-{year}.json")) if self.paths.player_logs_dir.exists() else []
            if not files:
                st.present = False
                st.issues.append("missing")
                continue
            st.present = True
            rows = 0
            newest: str | None = None
            bad = 0
            for file in files:
                sub = DatasetStatus(name=file.name, path=str(file), present=False)
                log = _load_model(file, PlayerLogFile, sub)
                if not log:
                    bad += 1
                    continue
                self.player_logs[(log.playerId, year)] = log
                rows += len(log.games)
                if log.generatedAt and (newest is None or log.generatedAt > newest):
                    newest = log.generatedAt
                for g in log.games:
                    self.teams.learn_alias(g.opponent, g.opponentCode)
                    self.teams.learn_alias(g.team, g.teamCode)
            st.rows = rows
            st.as_of = newest
            if bad:
                st.issues.append(f"{bad} log file(s) unreadable")

    def _load_odds(self) -> None:
        st = self._status("player_prop_lines", self.paths.prop_lines_dir)
        if self.paths.prop_lines_dir.exists():
            st.present = True
            newest: str | None = None
            skipped_other = 0
            for file in sorted(self.paths.prop_lines_dir.glob("*.json")):
                sub = DatasetStatus(name=file.name, path=str(file), present=False)
                snap = _load_model(file, PropSnapshotFile, sub)
                if not snap:
                    st.issues.append(f"{file.name}: {'; '.join(sub.issues)}")
                    continue
                # the directory is shared with other leagues: keep NBL games only
                if self.teams.resolve(snap.homeTeam) is None or self.teams.resolve(snap.awayTeam) is None:
                    skipped_other += 1
                    continue
                self.prop_snapshots[snap.gameKey] = snap
                if newest is None or snap.capturedAt > newest:
                    newest = snap.capturedAt
            st.rows = len(self.prop_snapshots)
            st.as_of = newest
            if skipped_other:
                st.issues.append(f"{skipped_other} non-NBL snapshot file(s) ignored")
        else:
            st.issues.append("missing")

        st = self._status("player_prop_history", self.paths.prop_history_dir)
        if self.paths.prop_history_dir.exists():
            st.present = True
            for file in sorted(self.paths.prop_history_dir.glob("*.json")):
                sub = DatasetStatus(name=file.name, path=str(file), present=False)
                hist = _load_model(file, PropHistoryFile, sub)
                if hist:
                    self.prop_history[hist.gameKey] = hist
                else:
                    st.issues.append(f"{file.name}: {'; '.join(sub.issues)}")
            st.rows = len(self.prop_history)
            st.as_of = max((h.lastCapturedAt for h in self.prop_history.values()), default=None)
        else:
            st.issues.append("missing (no timestamped odds history yet)")

        st = self._status("game_odds_history", self.paths.game_odds_history_dir)
        if self.paths.game_odds_history_dir.exists():
            st.present = True
            for file in sorted(self.paths.game_odds_history_dir.glob("*.json")):
                sub = DatasetStatus(name=file.name, path=str(file), present=False)
                hist = _load_model(file, GameOddsHistoryFile, sub)
                if hist:
                    self.game_odds_history[hist.gameKey] = hist
                else:
                    st.issues.append(f"{file.name}: {'; '.join(sub.issues)}")
            st.rows = len(self.game_odds_history)
            st.as_of = max((h.lastCapturedAt for h in self.game_odds_history.values()), default=None)
        else:
            st.issues.append("missing (no game odds history yet)")

    def _load_shot_charts(self) -> None:
        st = self._status("shot_chart_players", self.paths.shot_chart_players_dir)
        if self.paths.shot_chart_players_dir.exists():
            st.present = True
            for file in sorted(self.paths.shot_chart_players_dir.glob("*.json")):
                sub = DatasetStatus(name=file.name, path=str(file), present=False)
                sc = _load_model(file, ShotChartPlayerFile, sub)
                if sc:
                    self.shot_players[file.stem] = sc
            st.rows = len(self.shot_players)
            st.as_of = max((s.generatedAt or "" for s in self.shot_players.values()), default=None) or None
        else:
            st.issues.append("missing")

        st = self._status("shot_chart_defense", self.paths.shot_chart_defense_dir)
        if self.paths.shot_chart_defense_dir.exists():
            st.present = True
            for file in sorted(self.paths.shot_chart_defense_dir.glob("*.json")):
                sub = DatasetStatus(name=file.name, path=str(file), present=False)
                sd = _load_model(file, ShotChartDefenseFile, sub)
                if not sd:
                    continue
                code = self.teams.resolve(sd.team)
                if code:
                    self.shot_defense[code] = sd
                else:
                    st.issues.append(f"{file.name}: team '{sd.team}' unresolved")
            st.rows = len(self.shot_defense)
            st.as_of = max((s.generatedAt or "" for s in self.shot_defense.values()), default=None) or None
        else:
            st.issues.append("missing")

    def _load_lineups(self) -> None:
        st = self._status("lineups", self.paths.lineups_dir)
        if self.paths.lineups_dir.exists():
            st.present = True
            for file in sorted(self.paths.lineups_dir.glob("*.json")):
                sub = DatasetStatus(name=file.name, path=str(file), present=False)
                lu = _load_model(file, LineupFile, sub)
                if lu:
                    self.lineups[lu.fixtureId] = lu
            st.rows = len(self.lineups)
        else:
            st.issues.append("missing")

    def _validate_cross(self) -> None:
        """Cross-dataset checks that affect fail-closed decisions."""
        if self.refresh_stamp:
            stamp = parse_iso(self.refresh_stamp.updatedAt)
            if stamp:
                age = hours_between(self.run_time, stamp)
                if age > self.cfg.freshness.max_stats_age_hours:
                    self.statuses["refresh_stamp"].issues.append(
                        f"stale: {age:.1f}h old > {self.cfg.freshness.max_stats_age_hours}h"
                    )
        if self.injuries and self.rosters:
            roster_names = {p.name for t in self.rosters.teams for p in t.players}
            from nbl_engine.ingest.names import norm_player_key

            roster_keys = {norm_player_key(n) for n in roster_names}
            unmatched = [r.player for r in self.injuries.injuries if norm_player_key(r.player) not in roster_keys]
            if unmatched:
                self.statuses["injuries"].issues.append(f"{len(unmatched)} injury name(s) not on current rosters: {', '.join(unmatched[:6])}")
        LOG.info("datastore loaded", extra={"ctx": {"event": "loaded", "datasets": {k: v.rows for k, v in self.statuses.items()}}})

    # ------------------------------------------------------------ helpers
    def stats_age_hours(self) -> float | None:
        if not self.refresh_stamp:
            return None
        stamp = parse_iso(self.refresh_stamp.updatedAt)
        return hours_between(self.run_time, stamp) if stamp else None

    def stats_fresh(self) -> bool:
        age = self.stats_age_hours()
        return age is not None and age <= self.cfg.freshness.max_stats_age_hours

    def as_of_map(self) -> dict[str, str]:
        return {k: v.as_of for k, v in sorted(self.statuses.items()) if v.as_of}

    def validation_report(self) -> dict[str, Any]:
        return {
            "run_time": self.run_time.isoformat(),
            "data_root": str(self.paths.root),
            "stats_age_hours": self.stats_age_hours(),
            "stats_fresh": self.stats_fresh(),
            "teams": self.teams.codes(),
            "datasets": [s.as_dict() for s in self.statuses.values()],
        }
