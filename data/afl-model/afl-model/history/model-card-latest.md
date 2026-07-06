# AFL Disposals Model Card

- Generated: 2026-07-06T18:53:27Z
- Model: afl-disp-20260706-184519
- Sample count: 1377
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 51.78%, brier 0.266385, logloss 0.740895, clv+ 20.04%

## Confidence Buckets
- high_0.65_plus: n=455, hit=54.29%
- low: n=471, hit=49.04%
- mid_0.57_0.65: n=451, hit=52.11%

## Edge Buckets
- edge_5_8: n=168, hit=50.0%
- edge_8_plus: n=849, hit=53.0%
- edge_under_5: n=360, hit=49.72%

## Top Loss Types
- Under->Over: 422
- Over->Under: 242
