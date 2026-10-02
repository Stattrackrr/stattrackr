"""Orchestration: date -> games -> players -> stats -> PickRecords."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from nbl_engine import __version__
from nbl_engine.config import Thresholds, load_thresholds
from nbl_engine.evidence.builder import ClaimBuilder
from nbl_engine.evidence.context import AnalysisContext
from nbl_engine.features import player as pf
from nbl_engine.features.lines import market_view, movement, select_lines
from nbl_engine.features.stats import STATS, StatDef
from nbl_engine.features.team import TeamBoxes
from nbl_engine.ingest.loaders import DataStore
from nbl_engine.ingest.names import norm_key, norm_player_key
from nbl_engine.ingest.players import Player, PlayerRegistry
from nbl_engine.ingest.timeutil import local_date, parse_iso
from nbl_engine.logging_utils import LOG, SkipLog
from nbl_engine.models.raw import GameLogRow, InjuryRow, PropSnapshotFile, ScheduleGame
from nbl_engine.models.records import BookLineSummary, LineSummary, PickRecord
from nbl_engine.narrative.llm import Provider, polish_narrative
from nbl_engine.narrative.template import build_narrative
from nbl_engine.narrative.verifier import verify
from nbl_engine.output.serialize import sha256_of, write_canonical
from nbl_engine.paths import DataPaths
from nbl_engine.reasoning.rules import run_rules
from nbl_engine.scoring.tiers import GateInputs, run_gates, score


def slug(text: str) -> str:
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()))


def game_key_for(g: ScheduleGame) -> str:
    """Same shape as the TS snapshotter: UTC day + slugged official names."""
    return f"{g.startTime[:10]}_{slug(g.homeTeam)}_vs_{slug(g.awayTeam)}"


@dataclass
class RunOptions:
    run_date: date
    game: str | None = None  # "AWY@HOM"
    player: str | None = None
    stat: str | None = None
    out_dir: Path | None = None
    llm: Provider | None = None
    all_stats_for_player: bool = True


@dataclass
class RunSummary:
    run_date: str
    games: list[str] = field(default_factory=list)
    picks: list[PickRecord] = field(default_factory=list)
    skips: list[dict[str, Any]] = field(default_factory=list)
    validation: dict[str, Any] = field(default_factory=dict)

    def skip_counts(self) -> dict[str, int]:
        c = Counter(str(s.get("code")) for s in self.skips)
        return dict(sorted(c.items()))


class Engine:
    def __init__(self, cfg: Thresholds | None = None, paths: DataPaths | None = None, run_time: datetime | None = None) -> None:
        self.cfg = cfg or load_thresholds()
        self.paths = paths or DataPaths()
        self.run_time = run_time or datetime.now(timezone.utc)
        self.skips = SkipLog()
        self.store = DataStore.load(self.paths, self.cfg, self.run_time)
        self.players = PlayerRegistry.build(self.store)
        year = self.cfg.seasons.current_year
        self.boxes = TeamBoxes.from_logs(year, [log.games for (pid, y), log in self.store.player_logs.items() if y == year])
        self._injuries_by_player = self._index_injuries()

    # ------------------------------------------------------------ indexes
    def _index_injuries(self) -> dict[str, InjuryRow]:
        out: dict[str, InjuryRow] = {}
        if not self.store.injuries:
            return out
        for row in self.store.injuries.injuries:
            code = self.store.teams.resolve(row.team)
            if not code:
                self.skips.skip("injury_team_unresolved", team=row.team, player=row.player)
                continue
            p = self.players.resolve(row.player, [code])
            if not p:
                self.skips.skip("injury_player_unresolved", team=code, player=row.player)
                continue
            out[p.player_id] = row
        return out

    def _snapshot_for(self, g: ScheduleGame) -> PropSnapshotFile | None:
        key = game_key_for(g)
        snap = self.store.prop_snapshots.get(key)
        if snap:
            return snap
        home, away = self.store.teams.resolve(g.homeTeamCode), self.store.teams.resolve(g.awayTeamCode)
        day = local_date(g.startTime)
        for s in self.store.prop_snapshots.values():
            if self.store.teams.resolve(s.homeTeam) == home and self.store.teams.resolve(s.awayTeam) == away and local_date(s.commenceTime) == day:
                return s
        return None

    def _player_rows(self, player_id: str) -> tuple[list[GameLogRow], dict[int, list[GameLogRow]]]:
        year = self.cfg.seasons.current_year
        by_year: dict[int, list[GameLogRow]] = {}
        for (pid, y), log in self.store.player_logs.items():
            if pid != player_id:
                continue
            by_year[y] = pf.played_rows(log.games)
        return by_year.get(year, []), by_year

    def _shot_player_file(self, p: Player):
        direct = self.store.shot_players.get(slug(p.name))
        if direct and self.store.teams.resolve(direct.team) == p.team_code:
            return direct
        for sc in self.store.shot_players.values():
            if self.store.teams.resolve(sc.team) == p.team_code and norm_player_key(sc.playerName) == norm_player_key(p.name):
                return sc
        return None

    def _snapshot_player_map(self, snap: PropSnapshotFile, codes: list[str]) -> dict[str, Player]:
        """playerKey -> Player for every distinct bookmaker name in the snapshot."""
        out: dict[str, Player] = {}
        seen: set[str] = set()
        for line in snap.lines:
            if line.playerKey in seen:
                continue
            seen.add(line.playerKey)
            p = self.players.resolve(line.player, codes)
            if p:
                out[line.playerKey] = p
            else:
                self.skips.skip("book_player_unresolved", game=snap.gameKey, player=line.player)
        return out

    # ---------------------------------------------------------------- run
    def games_on(self, run_date: date) -> list[ScheduleGame]:
        sched = self.store.schedules.get(self.cfg.seasons.current_year)
        if not sched:
            return []
        return sorted((g for g in sched.games if local_date(g.startTime) == run_date), key=lambda g: (g.startTime, g.id))

    def run(self, opts: RunOptions) -> RunSummary:
        summary = RunSummary(run_date=opts.run_date.isoformat(), validation=self.store.validation_report())
        skip_start = len(self.skips.entries)  # per-run skips (init-time injury skips excluded)
        games = self.games_on(opts.run_date)
        if opts.game:
            want = opts.game.upper().replace(" ", "")
            games = [g for g in games if f"{g.awayTeamCode}@{g.homeTeamCode}".upper() == want]
        if not games:
            self.skips.skip("no_games_for_date", date=opts.run_date.isoformat(), game=opts.game)
        stats = [STATS[k] for k in STATS] if not opts.stat else [s for s in STATS.values() if s.key == opts.stat]

        for g in games:
            key = game_key_for(g)
            summary.games.append(f"{g.awayTeamCode}@{g.homeTeamCode} {key}")
            snap = self._snapshot_for(g)
            tipoff = parse_iso(g.startTime)
            assert tipoff is not None
            codes = [self.store.teams.resolve(g.homeTeamCode) or g.homeTeamCode, self.store.teams.resolve(g.awayTeamCode) or g.awayTeamCode]
            key_map = self._snapshot_player_map(snap, codes) if snap else {}
            if not snap:
                self.skips.skip("no_prop_snapshot", game=key)

            for code in codes:
                is_home = code == codes[0]
                opponent = codes[1] if is_home else codes[0]
                for p in self.players.team_players(code):
                    if opts.player and norm_player_key(opts.player) not in (norm_player_key(p.name), norm_key(p.name)):
                        continue
                    rows_current, rows_by_year = self._player_rows(p.player_id)
                    if not rows_current:
                        self.skips.skip("no_current_logs", game=key, player=p.name)
                        continue
                    player_keys = [k for k, v in key_map.items() if v.player_id == p.player_id]
                    for sd in stats:
                        lines = []
                        for pk in player_keys:
                            lines.extend(select_lines(snap.lines, pk, sd.key) if snap else [])
                        if not lines and not (opts.player and opts.all_stats_for_player):
                            continue  # no stored market for this player/stat and no explicit request
                        pick = self._analyse(g, key, tipoff, p, is_home, opponent, sd, rows_current, rows_by_year, snap, lines, player_keys, opts)
                        summary.picks.append(pick)
                        if opts.out_dir:
                            path = opts.out_dir / opts.run_date.isoformat() / key / f"{slug(p.name)}_{sd.key}.json"
                            write_canonical(path, pick)

        summary.skips = list(self.skips.entries[skip_start:])
        if opts.out_dir:
            base = opts.out_dir / opts.run_date.isoformat()
            write_canonical(base / "validation.json", summary.validation)
            write_canonical(base / "skips.json", {"counts": summary.skip_counts(), "entries": summary.skips})
            write_canonical(base / "picks.json", [self._pick_row(p) for p in summary.picks])
        return summary

    @staticmethod
    def _pick_row(p: PickRecord) -> dict[str, Any]:
        return {
            "game": p.game_label,
            "game_key": p.game_key,
            "player": p.player_name,
            "team": p.team_code,
            "stat": p.stat_label,
            "line": p.line,
            "side": p.side,
            "tier": p.tier,
            "score_over": p.score_over,
            "score_under": p.score_under,
            "categories": p.confirmed_categories,
            "verified": p.verifier.passed,
            "evidence_sha256": p.evidence_sha256,
        }

    # ------------------------------------------------------------ analyse
    def _analyse(
        self,
        g: ScheduleGame,
        key: str,
        tipoff: datetime,
        p: Player,
        is_home: bool,
        opponent: str,
        sd: StatDef,
        rows_current: list[GameLogRow],
        rows_by_year: dict[int, list[GameLogRow]],
        snap: PropSnapshotFile | None,
        lines: list,
        player_keys: list[str],
        opts: RunOptions,
    ) -> PickRecord:
        market = market_view(lines)
        hist = self.store.prop_history.get(snap.gameKey) if snap else None
        mv = None
        if hist:
            for pk in player_keys:
                mv = movement(hist, pk, sd.key)
                if mv:
                    break
        teammates_out = [
            (self.players.by_id[pid], row)
            for pid, row in sorted(self._injuries_by_player.items())
            if pid != p.player_id and self.players.by_id[pid].team_code == p.team_code
        ]
        go = self.store.game_odds_history.get(key)
        ctx = AnalysisContext(
            store=self.store,
            players=self.players,
            boxes=self.boxes,
            game=g,
            game_key=key,
            tipoff=tipoff,
            player=p,
            is_home=is_home,
            opponent_code=opponent,
            stat=sd,
            rows_current=rows_current,
            rows_by_year=rows_by_year,
            market=market,
            market_captured_at=snap.capturedAt if snap else None,
            movement=mv,
            shot_player=self._shot_player_file(p),
            shot_defense=self.store.shot_defense.get(opponent),
            shot_defense_all=self.store.shot_defense,
            injury_self=self._injuries_by_player.get(p.player_id),
            injured_teammates=teammates_out,
            game_odds_latest=go.captures[-1] if go and go.captures else None,
        )
        claims = ClaimBuilder(ctx).build()
        inferences = run_rules(claims, self.cfg, sd.key)
        mins = pf.minutes_profile(rows_current)
        gate_in = GateInputs(
            games_current=len(rows_current),
            minutes_season_mean=mins.season_mean,
            line_present=market.consensus_line is not None,
            market_kind=market.kind,
            market_captured_at=snap.capturedAt if snap else None,
            stats_fresh=self.store.stats_fresh(),
            stats_age_hours=self.store.stats_age_hours(),
            self_injury_status=(ctx.injury_self.status if ctx.injury_self else None),
            run_time=self.run_time,
        )
        gates = run_gates(gate_in, self.cfg)
        result = score(inferences, claims, gates, self.cfg, gate_in)
        template = build_narrative(p.name, sd.label, market.consensus_line, result.tier, result.side, claims, inferences, gates)
        narrative, _used = polish_narrative(template, claims, inferences, result.tier, result.side, market.consensus_line, opts.llm)
        ver = verify(narrative, claims, inferences, result.tier, result.side, market.consensus_line)
        if not ver.passed:
            self.skips.skip("verifier_failed", game=key, player=p.name, stat=sd.key, issues=ver.issues[:3])
        evidence_hash = sha256_of({"claims": claims, "inferences": inferences})
        if result.tier in ("STRONG", "LEAN") and not ver.passed:
            # fail closed: an unverifiable narrative cannot ship as a pick
            result = type(result)(tier="NO EDGE", side=result.side, score_over=result.score_over, score_under=result.score_under, confirmed_categories=result.confirmed_categories, gates=result.gates)
        LOG.info(
            "analysed",
            extra={"ctx": {"event": "analysed", "game": key, "player": p.name, "stat": sd.key, "tier": result.tier, "side": result.side, "line": market.consensus_line}},
        )
        return PickRecord(
            engine_version=__version__,
            run_date=opts.run_date.isoformat(),
            game_key=key,
            game_label=f"{g.awayTeamCode}@{g.homeTeamCode}",
            tipoff_utc=g.startTime,
            player_id=p.player_id,
            player_name=p.name,
            team_code=p.team_code,
            opponent_code=opponent,
            is_home=is_home,
            stat=sd.key,
            stat_label=sd.label,
            line=market.consensus_line,
            side=result.side,
            tier=result.tier,
            score_over=result.score_over,
            score_under=result.score_under,
            confirmed_categories=result.confirmed_categories,
            gates=gates,
            line_summary=LineSummary(
                consensus_line=market.consensus_line,
                books=market.books,
                best_over_decimal=market.best_over_quote.price if market.best_over_quote else None,
                best_over_book=market.best_over_quote.book if market.best_over_quote else None,
                best_under_decimal=market.best_under_quote.price if market.best_under_quote else None,
                best_under_book=market.best_under_quote.book if market.best_under_quote else None,
                kind=market.kind,  # type: ignore[arg-type]
                captured_at=snap.capturedAt if snap else None,
                best_over_line=market.best_over_quote.line if market.best_over_quote else None,
                best_over_line_book=market.best_over_quote.book if market.best_over_quote else None,
                best_over_line_decimal=market.best_over_quote.price if market.best_over_quote else None,
                best_under_line=market.best_under_quote.line if market.best_under_quote else None,
                best_under_line_book=market.best_under_quote.book if market.best_under_quote else None,
                best_under_line_decimal=market.best_under_quote.price if market.best_under_quote else None,
                best_over_books=list(market.best_over_quote.books) if market.best_over_quote else [],
                best_under_books=list(market.best_under_quote.books) if market.best_under_quote else [],
                book_lines=[
                    BookLineSummary(book=b.book, kind=b.kind, line=b.line, over_decimal=b.over_decimal, under_decimal=b.under_decimal)
                    for b in (*market.ou_book_lines, *(x for x in market.milestone_book_lines if x.book not in {o.book for o in market.ou_book_lines}))
                ],
            ),
            claims=claims,
            inferences=inferences,
            narrative=narrative,
            verifier=ver,
            evidence_sha256=evidence_hash,
            data_as_of=self.store.as_of_map(),
        )
