"""Build ClaimRecords for one (game, player, stat) from stored data only.

Rules of the builder:
  * every claim has a dataset, an as_of, and a sample size where one applies
  * no claim is created for a value that does not exist in the stored data
  * ``as_text`` is the only wording narrative may reuse for that claim
"""

from __future__ import annotations

from nbl_engine.evidence.context import AnalysisContext
from nbl_engine.evidence.fmt import box_rank, line_text, nbl_season_label, num, ordinal, pct, signed
from nbl_engine.features import player as pf
from nbl_engine.features.stats import stat_value
from nbl_engine.features.rebounding import board_matchup, opponent_boards, rebound_rates, rebound_split
from nbl_engine.features.shots import ZONE_LABEL, ZONE_SHORT, defence_zone_profiles, player_zone_profile, zone_matchup
from nbl_engine.features.usage import usage_profile, with_without
from nbl_engine.models.raw import GameLogRow
from nbl_engine.models.records import ClaimFlag, ClaimRecord

LOGS_DS = "nbl-model/cache/player-logs"
PROPS_DS = "nbl-model/cache/player-prop-lines"
HIST_DS = "nbl-model/cache/player-prop-history"
GAME_ODDS_DS = "nbl-model/cache/game-odds-history"
SHOT_P_DS = "nbl-model/cache/shot-chart-players"
SHOT_D_DS = "nbl-model/cache/shot-chart-defense"
INJ_DS = "nbl-injuries.json"
SCHED_DS = "nbl-schedule"

SCORING_STATS: frozenset[str] = frozenset({"threeMade", "points", "pra", "pr", "pa"})
REBOUND_STATS: frozenset[str] = frozenset({"rebounds", "ra", "pr", "pra"})


def _join_books(names: list[str]) -> str:
    names = [n for n in names if n]
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} and {names[1]}"
    return f"{', '.join(names[:-1])} and {names[-1]}"


def _zone_name(zone: str) -> str:
    return ZONE_SHORT.get(zone, ZONE_LABEL.get(zone, zone))


def _zone_share_text(who: str, pz, spot: str) -> str:
    """Makes % only — the number on the Court Breakdown Makes toggle."""
    makes_n = f"{num(pz.fgm, 0)} of {num(pz.fga, 0)}"
    if pz.share_fgm is None:
        return f"{pct(pz.share_pts)} of {who}'s makes are from {spot} ({makes_n})."
    return f"{pct(pz.share_fgm)} of {who}'s makes are from {spot} ({makes_n})."


def _zone_matchup_text(who: str, opp_name: str, zm, sp, defence) -> str:
    """Per-zone Makes % (court numbers). Never a summed scoring % that is not on the floor."""

    def bits(zones: tuple[str, ...]) -> list[str]:
        out: list[str] = []
        for key in zones:
            pz = sp.zone(key)
            if not pz or pz.share_fgm is None:
                continue
            dz = defence.zone(key) if defence else None
            rank = ""
            if dz and dz.rank:
                tag, extra = _rank_bits(dz.rank)
                rank = f", shot-chart {tag}{extra}"
            out.append(f"{pct(pz.share_fgm)} of makes from {_zone_name(key)}{rank}")
        return out

    unf = bits(zm.unfavourable_zones)
    fav = bits(zm.favourable_zones)
    parts: list[str] = []
    if unf:
        parts.append(f"{opp_name}'s tough spots vs {who}: {'; '.join(unf)}.")
    if fav:
        parts.append(f"{opp_name}'s weaker spots vs {who}: {'; '.join(fav)}.")
    if not parts:
        return f"{who}'s make zones sit in the middle of {opp_name}'s defence."
    return " ".join(parts)


def _hits_vs_d_text(
    label: str,
    hard_o: int,
    hard_n: int,
    mid_o: int,
    mid_n: int,
    easy_o: int,
    easy_n: int,
    top: int,
    bottom: int,
) -> str | None:
    """Line results by opponent allowed-rank bucket. Hard D is not an auto-under."""
    parts: list[str] = []
    if hard_n:
        parts.append(f"over in {hard_o} of {hard_n} vs the hardest {top}")
    if mid_n:
        parts.append(f"over in {mid_o} of {mid_n} vs mid-table {label} D")
    if easy_n:
        parts.append(f"over in {easy_o} of {easy_n} vs {label} D ranked {bottom}+ (easier)")
    if not parts:
        return None
    not_easy_o = hard_o + mid_o
    not_easy_n = hard_n + mid_n
    extra = ""
    if not_easy_n:
        extra = (
            f" Combined: over in {not_easy_o} of {not_easy_n} when the D was not easy. "
            "A harder matchup is not an automatic under, and an easy D is not an automatic over."
        )
    return f"This season vs the line: {'; '.join(parts)}.{extra}"


def _rank_bits(rank: tuple[int, int] | None) -> tuple[str, str]:
    if not rank:
        return "", ""
    extra = " (hardest)" if rank[0] <= 2 else (" (easiest)" if rank[0] >= 8 else "")
    return f"#{rank[0]} of {rank[1]}", extra


def _book_line_text(b) -> str:
    if b.kind == "ou":
        over = num(b.over_decimal, 2) if b.over_decimal else "n/a"
        under = num(b.under_decimal, 2) if b.under_decimal else "n/a"
        return f"{b.book} {line_text(b.line)} (over {over} / under {under})"
    return f"{b.book} {line_text(b.line)} milestone (over {num(b.over_decimal, 2) if b.over_decimal else 'n/a'})"


class ClaimBuilder:
    def __init__(self, ctx: AnalysisContext) -> None:
        self.ctx = ctx
        self.cfg = ctx.store.cfg
        self.claims: list[ClaimRecord] = []
        self._n = 0
        self.player_subject = f"player:{ctx.player.player_id}"
        self.opp_subject = f"team:{ctx.opponent_code}"
        self.game_subject = f"game:{ctx.game_key}"
        self.logs_as_of = ctx.as_of(f"player_logs_{ctx.season_year}")

    # ----------------------------------------------------------- plumbing
    def _add(
        self,
        category: str,
        subject: str,
        metric: str,
        value,
        as_text: str,
        *,
        unit: str = "",
        sample_n: int | None = None,
        window: str = "",
        comparison: float | None = None,
        dataset: str,
        as_of: str,
        flags: list[ClaimFlag] | None = None,
        stat: str | None = None,
    ) -> ClaimRecord:
        self._n += 1
        fl = list(flags or [])
        if sample_n is not None and sample_n <= self.cfg.samples.small_sample_games and "small_sample" not in fl:
            fl.append("small_sample")
        rec = ClaimRecord(
            id=f"c{self._n:02d}_{metric}",
            category=category,  # type: ignore[arg-type]
            subject=subject,
            stat=stat if stat is not None else self.ctx.stat.key,
            metric=metric,
            value=round(value, 4) if isinstance(value, float) else value,
            unit=unit,
            sample_n=sample_n,
            window=window,
            comparison=comparison,
            source_dataset=dataset,
            source_as_of=as_of,
            as_text=as_text,
            flags=fl,
        )
        self.claims.append(rec)
        return rec

    # -------------------------------------------------------------- build
    def build(self) -> list[ClaimRecord]:
        self._market_claims()
        self._form_claims()
        self._slate_claims()
        self._hit_rate_claims()
        self._minutes_claims()
        self._attempt_claims()
        self._home_away_claims()
        self._usage_claims()
        self._matchup_claims()
        self._pace_claims()
        self._shot_profile_claims()
        self._rebounding_claims()
        self._h2h_claims()
        self._injury_claims()
        self._movement_claims()
        self._game_context_claims()
        return list(self.claims)

    # ------------------------------------------------------------- market
    def _market_claims(self) -> None:
        ctx = self.ctx
        m = ctx.market
        label = ctx.stat.label
        as_of = ctx.market_captured_at or "unknown"
        if m.kind == "none" or m.consensus_line is None:
            self._add("context", self.game_subject, "line_consensus", None, f"No stored {label} line for {ctx.player.name}.", dataset=PROPS_DS, as_of=as_of)
            return
        flags: list[ClaimFlag] = ["milestone_line"] if m.kind == "milestone" else []
        kind_txt = "milestone" if m.kind == "milestone" else "over/under"
        self._add(
            "context",
            self.game_subject,
            "line_consensus",
            m.consensus_line,
            f"Consensus {label} {kind_txt} line {line_text(m.consensus_line)} across {m.books} book(s).",
            unit="line",
            sample_n=None,
            comparison=m.consensus_line,
            dataset=PROPS_DS,
            as_of=as_of,
            flags=flags,
        )
        over_q = m.best_over_quote
        if over_q:
            named = _join_books(list(over_q.books))
            self._add(
                "context",
                self.game_subject,
                "best_over_line",
                over_q.line,
                f"Best over is {line_text(over_q.line)} at {num(over_q.price, 2)} ({named}).",
                unit="line",
                comparison=over_q.line,
                dataset=PROPS_DS,
                as_of=as_of,
            )
        under_q = m.best_under_quote
        if under_q:
            same_as_over = (
                over_q is not None
                and abs(over_q.line - under_q.line) < 1e-9
                and abs(over_q.price - under_q.price) < 1e-9
                and over_q.books == under_q.books
            )
            if not same_as_over:
                named = _join_books(list(under_q.books))
                self._add(
                    "context",
                    self.game_subject,
                    "best_under_line",
                    under_q.line,
                    f"Best under is {line_text(under_q.line)} at {num(under_q.price, 2)} ({named}).",
                    unit="line",
                    comparison=under_q.line,
                    dataset=PROPS_DS,
                    as_of=as_of,
                )
        ou_bits = [_book_line_text(b) for b in m.ou_book_lines]
        if ou_bits:
            self._add("context", self.game_subject, "book_ou_board", m.consensus_line, f"Two-way O/U by book: {'; '.join(ou_bits)}.", unit="line", sample_n=len(m.ou_book_lines), comparison=m.consensus_line, dataset=PROPS_DS, as_of=as_of)
        ms_bits = [_book_line_text(b) for b in m.milestone_book_lines]
        if ms_bits and m.kind == "ou":
            self._add("context", self.game_subject, "book_milestone_board", None, f"Milestones still posted: {'; '.join(ms_bits)}.", dataset=PROPS_DS, as_of=as_of, flags=["milestone_line"])
        elif ms_bits and m.kind == "milestone":
            self._add("context", self.game_subject, "book_milestone_board", m.consensus_line, f"Milestone board: {'; '.join(ms_bits)}.", unit="line", comparison=m.consensus_line, dataset=PROPS_DS, as_of=as_of, flags=flags)

    # --------------------------------------------------------------- form
    def _form_claims(self) -> None:
        ctx = self.ctx
        rows = ctx.rows_current
        label = ctx.stat.label
        season = pf.window_stats(rows, ctx.stat, "season", None)
        if season.n:
            self._add("form", self.player_subject, "season_mean", season.mean, f"Season {label} average {num(season.mean)} over {season.n} game(s).", unit="per_game", sample_n=season.n, window="season", dataset=LOGS_DS, as_of=self.logs_as_of)
            self._add("form", self.player_subject, "season_median", season.median, f"Season {label} median {num(season.median)} (range {num(season.minimum, 0)} to {num(season.maximum, 0)}).", unit="per_game", sample_n=season.n, window="season", dataset=LOGS_DS, as_of=self.logs_as_of)
        l5 = pf.window_stats(rows, ctx.stat, "L5", 5)
        if l5.n:
            vals = ", ".join(num(v, 0) for v in l5.values)
            self._add("form", self.player_subject, "l5_mean", l5.mean, f"Last {l5.n} game(s) {label} average {num(l5.mean)} (game by game: {vals}).", unit="per_game", sample_n=l5.n, window="L5", dataset=LOGS_DS, as_of=self.logs_as_of)
        l10 = pf.window_stats(rows, ctx.stat, "L10", 10)
        if l10.n > l5.n:
            self._add("form", self.player_subject, "l10_mean", l10.mean, f"Last {l10.n} game(s) {label} average {num(l10.mean)}.", unit="per_game", sample_n=l10.n, window="L10", dataset=LOGS_DS, as_of=self.logs_as_of)

    def _slate_claims(self) -> None:
        """Who he actually faced: minutes, the stat, opponent allowed rank. Explains the average."""
        ctx = self.ctx
        rows = [r for r in reversed(ctx.rows_current) if stat_value(r, ctx.stat) is not None]
        if not rows:
            return
        label = ctx.stat.label
        min_games = self.cfg.samples.team_min_games
        ranks = ctx.boxes.allowed_ranks(ctx.stat, min_games)
        top = self.cfg.matchup.top_rank
        bottom = self.cfg.matchup.bottom_rank
        bits: list[str] = []
        easy = hard = 0
        hard_o = hard_n = mid_o = mid_n = easy_o = easy_n = 0
        for row in rows:
            val = stat_value(row, ctx.stat)
            if val is None:
                continue
            code = (row.opponentCode or "").strip().upper() or ctx.store.teams.resolve(row.opponent) or ""
            name = ctx.store.teams.name(code) if code else (row.opponent or "unknown")
            allowed, _n = ctx.boxes.allowed_per_game(code, ctx.stat.team_allowed_fields) if code else (None, 0)
            rk = ranks.get(code) if code else None
            if rk and rk[0] <= top:
                hard += 1
            elif rk and rk[0] >= bottom:
                easy += 1
            rk_txt = f"{label} D {ordinal(rk[0])} of {rk[1]}" if rk else "unranked"
            allow_txt = f", allow {num(allowed)}" if allowed is not None else ""
            mins = f"{num(row.minutes, 0)} min " if row.minutes else ""
            side = ""
            hit: str | None = None
            if ctx.line is not None:
                if val > ctx.line:
                    side = " over"
                    hit = "over"
                elif val < ctx.line:
                    side = " under"
                    hit = "under"
                else:
                    side = " push"
                    hit = "push"
            if rk and hit in {"over", "under"}:
                if rk[0] <= top:
                    hard_n += 1
                    hard_o += int(hit == "over")
                elif rk[0] >= bottom:
                    easy_n += 1
                    easy_o += int(hit == "over")
                else:
                    mid_n += 1
                    mid_o += int(hit == "over")
            bits.append(f"{mins}{num(val, 0)} {label} vs {name} ({rk_txt}{allow_txt}){side}")
        self._add(
            "form",
            self.player_subject,
            "season_games",
            len(bits),
            f"This season game by game: {'; '.join(bits)}.",
            unit="games",
            sample_n=len(bits),
            window="season",
            dataset=LOGS_DS,
            as_of=self.logs_as_of,
        )
        if len(bits) >= 2 and (easy or hard):
            self._add(
                "form",
                self.player_subject,
                "season_slate",
                easy,
                f"{easy} of {len(bits)} game(s) came against {label} D ranked {bottom}+ (easier, box score); {hard} against the hardest {top}.",
                unit="games",
                sample_n=len(bits),
                window="season",
                dataset=LOGS_DS,
                as_of=self.logs_as_of,
                flags=["derived"],
            )
        hits_txt = _hits_vs_d_text(label, hard_o, hard_n, mid_o, mid_n, easy_o, easy_n, top, bottom)
        if hits_txt:
            self._add(
                "form",
                self.player_subject,
                "season_vs_d_hits",
                hard_o + mid_o,
                hits_txt,
                unit="games",
                sample_n=hard_n + mid_n + easy_n,
                window="season",
                dataset=LOGS_DS,
                as_of=self.logs_as_of,
                flags=["derived"],
            )

    # ----------------------------------------------------------- hit rate
    def _hit_rate_claims(self) -> None:
        ctx = self.ctx
        line = ctx.line
        if line is None:
            return
        label = ctx.stat.label
        rows = ctx.rows_current
        for window, limit in (("season", None), ("L10", 10), ("L5", 5)):
            hr = pf.hit_rate(rows, ctx.stat, line, window, limit)
            if hr.n == 0:
                continue
            if window != "season" and hr.n == pf.hit_rate(rows, ctx.stat, line, "season", None).n and window == "L10":
                continue  # L10 identical to season at this sample size
            push_txt = f", {hr.pushes} push(es)" if hr.pushes else ""
            scope = "This season" if window == "season" else f"Last {hr.n}"
            self._add(
                "hit_rate",
                self.player_subject,
                f"{window.lower()}_hit_rate",
                hr.rate,
                f"{scope}: over {line_text(line)} {label} in {hr.overs} of {hr.n} game(s){push_txt} ({pct(hr.rate)}).",
                unit="rate",
                sample_n=hr.n,
                window=window,
                comparison=line,
                dataset=LOGS_DS,
                as_of=self.logs_as_of,
            )
        side, length = pf.current_streak(rows, ctx.stat, line)
        if side != "none" and length >= 2:
            self._add("hit_rate", self.player_subject, "streak", length, f"Current streak: {length} straight game(s) {side} {line_text(line)} {label}.", unit="games", sample_n=length, window=side, comparison=line, dataset=LOGS_DS, as_of=self.logs_as_of)

    # ------------------------------------------------------------ minutes
    def _minutes_claims(self) -> None:
        ctx = self.ctx
        mp = pf.minutes_profile(ctx.rows_current)
        if mp.season_n == 0:
            return
        self._add("minutes", self.player_subject, "minutes_season_mean", mp.season_mean, f"Season minutes {num(mp.season_mean)} per game over {mp.season_n} game(s).", unit="minutes", sample_n=mp.season_n, window="season", dataset=LOGS_DS, as_of=self.logs_as_of, stat="minutes")
        if mp.l5_n:
            self._add("minutes", self.player_subject, "minutes_l5_mean", mp.l5_mean, f"Last {mp.l5_n} game(s) minutes {num(mp.l5_mean)} (last game {num(mp.last_game)}).", unit="minutes", sample_n=mp.l5_n, window="L5", dataset=LOGS_DS, as_of=self.logs_as_of, stat="minutes")
        if mp.trend is not None and mp.l5_n < mp.season_n:
            self._add("minutes", self.player_subject, "minutes_trend", mp.trend, f"Recent minutes {signed(mp.trend)} versus season average.", unit="minutes", sample_n=mp.l5_n, window="L5-season", dataset=LOGS_DS, as_of=self.logs_as_of, stat="minutes")

    # ----------------------------------------------------------- attempts
    def _attempt_claims(self) -> None:
        ctx = self.ctx
        ap = pf.attempts_profile(ctx.rows_current, ctx.stat)
        if not ap or ap.season_n == 0:
            return
        if ctx.stat.key == "threeMade":
            self._add("shot_profile", self.player_subject, "three_attempts_season", ap.season_mean, f"Season 3PA {num(ap.season_mean)} per game, 3P% {pct(ap.season_pct)} over {ap.season_n} game(s).", unit="per_game", sample_n=ap.season_n, window="season", dataset=LOGS_DS, as_of=self.logs_as_of, stat="threeAttempted")
            if ap.l5_mean is not None:
                self._add("shot_profile", self.player_subject, "three_attempts_l5", ap.l5_mean, f"Last {min(5, ap.season_n)} game(s) 3PA {num(ap.l5_mean)} per game.", unit="per_game", sample_n=min(5, ap.season_n), window="L5", dataset=LOGS_DS, as_of=self.logs_as_of, stat="threeAttempted")
        elif ctx.stat.key == "points":
            self._add("usage", self.player_subject, "fga_season", ap.season_mean, f"Season FGA {num(ap.season_mean)} per game, FG% {pct(ap.season_pct)} over {ap.season_n} game(s).", unit="per_game", sample_n=ap.season_n, window="season", dataset=LOGS_DS, as_of=self.logs_as_of, stat="fgAttempted")

    # ---------------------------------------------------------- home/away
    def _home_away_claims(self) -> None:
        ctx = self.ctx
        venue = pf.home_away_split(ctx.rows_current, ctx.stat, ctx.is_home)
        other = pf.home_away_split(ctx.rows_current, ctx.stat, not ctx.is_home)
        if venue.n == 0 or other.n == 0:
            return
        where = "home" if ctx.is_home else "away"
        self._add("home_away", self.player_subject, f"{where}_mean", venue.mean, f"At {where} this season: {num(venue.mean)} {ctx.stat.label} over {venue.n} game(s) (versus {num(other.mean)} in {other.n} {'away' if ctx.is_home else 'home'} game(s)).", unit="per_game", sample_n=venue.n, window=where, dataset=LOGS_DS, as_of=self.logs_as_of)

    # -------------------------------------------------------------- usage
    def _usage_claims(self) -> None:
        ctx = self.ctx
        up = usage_profile(ctx.rows_current, ctx.boxes)
        if up.season_n == 0:
            return
        self._add("usage", self.player_subject, "usage_season", up.season_mean, f"Season usage rate {num(up.season_mean)}% over {up.season_n} game(s).", unit="pct", sample_n=up.season_n, window="season", dataset=LOGS_DS, as_of=self.logs_as_of, stat="usage", flags=["derived"])
        if up.l5_n and up.l5_n < up.season_n:
            self._add("usage", self.player_subject, "usage_l5", up.l5_mean, f"Last {up.l5_n} game(s) usage rate {num(up.l5_mean)}% ({signed(up.delta)} versus season).", unit="pct", sample_n=up.l5_n, window="L5", dataset=LOGS_DS, as_of=self.logs_as_of, stat="usage", flags=["derived"])

    # ------------------------------------------------------------ matchup
    def _matchup_claims(self) -> None:
        ctx = self.ctx
        boxes = ctx.boxes
        opp = ctx.opponent_code
        label = ctx.stat.label
        min_games = self.cfg.samples.team_min_games
        allowed, n = boxes.allowed_per_game(opp, ctx.stat.team_allowed_fields)
        if allowed is None or n == 0:
            return
        opp_name = ctx.store.teams.name(opp)
        ranks = boxes.allowed_ranks(ctx.stat, min_games)
        rank = ranks.get(opp)
        rank_txt = f" — {box_rank(rank[0], rank[1], f'{label} allowed')}" if rank else ""
        self._add("matchup_allowed", self.opp_subject, "opp_allowed_season", allowed, f"{opp_name} allow {num(allowed)} {label} per game over {n} game(s){rank_txt}.", unit="per_game", sample_n=n, window="season", dataset=LOGS_DS, as_of=self.logs_as_of, flags=["derived"])
        if rank:
            caveat = ""
            if rank[0] <= self.cfg.matchup.top_rank:
                caveat = " One input among many — not an automatic under."
            elif rank[0] >= self.cfg.matchup.bottom_rank:
                caveat = " One input among many — not an automatic over."
            self._add("matchup_allowed", self.opp_subject, "opp_allowed_rank", rank[0], f"{opp_name} are {box_rank(rank[0], rank[1], f'{label} allowed')}.{caveat}", unit="rank", sample_n=n, window="season", dataset=LOGS_DS, as_of=self.logs_as_of, flags=["derived"])
        l5, n5 = boxes.allowed_per_game(opp, ctx.stat.team_allowed_fields, 5)
        if l5 is not None and n5 and n5 < n:
            self._add("matchup_allowed", self.opp_subject, "opp_allowed_l5", l5, f"{opp_name} allow {num(l5)} {label} per game over their last {n5}.", unit="per_game", sample_n=n5, window="L5", dataset=LOGS_DS, as_of=self.logs_as_of, flags=["derived"])
        if ctx.stat.key == "threeMade":
            pct_allowed, pn = boxes.allowed_pct(opp, "threeMade", "threeAttempted")
            if pct_allowed is not None:
                pr = boxes.allowed_pct_ranks("threeMade", "threeAttempted", min_games).get(opp)
                pr_txt = f", {box_rank(pr[0], pr[1], 'opponent 3P% allowed')}" if pr else ""
                self._add("matchup_allowed", self.opp_subject, "opp_three_pct_allowed", pct_allowed, f"{opp_name} opponents shoot {pct(pct_allowed)} from three over {pn} game(s){pr_txt}.", unit="rate", sample_n=pn, window="season", dataset=LOGS_DS, as_of=self.logs_as_of, flags=["derived"])
                if pr:
                    self._add("shot_profile", self.opp_subject, "opp_three_pct_rank", pr[0], f"{opp_name} are {box_rank(pr[0], pr[1], 'opponent 3P% allowed')}.", unit="rank", sample_n=pn, window="season", dataset=LOGS_DS, as_of=self.logs_as_of, flags=["derived"])
            att_allowed, an = boxes.allowed_per_game(opp, ("threeAttempted",))
            if att_allowed is not None:
                self._add("matchup_allowed", self.opp_subject, "opp_three_att_allowed", att_allowed, f"{opp_name} allow {num(att_allowed)} 3PA per game over {an} game(s).", unit="per_game", sample_n=an, window="season", dataset=LOGS_DS, as_of=self.logs_as_of, flags=["derived"], stat="threeAttempted")

    # --------------------------------------------------------------- pace
    def _pace_claims(self) -> None:
        ctx = self.ctx
        boxes = ctx.boxes
        min_games = self.cfg.samples.team_min_games
        opp_pace, n = boxes.pace_per_game(ctx.opponent_code)
        if opp_pace is None:
            return
        ranks = boxes.pace_ranks(min_games)
        rank = ranks.get(ctx.opponent_code)
        rank_txt = f", pace {ordinal(rank[0])} of {rank[1]} (1st = slowest)" if rank else ""
        opp_name = ctx.store.teams.name(ctx.opponent_code)
        self._add("pace", self.opp_subject, "opp_pace", opp_pace, f"{opp_name} games run at {num(opp_pace)} possessions per 40 minutes over {n} game(s){rank_txt}.", unit="poss_per_40", sample_n=n, window="season", dataset=LOGS_DS, as_of=self.logs_as_of, flags=["derived"], stat="pace")
        if rank:
            self._add("pace", self.opp_subject, "opp_pace_rank", rank[0], f"{opp_name} pace is {ordinal(rank[0])} of {rank[1]} (1st = slowest).", unit="rank", sample_n=n, window="season", dataset=LOGS_DS, as_of=self.logs_as_of, flags=["derived"], stat="pace")

    # ------------------------------------------------------- shot profile
    def _shot_profile_claims(self) -> None:
        """Where the player scores from vs the opponent's shot-chart rank in those spots.

        Rank matches the dashboard chart: #1 = hardest (lowest FG% allowed).
        """
        ctx = self.ctx
        if ctx.stat.key not in SCORING_STATS or not ctx.shot_player:
            return
        sp = player_zone_profile(ctx.shot_player)
        if not sp.shot_count:
            return
        p_as_of = ctx.shot_player.generatedAt or "unknown"
        d_as_of = (ctx.shot_defense.generatedAt if ctx.shot_defense else None) or "unknown"
        opp_name = ctx.store.teams.name(ctx.opponent_code)
        defences = defence_zone_profiles(ctx.shot_defense_all, self.cfg.samples.team_min_games)
        opp = defences.get(ctx.opponent_code)
        who = ctx.player.name

        self._add(
            "shot_profile",
            self.player_subject,
            "three_share",
            sp.three_share,
            f"{pct(sp.three_share)} of {who}'s shots are threes ({num(sp.three_fgm, 0)} of {num(sp.three_fga, 0)}, {sp.games_used} game(s)).",
            unit="rate",
            sample_n=sp.games_used,
            window="season",
            dataset=SHOT_P_DS,
            as_of=p_as_of,
            stat="shots",
        )
        if ctx.stat.key == "threeMade":
            if opp and opp.three_fga_allowed:
                self._add(
                    "shot_profile",
                    self.opp_subject,
                    "opp_charted_three_pct",
                    opp.three_pct_allowed,
                    f"{opp_name} allow {pct(opp.three_pct_allowed)} from three ({num(opp.three_fgm_allowed, 0)} of {num(opp.three_fga_allowed, 0)}).",
                    unit="rate",
                    sample_n=opp.games_used,
                    window="season",
                    dataset=SHOT_D_DS,
                    as_of=d_as_of,
                    stat="shots",
                )
            return

        for pz in sp.zones:
            if pz.share_fgm is None or pz.share_fgm < self.cfg.shots.zone_share_min:
                continue
            spot = _zone_name(pz.zone)
            self._add(
                "shot_profile",
                self.player_subject,
                f"zone_share_{pz.zone}",
                pz.share_pts,
                _zone_share_text(who, pz, spot),
                unit="rate",
                sample_n=sp.games_used,
                window="season",
                dataset=SHOT_P_DS,
                as_of=p_as_of,
                stat="shots",
            )
            dz = opp.zone(pz.zone) if opp else None
            if dz and dz.rank:
                tag, extra = _rank_bits(dz.rank)
                self._add(
                    "shot_profile",
                    self.opp_subject,
                    f"opp_zone_rank_{pz.zone}",
                    dz.rank[0],
                    f"{opp_name} are shot-chart {tag} at {spot}{extra}. Opponents shoot {pct(dz.fg_pct_allowed)} there ({num(dz.fgm_allowed, 0)} of {num(dz.fga_allowed, 0)}).",
                    unit="rank",
                    sample_n=opp.games_used,
                    window="season",
                    dataset=SHOT_D_DS,
                    as_of=d_as_of,
                    stat="shots",
                    flags=["derived"],
                )
        if opp:
            zm = zone_matchup(sp, opp, self.cfg.shots.zone_rank_top, self.cfg.shots.zone_rank_bottom, self.cfg.shots.zone_share_min)
            edge_txt = _zone_matchup_text(who, opp_name, zm, sp, opp)
            self._add(
                "shot_profile",
                self.player_subject,
                "zone_matchup_edge",
                zm.edge,
                edge_txt,
                unit="rate",
                sample_n=min(sp.games_used, opp.games_used),
                window="season",
                dataset=SHOT_D_DS,
                as_of=d_as_of,
                stat="shots",
                flags=["derived"],
            )

    # --------------------------------------------------------- rebounding
    def _rebounding_claims(self) -> None:
        ctx = self.ctx
        if ctx.stat.key not in REBOUND_STATS:
            return
        rows = ctx.rows_current
        split = rebound_split(rows)
        if split.n == 0 or split.reb_mean is None:
            return
        self._add("rebounding", self.player_subject, "oreb_mean", split.oreb_mean, f"{ctx.player.name} averages {num(split.reb_mean)} rebounds: {num(split.oreb_mean)} offensive and {num(split.dreb_mean)} defensive over {split.n} game(s).", unit="per_game", sample_n=split.n, window="season", dataset=LOGS_DS, as_of=self.logs_as_of, stat="rebounds")
        self._add("rebounding", self.player_subject, "oreb_share", split.oreb_share, f"{pct(split.oreb_share)} of {ctx.player.name}'s rebounds are offensive.", unit="rate", sample_n=split.n, window="season", dataset=LOGS_DS, as_of=self.logs_as_of, stat="rebounds")
        rates = rebound_rates(rows, ctx.boxes)
        if rates.n:
            self._add("rebounding", self.player_subject, "reb_pct_season", rates.reb_pct, f"Season REB% {num(rates.reb_pct)} (OREB% {num(rates.oreb_pct)}, DREB% {num(rates.dreb_pct)}) over {rates.n} game(s).", unit="pct", sample_n=rates.n, window="season", dataset=LOGS_DS, as_of=self.logs_as_of, stat="rebounds", flags=["derived"])
            l5 = rebound_rates(rows, ctx.boxes, 5)
            if l5.n and l5.n < rates.n and l5.reb_pct is not None and rates.reb_pct is not None:
                self._add("rebounding", self.player_subject, "reb_pct_l5", l5.reb_pct, f"Last {l5.n} game(s) REB% {num(l5.reb_pct)} ({signed(l5.reb_pct - rates.reb_pct)} versus season).", unit="pct", sample_n=l5.n, window="L5", dataset=LOGS_DS, as_of=self.logs_as_of, stat="rebounds", flags=["derived"])
        opp = opponent_boards(ctx.boxes, ctx.opponent_code, self.cfg.samples.team_min_games)
        opp_name = ctx.store.teams.name(ctx.opponent_code)
        if opp.oreb_allowed is not None:
            rk = f", {box_rank(opp.oreb_rank[0], opp.oreb_rank[1], 'offensive rebounds conceded')}" if opp.oreb_rank else ""
            self._add("rebounding", self.opp_subject, "opp_oreb_allowed", opp.oreb_allowed, f"{opp_name} concede {num(opp.oreb_allowed)} offensive rebounds per game over {opp.oreb_n} game(s){rk}.", unit="per_game", sample_n=opp.oreb_n, window="season", dataset=LOGS_DS, as_of=self.logs_as_of, stat="offensiveRebounds", flags=["derived"])
            if opp.oreb_rank:
                self._add("rebounding", self.opp_subject, "opp_oreb_rank", opp.oreb_rank[0], f"{opp_name} are {box_rank(opp.oreb_rank[0], opp.oreb_rank[1], 'offensive rebounds conceded')}.", unit="rank", sample_n=opp.oreb_n, window="season", dataset=LOGS_DS, as_of=self.logs_as_of, stat="offensiveRebounds", flags=["derived"])
        if opp.dreb_allowed is not None:
            rk = f", {box_rank(opp.dreb_rank[0], opp.dreb_rank[1], 'defensive rebounds conceded')}" if opp.dreb_rank else ""
            self._add("rebounding", self.opp_subject, "opp_dreb_allowed", opp.dreb_allowed, f"{opp_name} concede {num(opp.dreb_allowed)} defensive rebounds per game over {opp.dreb_n} game(s){rk}.", unit="per_game", sample_n=opp.dreb_n, window="season", dataset=LOGS_DS, as_of=self.logs_as_of, stat="defensiveRebounds", flags=["derived"])
            if opp.dreb_rank:
                self._add("rebounding", self.opp_subject, "opp_dreb_rank", opp.dreb_rank[0], f"{opp_name} are {box_rank(opp.dreb_rank[0], opp.dreb_rank[1], 'defensive rebounds conceded')}.", unit="rank", sample_n=opp.dreb_n, window="season", dataset=LOGS_DS, as_of=self.logs_as_of, stat="defensiveRebounds", flags=["derived"])
        edge = board_matchup(split, opp, self.cfg.rebounding.top_rank, self.cfg.rebounding.bottom_rank)
        if edge is not None and (opp.oreb_rank or opp.dreb_rank):
            self._add("rebounding", self.player_subject, "board_matchup_edge", edge, f"Weighting {ctx.player.name}'s offensive/defensive rebound split by where {opp_name} rank for boards conceded gives a matchup score of {signed(edge, 2)} (+1 = all boards from zones they leak, -1 = all from zones they protect).", unit="score", sample_n=min(split.n, opp.oreb_n), window="season", dataset=LOGS_DS, as_of=self.logs_as_of, stat="rebounds", flags=["derived"])

    # ---------------------------------------------------------------- h2h
    def _h2h_claims(self) -> None:
        ctx = self.ctx
        label = ctx.stat.label
        opp_name = ctx.store.teams.name(ctx.opponent_code)
        per_year = pf.h2h_rows(ctx.rows_by_year, ctx.opponent_code)
        combined: list[GameLogRow] = []
        for year in sorted(per_year, reverse=True):
            rows = per_year[year]
            if not rows:
                continue
            ws = pf.window_stats(rows, ctx.stat, "h2h", None)
            prior = year != ctx.season_year
            flags: list[ClaimFlag] = ["prior_season"] if prior else []
            season_txt = nbl_season_label(year) if prior else "this season"
            self._add("h2h", self.player_subject, f"h2h_mean_{year}", ws.mean, f"Versus {opp_name} ({season_txt}): {num(ws.mean)} {label} over {ws.n} game(s).", unit="per_game", sample_n=ws.n, window=f"h2h_{year}", dataset=LOGS_DS, as_of=ctx.as_of(f"player_logs_{year}") or self.logs_as_of, flags=flags)
            combined.extend(rows)
        if combined:
            meetings = sorted(combined, key=lambda r: (r.date, r.matchId))
            bits: list[str] = []
            h2h_mins: list[float] = []
            for row in meetings:
                val = stat_value(row, ctx.stat)
                if val is None:
                    continue
                if row.minutes:
                    h2h_mins.append(float(row.minutes))
                day = str(row.date)[:10]
                season = nbl_season_label(row.season) if row.season is not None else ""
                tag = f"{day}" + (f" {season}" if season else "")
                mins = f"{num(row.minutes, 0)} min " if row.minutes else ""
                if ctx.line is not None:
                    if val > ctx.line:
                        result = "over"
                    elif val < ctx.line:
                        result = "under"
                    else:
                        result = "push"
                    bits.append(f"{tag} {mins}{num(val, 0)} {label} ({result})")
                else:
                    bits.append(f"{tag} {mins}{num(val, 0)} {label}")
            prior_flags: list[ClaimFlag] = ["prior_season"] if any(y != ctx.season_year and per_year[y] for y in per_year) else []
            if bits:
                self._add("h2h", self.player_subject, "h2h_games", len(bits), f"All stored H2H vs {opp_name} ({len(bits)} game(s)): {'; '.join(bits)}.", unit="games", sample_n=len(bits), window="h2h", dataset=LOGS_DS, as_of=self.logs_as_of, flags=prior_flags)
            if h2h_mins:
                h2h_mean = sum(h2h_mins) / len(h2h_mins)
                self._add("h2h", self.player_subject, "h2h_minutes_mean", h2h_mean, f"H2H minutes vs {opp_name}: {num(h2h_mean)} per game over {len(h2h_mins)} meeting(s).", unit="minutes", sample_n=len(h2h_mins), window="h2h", dataset=LOGS_DS, as_of=self.logs_as_of, flags=prior_flags)
                now = pf.minutes_profile(ctx.rows_current).season_mean
                if now is not None:
                    self._add("h2h", self.player_subject, "h2h_minutes_vs_now", now - h2h_mean, f"H2H he played {num(h2h_mean)} minutes vs {opp_name}; this season he is at {num(now)}.", unit="minutes", sample_n=len(h2h_mins), window="h2h", dataset=LOGS_DS, as_of=self.logs_as_of, flags=["derived", *prior_flags])
        if combined and ctx.line is not None:
            hr = pf.hit_rate(combined, ctx.stat, ctx.line, "h2h", None)
            flags = ["prior_season"] if any(y != ctx.season_year and per_year[y] for y in per_year) else []
            self._add("h2h", self.player_subject, "h2h_hit_rate", hr.rate, f"Versus {opp_name} (all stored seasons): over {line_text(ctx.line)} {label} in {hr.overs} of {hr.n} game(s) ({pct(hr.rate)}).", unit="rate", sample_n=hr.n, window="h2h", comparison=ctx.line, dataset=LOGS_DS, as_of=self.logs_as_of, flags=flags)

    # ------------------------------------------------------------- injury
    def _injury_claims(self) -> None:
        ctx = self.ctx
        inj_as_of = ctx.as_of("injuries")
        if ctx.injury_self:
            r = ctx.injury_self
            self._add("context", self.player_subject, "self_injury_status", r.status or "listed", f"Injury list: {ctx.player.name} is {r.status or 'listed'} ({r.injury}; return {r.returning}).", dataset=INJ_DS, as_of=inj_as_of, stat="-")
        for teammate, row in ctx.injured_teammates:
            mate_rows = ctx.store.player_logs.get((teammate.player_id, ctx.season_year))
            played_ids = {g.matchId for g in (mate_rows.games if mate_rows else []) if g.minutes and g.minutes > 0}
            ww = with_without(ctx.rows_current, ctx.stat, teammate.player_id, teammate.name, played_ids)
            self._add("context", f"player:{teammate.player_id}", "teammate_out", row.status or "listed", f"Teammate {teammate.name} is {row.status or 'listed'} ({row.injury}; return {row.returning}).", dataset=INJ_DS, as_of=inj_as_of, stat="-")
            suffix = teammate.player_id[:8]
            if ww.with_n:
                self._add("injury_impact", self.player_subject, f"ww_with_{suffix}", ww.with_mean, f"{ctx.stat.label} with {teammate.name} on court: {num(ww.with_mean)} over {ww.with_n} game(s).", unit="per_game", sample_n=ww.with_n, window="with", dataset=LOGS_DS, as_of=self.logs_as_of, flags=["derived"])
            if ww.without_n:
                self._add("injury_impact", self.player_subject, f"ww_without_{suffix}", ww.without_mean, f"{ctx.stat.label} without {teammate.name}: {num(ww.without_mean)} over {ww.without_n} game(s).", unit="per_game", sample_n=ww.without_n, window="without", dataset=LOGS_DS, as_of=self.logs_as_of, flags=["derived"])

    # ------------------------------------------------------------ movement
    def _movement_claims(self) -> None:
        ctx = self.ctx
        mv = ctx.movement
        label = ctx.stat.label
        if mv is None:
            self._add("line_movement", self.game_subject, "line_movement", None, f"No stored line history for this {label} market.", dataset=HIST_DS, as_of=ctx.as_of("player_prop_history"))
            return
        delta = mv.line_delta
        if delta is None:
            self._add("line_movement", self.game_subject, "line_movement", None, f"Line history has {mv.captures} capture(s) but opening and current {label} markets are not comparable.", sample_n=mv.captures, dataset=HIST_DS, as_of=mv.last_at)
            return
        self._add("line_movement", self.game_subject, "line_movement", delta, f"{label} consensus line opened {line_text(mv.first_line)} and is now {line_text(mv.last_line)} ({signed(delta)}) across {mv.captures} capture(s).", unit="line", sample_n=mv.captures, window="open_to_now", dataset=HIST_DS, as_of=mv.last_at)

    # -------------------------------------------------------- game context
    def _game_context_claims(self) -> None:
        ctx = self.ctx
        rest = pf.rest_days(ctx.rows_current[0].date if ctx.rows_current else None, ctx.tipoff)
        if rest is not None:
            self._add("context", self.player_subject, "rest_days", rest, f"{rest} day(s) since {ctx.player.name}'s last game.", unit="days", dataset=LOGS_DS, as_of=self.logs_as_of, stat="-")
        cap = ctx.game_odds_latest
        if cap and cap.bookmakers:
            totals = [float(b.Total.line) for b in cap.bookmakers if b.Total.line not in ("N/A", "")]
            spreads = [float(b.Spread.line) for b in cap.bookmakers if b.Spread.line not in ("N/A", "")]
            if totals:
                from statistics import median

                self._add("context", self.game_subject, "game_total", median(totals), f"Game total {line_text(median(totals))} (median of {len(totals)} book(s)).", unit="line", sample_n=len(totals), dataset=GAME_ODDS_DS, as_of=cap.capturedAt, stat="-")
            if spreads:
                from statistics import median

                self._add("context", self.game_subject, "home_spread", median(spreads), f"Home spread {signed(median(spreads))} (median of {len(spreads)} book(s)).", unit="line", sample_n=len(spreads), dataset=GAME_ODDS_DS, as_of=cap.capturedAt, stat="-")
