# AFL Disposals Model Card

- Generated: 2026-07-10T18:32:37Z
- Model: afl-disp-20260710-182815
- Sample count: 1254
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 52.63%, brier 0.266658, logloss 0.742365, clv+ 18.02%

## Confidence Buckets
- high_0.65_plus: n=374, hit=51.07%
- low: n=473, hit=53.49%
- mid_0.57_0.65: n=407, hit=53.07%

## Edge Buckets
- edge_5_8: n=185, hit=52.97%
- edge_8_plus: n=719, hit=52.43%
- edge_under_5: n=350, hit=52.86%

## Top Loss Types
- Under->Over: 383
- Over->Under: 211
