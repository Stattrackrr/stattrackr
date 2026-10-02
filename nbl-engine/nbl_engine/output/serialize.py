"""Byte-for-byte deterministic JSON for evidence and picks."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel


def _plain(obj: Any) -> Any:
    if isinstance(obj, BaseModel):
        return obj.model_dump(mode="json")
    if isinstance(obj, dict):
        return {str(k): _plain(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_plain(v) for v in obj]
    if isinstance(obj, float):
        return round(obj, 6)
    return obj


def canonical_json(obj: Any) -> str:
    """Sorted keys, fixed separators, rounded floats, trailing newline."""
    return json.dumps(_plain(obj), sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n"


def sha256_of(obj: Any) -> str:
    return hashlib.sha256(canonical_json(obj).encode("utf-8")).hexdigest()


def write_canonical(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(canonical_json(obj))


def pretty_json(obj: Any) -> str:
    return json.dumps(_plain(obj), sort_keys=True, indent=2, ensure_ascii=False) + "\n"
