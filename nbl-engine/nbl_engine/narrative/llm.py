"""Optional LLM polish of the template narrative.

Uses OpenAI by default when OPENAI_API_KEY is set (same model as tennis:
gpt-5.6-luna / TENNIS_ASK_MODEL). Override with NBL_ENGINE_LLM_URL / KEY / MODEL.
The model receives only the claim sentences and the template narrative, is told
to restate them without new numbers, and its output is accepted only if the
claim verifier passes. Otherwise the template narrative is returned unchanged.
"""

from __future__ import annotations

import json
import os
import urllib.request
from collections.abc import Callable

from nbl_engine.logging_utils import LOG
from nbl_engine.models.records import ClaimRecord, InferenceRecord
from nbl_engine.narrative.verifier import verify

Provider = Callable[[str, str], str]  # (system, user) -> text

SYSTEM_PROMPT = (
    "You rewrite basketball prop analysis into clear analyst prose. "
    "You must only use facts and numbers present in the provided claim sentences. "
    "Never add, round, estimate, or compute numbers. Never add players, teams, or injuries not listed. "
    "Keep every number exactly as written, including percent signs and signs. Keep the verdict unchanged."
)


def env_provider() -> Provider | None:
    url = os.environ.get("NBL_ENGINE_LLM_URL") or "https://api.openai.com/v1/chat/completions"
    key = os.environ.get("NBL_ENGINE_LLM_KEY") or os.environ.get("OPENAI_API_KEY")
    model = os.environ.get("NBL_ENGINE_LLM_MODEL") or os.environ.get("TENNIS_ASK_MODEL") or "gpt-5.6-luna"
    if not key:
        return None

    def call(system: str, user: str) -> str:
        payload: dict = {"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        if "gpt-5" in model or "luna" in model:
            payload["max_completion_tokens"] = 1100
            payload["reasoning_effort"] = "medium"
        else:
            payload["temperature"] = 0
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
        with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310 - explicit opt-in endpoint
            data = json.loads(resp.read().decode("utf-8"))
        return str(data["choices"][0]["message"]["content"])

    return call


def polish_narrative(
    template_text: str,
    claims: list[ClaimRecord],
    inferences: list[InferenceRecord],
    tier: str,
    side: str,
    line: float | None,
    provider: Provider | None,
) -> tuple[str, bool]:
    """Return (narrative, used_llm). Falls back to the template on any failure."""
    if provider is None:
        return template_text, False
    facts = "\n".join(f"- {c.as_text}" for c in claims)
    user = f"Claim sentences:\n{facts}\n\nTemplate narrative:\n{template_text}\n\nRewrite the template as flowing analyst prose using only these facts."
    try:
        candidate = provider(SYSTEM_PROMPT, user).strip()
    except Exception as exc:  # network / provider failure -> template
        LOG.warning("llm polish failed", extra={"ctx": {"event": "llm_error", "error": str(exc)}})
        return template_text, False
    result = verify(candidate, claims, inferences, tier, side, line)
    if not result.passed:
        LOG.info("llm output rejected by verifier", extra={"ctx": {"event": "llm_rejected", "issues": result.issues[:5]}})
        return template_text, False
    return candidate, True
