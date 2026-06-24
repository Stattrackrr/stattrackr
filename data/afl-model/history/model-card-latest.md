# AFL Disposals Model Card

- Generated: 2026-06-24T13:22:12Z
- Model: afl-disp-20260624-131940
- Sample count: 1609
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.38%, brier 0.247396, logloss 0.701872, clv+ 21.13%

## Confidence Buckets
- high_0.65_plus: n=24, hit=66.67%
- low: n=1406, hit=53.34%
- mid_0.57_0.65: n=179, hit=60.89%

## Edge Buckets
- edge_5_8: n=212, hit=53.3%
- edge_8_plus: n=215, hit=62.33%
- edge_under_5: n=1182, hit=53.13%

## Top Loss Types
- Under->Over: 669
- Over->Under: 65
