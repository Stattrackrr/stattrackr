#!/usr/bin/env python3
"""
Keep only pickle files referenced by latest live/candidate artifacts.

Historical afl-disp-*.pkl blobs were accumulating in Git LFS and burning the
free 10GB/month bandwidth on every Actions/Vercel clone.
"""

from __future__ import annotations

import argparse
import json
import os
from typing import Set

MODEL_DIR = os.path.join("data", "afl-model")
MODELS_DIR = os.path.join(MODEL_DIR, "models")
KEEP_ARTIFACTS = ("latest-model.json", "latest-candidate-model.json")


def _pickle_name_from_artifact(path: str) -> str | None:
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except Exception:
        return None
    rel = str(payload.get("modelPicklePath") or "").strip().replace("\\", "/")
    if not rel:
        return None
    return os.path.basename(rel)


def collect_keep_names(extra_keep: int) -> Set[str]:
    keep: Set[str] = set()
    for name in KEEP_ARTIFACTS:
        pkl = _pickle_name_from_artifact(os.path.join(MODELS_DIR, name))
        if pkl:
            keep.add(pkl)

    # Optionally retain the newest N versioned pickles as a small rollback buffer.
    if extra_keep > 0 and os.path.isdir(MODELS_DIR):
        versioned = sorted(
            (
                f
                for f in os.listdir(MODELS_DIR)
                if f.startswith("afl-disp-") and f.endswith(".pkl")
            ),
            reverse=True,
        )
        keep.update(versioned[:extra_keep])
    return keep


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--extra-keep",
        type=int,
        default=0,
        help="Also keep the N newest versioned pickles (default: 0 = only latest refs)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be deleted without deleting",
    )
    args = parser.parse_args()

    if not os.path.isdir(MODELS_DIR):
        print(f"[prune-pickles] Missing {MODELS_DIR}; nothing to do")
        return 0

    keep = collect_keep_names(max(0, args.extra_keep))
    if not keep:
        print("[prune-pickles] No keep-list from latest artifacts; refusing to delete")
        return 1

    removed = 0
    kept = 0
    for name in sorted(os.listdir(MODELS_DIR)):
        if not (name.startswith("afl-disp-") and name.endswith(".pkl")):
            continue
        path = os.path.join(MODELS_DIR, name)
        if name in keep:
            kept += 1
            print(f"[prune-pickles] keep {name}")
            continue
        removed += 1
        print(f"[prune-pickles] {'would remove' if args.dry_run else 'remove'} {name}")
        if not args.dry_run:
            os.remove(path)

    print(f"[prune-pickles] kept={kept} removed={removed} dry_run={args.dry_run}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
