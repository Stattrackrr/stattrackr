"""Where the stored data lives. Read-only; the engine never writes under data/."""

from __future__ import annotations

import os
from pathlib import Path

ENGINE_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = ENGINE_ROOT.parent


def data_root() -> Path:
    """`data/` directory of the StatTrackr repo (override with NBL_ENGINE_DATA_ROOT)."""
    override = os.environ.get("NBL_ENGINE_DATA_ROOT")
    return Path(override).resolve() if override else REPO_ROOT / "data"


def cache_root() -> Path:
    return data_root() / "nbl-model" / "cache"


class DataPaths:
    """Resolved file locations for one data root."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = root or data_root()
        self.cache = self.root / "nbl-model" / "cache"

    # season-level files
    def schedule(self, year: int) -> Path:
        return self.root / f"nbl-schedule-{year}.json"

    def ladder(self, year: int) -> Path:
        return self.root / f"nbl-ladder-{year}.json"

    def league_player_stats(self, year: int) -> Path:
        return self.root / f"nbl-league-player-stats-{year}.json"

    def roster(self, year: int) -> Path:
        return self.root / f"nbl-roster-{year}.json"

    def rosters_by_team(self, year: int) -> Path:
        return self.root / f"nbl-rosters-by-team-{year}.json"

    def game_logs_index(self, year: int) -> Path:
        return self.root / f"nbl-player-game-logs-index-{year}.json"

    @property
    def injuries(self) -> Path:
        return self.root / "nbl-injuries.json"

    @property
    def refresh_stamp(self) -> Path:
        return self.root / "nbl-refresh-stamp.json"

    # per-entity caches
    @property
    def player_logs_dir(self) -> Path:
        return self.cache / "player-logs"

    def player_log(self, player_id: str, year: int) -> Path:
        return self.player_logs_dir / f"{player_id}-{year}.json"

    @property
    def prop_lines_dir(self) -> Path:
        return self.cache / "player-prop-lines"

    @property
    def prop_history_dir(self) -> Path:
        return self.cache / "player-prop-history"

    @property
    def game_odds_history_dir(self) -> Path:
        return self.cache / "game-odds-history"

    @property
    def shot_chart_players_dir(self) -> Path:
        return self.cache / "shot-chart-players"

    @property
    def shot_chart_defense_dir(self) -> Path:
        return self.cache / "shot-chart-defense"

    @property
    def lineups_dir(self) -> Path:
        return self.cache / "lineups"

    @property
    def pbp_dir(self) -> Path:
        return self.cache / "pbp"
