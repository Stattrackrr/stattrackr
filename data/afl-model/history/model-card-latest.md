# AFL Disposals Model Card

- Generated: 2026-08-26T11:29:08Z
- Model: afl-disp-20260826-112746
- Sample count: 428
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 48.13%, brier 0.276303, logloss 0.781206, clv+ 17.06%

## Confidence Buckets
- high_0.65_plus: n=149, hit=55.7%
- low: n=148, hit=42.57%
- mid_0.57_0.65: n=131, hit=45.8%

## Edge Buckets
- edge_5_8: n=51, hit=45.1%
- edge_8_plus: n=265, hit=51.7%
- edge_under_5: n=112, hit=41.07%

## Top Loss Types
- Under->Over: 158
- Over->Under: 64
