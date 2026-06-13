# AFL Disposals Model Card

- Generated: 2026-06-13T12:31:36Z
- Model: afl-disp-20260613-122344
- Sample count: 1590
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.09%, brier 0.248719, logloss 0.698753, clv+ 23.84%

## Confidence Buckets
- high_0.65_plus: n=34, hit=61.76%
- low: n=1398, hit=53.29%
- mid_0.57_0.65: n=158, hit=59.49%

## Edge Buckets
- edge_5_8: n=243, hit=53.5%
- edge_8_plus: n=190, hit=59.47%
- edge_under_5: n=1157, hit=53.33%

## Top Loss Types
- Under->Over: 667
- Over->Under: 63
