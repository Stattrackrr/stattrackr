# AFL Disposals Model Card

- Generated: 2026-08-08T11:26:06Z
- Model: afl-disp-20260808-112505
- Sample count: 760
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 50.92%, brier 0.277335, logloss 0.781188, clv+ 15.66%

## Confidence Buckets
- high_0.65_plus: n=254, hit=51.57%
- low: n=269, hit=51.3%
- mid_0.57_0.65: n=237, hit=49.79%

## Edge Buckets
- edge_5_8: n=109, hit=49.54%
- edge_8_plus: n=456, hit=51.1%
- edge_under_5: n=195, hit=51.28%

## Top Loss Types
- Under->Over: 246
- Over->Under: 127
