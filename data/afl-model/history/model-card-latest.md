# AFL Disposals Model Card

- Generated: 2026-04-18T11:38:26Z
- Model: afl-disp-20260418-113254
- Sample count: 320
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 58.13%, brier 0.231987, logloss 0.654965, clv+ 25.31%

## Confidence Buckets
- high_0.65_plus: n=64, hit=78.12%
- low: n=162, hit=50.62%
- mid_0.57_0.65: n=94, hit=57.45%

## Edge Buckets
- edge_5_8: n=11, hit=72.73%
- edge_8_plus: n=147, hit=65.31%
- edge_under_5: n=162, hit=50.62%

## Top Loss Types
- Under->Over: 128
- Over->Under: 6
