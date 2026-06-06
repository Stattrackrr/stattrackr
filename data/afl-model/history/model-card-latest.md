# AFL Disposals Model Card

- Generated: 2026-06-06T12:10:25Z
- Model: afl-disp-20260606-120521
- Sample count: 1486
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.78%, brier 0.246238, logloss 0.685285, clv+ 25.24%

## Confidence Buckets
- high_0.65_plus: n=49, hit=71.43%
- low: n=1437, hit=54.21%

## Edge Buckets
- edge_5_8: n=365, hit=52.6%
- edge_8_plus: n=69, hit=68.12%
- edge_under_5: n=1052, hit=54.66%

## Top Loss Types
- Under->Over: 606
- Over->Under: 66
