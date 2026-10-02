"""Player resolution across datasets.

Canonical key: Rosetta ``playerId`` (player logs / rosters / league stats).
Other sources only carry names:
  * prop snapshots: ``playerKey`` (normalised bookmaker name)
  * shot-chart-players: file stem slug + ``playerName``
  * injuries: ``player`` display name
Matching is by normalised name, restricted to the team(s) in play, so a
shared surname on another club cannot collide. Unresolved names are
returned as None and logged by the caller.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from nbl_engine.ingest.loaders import DataStore
from nbl_engine.ingest.names import norm_key, norm_player_key


@dataclass(frozen=True)
class Player:
    player_id: str
    name: str
    team_code: str
    position: str | None


@dataclass
class PlayerRegistry:
    by_id: dict[str, Player] = field(default_factory=dict)
    _by_team_key: dict[tuple[str, str], str] = field(default_factory=dict)  # (team, norm name) -> id
    _by_team_loose: dict[tuple[str, str], list[str]] = field(default_factory=dict)  # (team, "first-initial surname")

    @classmethod
    def build(cls, store: DataStore) -> "PlayerRegistry":
        reg = cls()
        year = store.cfg.seasons.current_year
        # rosters first (authoritative current team), then any logged player not on a roster
        if store.rosters:
            for team in store.rosters.teams:
                code = store.teams.resolve(team.teamCode) or team.teamCode
                for p in team.players:
                    if not p.playerId:
                        continue  # no Rosetta id -> no logs can ever attach; skipped
                    reg._add(Player(p.playerId, p.name, code, p.position))
        for (pid, y), log in store.player_logs.items():
            if y != year or pid in reg.by_id:
                continue
            code = store.teams.resolve(log.teamCode) or log.teamCode
            reg._add(Player(pid, log.name, code, None))
        return reg

    def _add(self, p: Player) -> None:
        self.by_id[p.player_id] = p
        for key in {norm_key(p.name), norm_player_key(p.name)}:
            self._by_team_key[(p.team_code, key)] = p.player_id
        tokens = norm_player_key(p.name).split()
        if len(tokens) >= 2:
            loose = (p.team_code, f"{tokens[0][0]} {tokens[-1]}")
            self._by_team_loose.setdefault(loose, []).append(p.player_id)

    def resolve(self, name: str, team_codes: list[str]) -> Player | None:
        """Resolve a display name / playerKey within the given teams."""
        name = re.sub(r"\s*\([^)]*\)\s*$", "", str(name or ""))  # "Name (Team)" -> "Name"
        exact = {norm_key(name), norm_player_key(name)}
        for code in team_codes:
            for key in exact:
                pid = self._by_team_key.get((code, key))
                if pid:
                    return self.by_id[pid]
        tokens = norm_player_key(name).split()
        if len(tokens) >= 2:
            hits: list[str] = []
            for code in team_codes:
                hits.extend(self._by_team_loose.get((code, f"{tokens[0][0]} {tokens[-1]}"), []))
            if len(set(hits)) == 1:
                return self.by_id[hits[0]]
        return None

    def team_players(self, team_code: str) -> list[Player]:
        return sorted((p for p in self.by_id.values() if p.team_code == team_code), key=lambda p: p.name)
