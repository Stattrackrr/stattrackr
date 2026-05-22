# AFL Disposals Model Card

- Generated: 2026-05-22T13:37:38Z
- Model: afl-disp-20260522-133010
- Sample count: 1106
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.25%, brier 0.246586, logloss 0.686113, clv+ 26.85%

## Confidence Buckets
- high_0.65_plus: n=47, hit=68.09%
- low: n=879, hit=52.9%
- mid_0.57_0.65: n=180, hit=57.22%

## Edge Buckets
- edge_5_8: n=416, hit=54.57%
- edge_8_plus: n=234, hit=57.69%
- edge_under_5: n=456, hit=52.19%

## Top Loss Types
- Under->Over: 421
- Over->Under: 85
