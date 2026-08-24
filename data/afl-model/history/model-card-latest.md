# AFL Disposals Model Card

- Generated: 2026-08-24T17:20:27Z
- Model: afl-disp-20260824-171901
- Sample count: 445
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 50.11%, brier 0.268882, logloss 0.754807, clv+ 17.53%

## Confidence Buckets
- high_0.65_plus: n=150, hit=54.67%
- low: n=154, hit=44.81%
- mid_0.57_0.65: n=141, hit=51.06%

## Edge Buckets
- edge_5_8: n=54, hit=50.0%
- edge_8_plus: n=275, hit=52.73%
- edge_under_5: n=116, hit=43.97%

## Top Loss Types
- Under->Over: 150
- Over->Under: 72
