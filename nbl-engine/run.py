"""CLI entry point.

  python run.py --date 2026-10-03
  python run.py --date 2026-10-03 --game CNS@MEL
  python run.py --date 2026-10-03 --player "Chris Goulding" --stat 3PM
  python run.py --inventory                # data inventory / validation only
  python run.py --grade out/2026-10-03     # grade a previous run's picks
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from nbl_engine.features.stats import STATS, resolve_stat
from nbl_engine.ingest.timeutil import local_date
from nbl_engine.logging_utils import configure_logging
from nbl_engine.models.records import PickRecord
from nbl_engine.narrative.llm import env_provider
from nbl_engine.output.grading import grade_all
from nbl_engine.output.publish import publish_day
from nbl_engine.output.serialize import pretty_json, write_canonical
from nbl_engine.paths import ENGINE_ROOT
from nbl_engine.pipeline import Engine, RunOptions


def _parse_args(argv: list[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="NBL Props Analysis Engine")
    ap.add_argument("--date", help="Game date YYYY-MM-DD (Australia/Brisbane calendar day); defaults to today when --days is given")
    ap.add_argument("--days", type=int, default=1, help="Analyse this many consecutive days starting at --date (default 1)")
    ap.add_argument("--publish-dir", help="Also write one compact dashboard file per date (<dir>/<date>.json) for the web app")
    ap.add_argument("--game", help="Filter to one game as AWY@HOM team codes, e.g. CNS@MEL")
    ap.add_argument("--player", help="Filter to one player by name")
    ap.add_argument("--stat", help="Stat key or alias: 3PM, PTS, REB, AST, PRA, PR, PA, RA")
    ap.add_argument("--out", default=str(ENGINE_ROOT / "out"), help="Output directory (default nbl-engine/out)")
    ap.add_argument("--inventory", action="store_true", help="Print the data inventory / validation report and exit")
    ap.add_argument("--grade", help="Grade picks in a previous run directory (e.g. out/2026-10-03)")
    ap.add_argument("--llm", action="store_true", help="Enable optional LLM narrative polish (needs OPENAI_API_KEY or NBL_ENGINE_LLM_KEY)")
    ap.add_argument("--as-of", help="Override run time (ISO) for reproducible freshness checks")
    ap.add_argument("--log", default="WARNING", help="Log level (DEBUG/INFO/WARNING)")
    ap.add_argument("--quiet", action="store_true", help="Suppress the human summary")
    return ap.parse_args(argv)


def _print_summary(summary, stream=sys.stdout) -> None:
    print(f"\nNBL Props Engine run for {summary.run_date}", file=stream)
    print(f"Games: {', '.join(summary.games) if summary.games else 'none'}", file=stream)
    v = summary.validation
    print(f"Stats fresh: {v.get('stats_fresh')} (age {v.get('stats_age_hours') and round(v['stats_age_hours'], 1)}h)", file=stream)
    issues = [(d['name'], d['issues']) for d in v.get("datasets", []) if d.get("issues")]
    for name, iss in issues:
        print(f"  dataset {name}: {'; '.join(iss)}", file=stream)
    picks = summary.picks
    print(f"\nAnalysed {len(picks)} player/stat market(s)", file=stream)
    order = {"STRONG": 0, "LEAN": 1, "AVOID": 2, "NO EDGE": 3}
    for p in sorted(picks, key=lambda p: (order[p.tier], -max(p.score_over, p.score_under), p.player_name)):
        if p.tier == "NO EDGE" and len(picks) > 40:
            continue
        line = f"{p.line:g}" if p.line is not None else "-"
        cats = ",".join(p.confirmed_categories) if p.confirmed_categories else "-"
        flag = "" if p.verifier.passed else "  [VERIFIER FAILED]"
        print(f"  {p.tier:<8} {p.side:<7} {p.game_label:<8} {p.player_name:<24} {p.stat_label:<4} {line:<5} O{p.score_over:.2f}/U{p.score_under:.2f}  {cats}{flag}", file=stream)
    hidden = sum(1 for p in picks if p.tier == "NO EDGE") if len(picks) > 40 else 0
    if hidden:
        print(f"  ... {hidden} NO EDGE market(s) omitted from the console view (see picks.json)", file=stream)
    counts = {}
    for s in summary.skips:
        counts[s["code"]] = counts.get(s["code"], 0) + 1
    if counts:
        print("\nSkips: " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())), file=stream)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(sys.argv[1:] if argv is None else argv)
    configure_logging(args.log)
    run_time = datetime.fromisoformat(args.as_of).astimezone(timezone.utc) if args.as_of else datetime.now(timezone.utc)

    if args.grade:
        engine = Engine(run_time=run_time)
        run_dir = Path(args.grade)
        picks: list[PickRecord] = []
        for file in sorted(run_dir.rglob("*.json")):
            if file.name in ("picks.json", "validation.json", "skips.json", "grades.json"):
                continue
            try:
                picks.append(PickRecord.model_validate_json(file.read_text(encoding="utf-8")))
            except Exception:
                continue
        result = grade_all(picks, engine.store)
        write_canonical(run_dir / "grades.json", result)
        print(pretty_json({"tally": result["tally"], "graded": len(result["graded"])}))
        return 0

    if args.inventory:
        engine = Engine(run_time=run_time)
        print(pretty_json(engine.store.validation_report()))
        return 0

    if not args.date and args.days <= 0:
        print("--date is required (or use --inventory / --grade)", file=sys.stderr)
        return 2
    try:
        start_date = date.fromisoformat(args.date) if args.date else local_date(run_time)
    except ValueError:
        print("--date must be YYYY-MM-DD", file=sys.stderr)
        return 2
    assert start_date is not None
    stat_key = None
    if args.stat:
        sd = resolve_stat(args.stat)
        if not sd:
            print(f"Unknown stat '{args.stat}'. Known: {', '.join(s.label for s in STATS.values())}", file=sys.stderr)
            return 2
        stat_key = sd.key

    engine = Engine(run_time=run_time)
    provider = env_provider() if args.llm else None
    if args.llm and provider is None:
        print("--llm requested but OPENAI_API_KEY / NBL_ENGINE_LLM_KEY not set; using template narrative", file=sys.stderr)

    summaries = []
    for offset in range(max(1, args.days)):
        run_date = start_date + timedelta(days=offset)
        summary = engine.run(RunOptions(run_date=run_date, game=args.game, player=args.player, stat=stat_key, out_dir=Path(args.out), llm=provider))
        summaries.append(summary)
        if args.publish_dir:
            publish_day(Path(args.publish_dir), summary, engine, run_time)
        if args.quiet:
            continue
        _print_summary(summary)
        if args.player:
            for p in summary.picks:
                print("\n" + "=" * 100)
                print(f"{p.player_name} {p.stat_label} {p.game_label}  ->  {p.tier} {p.side.upper()} {p.line if p.line is not None else '-'}")
                print("-" * 100)
                print(p.narrative)
                print("-" * 100)
                print("claims:")
                for c in p.claims:
                    print(f"  [{c.id}] ({c.category}) n={c.sample_n} as_of={c.source_as_of[:19]} {c.as_text}")
                print("inferences:")
                for i in p.inferences:
                    print(f"  {i.rule_id:<24} {i.status:<16} {i.direction:<7} w={i.weight}")
                print(f"evidence sha256: {p.evidence_sha256}")
                print(f"verifier: {'passed' if p.verifier.passed else 'FAILED ' + json.dumps(p.verifier.issues)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
