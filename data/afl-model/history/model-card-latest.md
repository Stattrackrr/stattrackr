# AFL Disposals Model Card

- Generated: 2026-04-22T12:00:45Z
- Model: afl-disp-20260422-115923
- Sample count: 390
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 56.15%, brier 0.243755, logloss 0.707409, clv+ 24.1%

## Confidence Buckets
- high_0.65_plus: n=18, hit=72.22%
- low: n=303, hit=53.47%
- mid_0.57_0.65: n=69, hit=63.77%

## Edge Buckets
- edge_5_8: n=81, hit=50.62%
- edge_8_plus: n=71, hit=69.01%
- edge_under_5: n=238, hit=54.2%

## Top Loss Types
- Under->Over: 154
- Over->Under: 17
