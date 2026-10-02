"""Team registry derived from the schedule file: code <-> official name.

Nothing is hardcoded. Aliases for other sources (odds feeds, shot charts,
player-log opponent strings) are resolved by normalised comparison and, as a
fallback, by the club nickname (last token of the official name).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from nbl_engine.ingest.names import compact_key, last_token, norm_key
from nbl_engine.models.raw import ScheduleGame


@dataclass(frozen=True)
class Team:
    code: str
    name: str


@dataclass
class TeamRegistry:
    teams: dict[str, Team] = field(default_factory=dict)  # by code
    _by_compact: dict[str, str] = field(default_factory=dict)  # compact name -> code
    _by_nick: dict[str, str] = field(default_factory=dict)  # nickname -> code (unique only)
    _learned: dict[str, str] = field(default_factory=dict)  # raw alias -> code

    @classmethod
    def from_schedule(cls, games: list[ScheduleGame]) -> "TeamRegistry":
        reg = cls()
        for g in games:
            reg._add(g.homeTeamCode, g.homeTeam)
            reg._add(g.awayTeamCode, g.awayTeam)
        reg._index()
        return reg

    def _add(self, code: str, name: str) -> None:
        code = code.strip().upper()
        if not code or not name:
            return
        if code not in self.teams:
            self.teams[code] = Team(code=code, name=name.strip())

    def _index(self) -> None:
        nick_counts: dict[str, int] = {}
        for t in self.teams.values():
            self._by_compact[compact_key(t.name)] = t.code
            self._by_compact[compact_key(t.code)] = t.code
            nick = last_token(t.name)
            nick_counts[nick] = nick_counts.get(nick, 0) + 1
        for t in self.teams.values():
            nick = last_token(t.name)
            if nick_counts.get(nick) == 1:
                self._by_nick[nick] = t.code

    def learn_alias(self, alias: str, code: str) -> None:
        """Register an alias observed in stored data (e.g. log opponent strings)."""
        code = code.strip().upper()
        if code in self.teams and alias:
            self._learned[compact_key(alias)] = code

    def resolve(self, raw: str | None) -> str | None:
        """Return the team code for a code or any name variant, else None."""
        if not raw:
            return None
        key = compact_key(raw)
        if not key:
            return None
        if raw.strip().upper() in self.teams:
            return raw.strip().upper()
        if key in self._by_compact:
            return self._by_compact[key]
        if key in self._learned:
            return self._learned[key]
        nick = last_token(raw)
        if nick in self._by_nick:
            return self._by_nick[nick]
        # token-subset match (e.g. "South East Melbourne" vs "South East Melbourne Phoenix")
        raw_tokens = set(norm_key(raw).split())
        hits = [t.code for t in self.teams.values() if raw_tokens and raw_tokens <= set(norm_key(t.name).split())]
        if len(hits) == 1:
            return hits[0]
        return None

    def name(self, code: str) -> str:
        t = self.teams.get(code.upper())
        return t.name if t else code

    def codes(self) -> list[str]:
        return sorted(self.teams)
