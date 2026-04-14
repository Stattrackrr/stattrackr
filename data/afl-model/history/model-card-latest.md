# AFL Disposals Model Card

- Generated: 2026-04-14T11:58:15Z
- Model: afl-disp-20260414-115654
- Sample count: 225
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 59.56%, brier 0.228324, logloss 0.643032, clv+ 30.67%

## Confidence Buckets
- high_0.65_plus: n=41, hit=80.49%
- low: n=114, hit=52.63%
- mid_0.57_0.65: n=70, hit=58.57%

## Edge Buckets
- edge_5_8: n=17, hit=35.29%
- edge_8_plus: n=110, hit=66.36%
- edge_under_5: n=98, hit=56.12%

## Top Loss Types
- Under->Over: 88
- Over->Under: 3
