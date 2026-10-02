"""Per-analysis context object handed from the pipeline to the evidence builder."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from nbl_engine.features.lines import MarketView, Movement
from nbl_engine.features.stats import StatDef
from nbl_engine.features.team import TeamBoxes
from nbl_engine.ingest.loaders import DataStore
from nbl_engine.ingest.players import Player, PlayerRegistry
from nbl_engine.models.raw import GameLogRow, GameOddsCapture, InjuryRow, ScheduleGame, ShotChartDefenseFile, ShotChartPlayerFile


@dataclass
class AnalysisContext:
    store: DataStore
    players: PlayerRegistry
    boxes: TeamBoxes
    game: ScheduleGame
    game_key: str
    tipoff: datetime
    player: Player
    is_home: bool
    opponent_code: str
    stat: StatDef
    rows_current: list[GameLogRow]  # played rows, newest first, current season
    rows_by_year: dict[int, list[GameLogRow]]  # played rows per season incl. prior (H2H only)
    market: MarketView
    market_captured_at: str | None
    movement: Movement | None
    shot_player: ShotChartPlayerFile | None
    shot_defense: ShotChartDefenseFile | None
    shot_defense_all: dict[str, ShotChartDefenseFile]  # every stored team, for league zone ranks
    injury_self: InjuryRow | None
    injured_teammates: list[tuple[Player, InjuryRow]]
    game_odds_latest: GameOddsCapture | None
    skips: list[dict] = field(default_factory=list)

    @property
    def line(self) -> float | None:
        return self.market.consensus_line

    @property
    def season_year(self) -> int:
        return self.store.cfg.seasons.current_year

    def as_of(self, dataset: str) -> str:
        st = self.store.statuses.get(dataset)
        return (st.as_of if st and st.as_of else "unknown")
