# AFL Disposals Model Card

- Generated: 2026-04-26T17:27:10Z
- Model: afl-disp-20260426-172543
- Sample count: 549
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 56.83%, brier 0.24005, logloss 0.671095, clv+ 26.41%

## Confidence Buckets
- high_0.65_plus: n=78, hit=73.08%
- low: n=443, hit=53.95%
- mid_0.57_0.65: n=28, hit=57.14%

## Edge Buckets
- edge_5_8: n=127, hit=56.69%
- edge_8_plus: n=84, hit=72.62%
- edge_under_5: n=338, hit=52.96%

## Top Loss Types
- Under->Over: 195
- Over->Under: 42
