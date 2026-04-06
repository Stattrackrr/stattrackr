# AFL Disposals Model Card

- Generated: 2026-04-06T11:46:44Z
- Model: afl-disp-20260406-114600
- Sample count: 100
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 53.0%, brier 0.269388, logloss 0.737051, clv+ 21.0%

## Confidence Buckets
- high_0.65_plus: n=42, hit=47.62%
- low: n=29, hit=55.17%
- mid_0.57_0.65: n=29, hit=58.62%

## Edge Buckets
- edge_5_8: n=15, hit=53.33%
- edge_8_plus: n=64, hit=53.12%
- edge_under_5: n=21, hit=52.38%

## Top Loss Types
- Under->Over: 32
- Over->Under: 15
