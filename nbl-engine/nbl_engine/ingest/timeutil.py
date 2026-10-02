"""Timestamp helpers. Stored timestamps are ISO-8601; naive values are UTC."""

from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

AU_TZ = ZoneInfo("Australia/Brisbane")  # NBL schedule's reference zone (no DST)


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def local_date(value: str | datetime | None) -> date | None:
    """Calendar date of an instant in the NBL's home zone."""
    dt = value if isinstance(value, datetime) else parse_iso(value)
    if dt is None:
        return None
    return dt.astimezone(AU_TZ).date()


def hours_between(later: datetime, earlier: datetime) -> float:
    return (later - earlier).total_seconds() / 3600.0


def iso_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
