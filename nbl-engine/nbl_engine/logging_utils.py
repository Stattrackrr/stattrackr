"""Structured logging: every skip / downgrade is recorded with a reason code."""

from __future__ import annotations

import json
import logging
import sys
from dataclasses import dataclass, field
from typing import Any

LOG = logging.getLogger("nbl_engine")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        extra = getattr(record, "ctx", None)
        if isinstance(extra, dict):
            payload.update(extra)
        return json.dumps(payload, sort_keys=True, default=str)


def configure_logging(level: str = "INFO", json_lines: bool = True) -> None:
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(JsonFormatter() if json_lines else logging.Formatter("%(levelname)s %(message)s"))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(getattr(logging, level.upper(), logging.INFO))


@dataclass
class SkipLog:
    """Collects skips so the run summary and the output JSON can list them."""

    entries: list[dict[str, Any]] = field(default_factory=list)

    def skip(self, code: str, **ctx: Any) -> None:
        row = {"code": code, **ctx}
        self.entries.append(row)
        LOG.info("skip", extra={"ctx": {"event": "skip", **row}})

    def note(self, code: str, **ctx: Any) -> None:
        LOG.info(code, extra={"ctx": {"event": "note", **ctx}})

    def counts(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for row in self.entries:
            out[row["code"]] = out.get(row["code"], 0) + 1
        return dict(sorted(out.items()))
