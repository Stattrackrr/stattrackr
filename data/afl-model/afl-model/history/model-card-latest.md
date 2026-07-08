# AFL Disposals Model Card

- Generated: 2026-07-08T12:30:28Z
- Model: afl-disp-20260708-122249
- Sample count: 1299
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 52.81%, brier 0.267783, logloss 0.745394, clv+ 18.17%

## Confidence Buckets
- high_0.65_plus: n=438, hit=52.05%
- low: n=450, hit=50.44%
- mid_0.57_0.65: n=411, hit=56.2%

## Edge Buckets
- edge_5_8: n=159, hit=52.2%
- edge_8_plus: n=806, hit=53.6%
- edge_under_5: n=334, hit=51.2%

## Top Loss Types
- Under->Over: 433
- Over->Under: 180
