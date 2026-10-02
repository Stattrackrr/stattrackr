"""Publish one compact dashboard file per date for the web app.

Shape (data/nbl-model/cache/engine-picks/<date>.json):
  {
    "format": 1, "engine_version", "run_date", "generated_at",
    "data_as_of": {...}, "games": [...], "skips": {code: count},
    "picks": [PickRecord, ...]
  }
Written compactly (no indentation) because it is committed to git on every run.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

from nbl_engine import __version__
from nbl_engine.ingest.timeutil import iso_z
from nbl_engine.output.serialize import _plain

if TYPE_CHECKING:
    from nbl_engine.pipeline import Engine, RunSummary

PUBLISH_FORMAT = 1


def publish_payload(summary: "RunSummary", engine: "Engine", run_time: datetime) -> dict:
    return {
        "format": PUBLISH_FORMAT,
        "engine_version": __version__,
        "run_date": summary.run_date,
        "generated_at": iso_z(run_time),
        "data_as_of": engine.store.as_of_map(),
        "stats_fresh": engine.store.stats_fresh(),
        "games": summary.games,
        "skips": summary.skip_counts(),
        # Per-pick data_as_of is identical to the top-level map; drop it to keep the committed file small.
        "picks": [{k: v for k, v in pick.items() if k != "data_as_of"} for pick in _plain(summary.picks)],
    }


def publish_day(publish_dir: Path, summary: "RunSummary", engine: "Engine", run_time: datetime) -> Path:
    publish_dir.mkdir(parents=True, exist_ok=True)
    path = publish_dir / f"{summary.run_date}.json"
    payload = publish_payload(summary, engine, run_time)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n")
    return path
