# AFL Disposals Model Card

- Generated: 2026-05-31T17:56:08Z
- Model: afl-disp-20260531-175409
- Sample count: 1399
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 55.11%, brier 0.245879, logloss 0.684709, clv+ 24.66%

## Confidence Buckets
- high_0.65_plus: n=162, hit=64.81%
- low: n=1142, hit=53.77%
- mid_0.57_0.65: n=95, hit=54.74%

## Edge Buckets
- edge_5_8: n=324, hit=50.62%
- edge_8_plus: n=174, hit=64.37%
- edge_under_5: n=901, hit=54.94%

## Top Loss Types
- Under->Over: 520
- Over->Under: 108
