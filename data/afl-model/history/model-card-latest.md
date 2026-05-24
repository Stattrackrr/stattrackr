# AFL Disposals Model Card

- Generated: 2026-05-24T12:03:37Z
- Model: afl-disp-20260524-120031
- Sample count: 1233
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.58%, brier 0.246265, logloss 0.685389, clv+ 27.01%

## Confidence Buckets
- high_0.65_plus: n=20, hit=60.0%
- low: n=763, hit=51.77%
- mid_0.57_0.65: n=450, hit=59.11%

## Edge Buckets
- edge_5_8: n=283, hit=54.42%
- edge_8_plus: n=244, hit=61.48%
- edge_under_5: n=706, hit=52.27%

## Top Loss Types
- Under->Over: 517
- Over->Under: 43
