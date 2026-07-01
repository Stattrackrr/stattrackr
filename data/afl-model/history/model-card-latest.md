# AFL Disposals Model Card

- Generated: 2026-07-01T13:36:46Z
- Model: afl-disp-20260701-133333
- Sample count: 1503
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 52.1%, brier 0.271817, logloss 0.766136, clv+ 22.82%

## Confidence Buckets
- high_0.65_plus: n=555, hit=53.33%
- low: n=503, hit=49.5%
- mid_0.57_0.65: n=445, hit=53.48%

## Edge Buckets
- edge_5_8: n=200, hit=53.0%
- edge_8_plus: n=939, hit=52.93%
- edge_under_5: n=364, hit=49.45%

## Top Loss Types
- Under->Over: 479
- Over->Under: 241
