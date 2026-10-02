"""Claim verifier: every number in the narrative must come from a claim.

Checks:
  1. Every numeric token in the narrative appears in some claim's ``as_text``
     (or in the fixed verdict line's line value / tier wording).
  2. Every claim id referenced by inferences exists.
  3. Any pick (STRONG/LEAN) has at least one confirmed inference on its side.
"""

from __future__ import annotations

import re

from nbl_engine.evidence.fmt import line_text
from nbl_engine.models.records import ClaimRecord, InferenceRecord, VerifierResult

_NUM = re.compile(r"(?<![A-Za-z])[+-]?\d+(?:\.\d+)?%?")


def numeric_tokens(text: str) -> list[str]:
    return [m.group(0) for m in _NUM.finditer(text)]


def verify(
    narrative: str,
    claims: list[ClaimRecord],
    inferences: list[InferenceRecord],
    tier: str,
    side: str,
    line: float | None,
) -> VerifierResult:
    issues: list[str] = []
    allowed: set[str] = set()
    for c in claims:
        allowed.update(numeric_tokens(c.as_text))
    for i in inferences:
        allowed.update(numeric_tokens(i.reason))
    if line is not None:
        allowed.add(line_text(line))

    tokens = numeric_tokens(narrative)
    # strip sign for comparison against unsigned claim tokens, keep % attached
    for tok in tokens:
        candidates = {tok, tok.lstrip("+"), tok.lstrip("+-")}
        if not candidates & allowed:
            issues.append(f"number '{tok}' not traceable to a claim")

    claim_ids = {c.id for c in claims}
    for i in inferences:
        for cid in i.claim_ids:
            if cid not in claim_ids:
                issues.append(f"inference {i.rule_id} references missing claim {cid}")
        if i.status == "confirmed" and not i.claim_ids:
            issues.append(f"inference {i.rule_id} confirmed without claims")

    if tier in ("STRONG", "LEAN"):
        if not any(i.status == "confirmed" and i.direction == side for i in inferences):
            issues.append("pick has no confirmed supporting inference")
        if line is None:
            issues.append("pick without a line")

    return VerifierResult(passed=not issues, issues=issues, numbers_checked=len(tokens))
