# AFL Disposals Model Card

- Generated: 2026-07-06T14:28:05Z
- Model: afl-disp-20260706-142605
- Sample count: 1417
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 53.0%, brier 0.269733, logloss 0.757925, clv+ 20.04%

## Confidence Buckets
- high_0.65_plus: n=578, hit=54.5%
- low: n=414, hit=50.0%
- mid_0.57_0.65: n=425, hit=53.88%

## Edge Buckets
- edge_5_8: n=166, hit=47.59%
- edge_8_plus: n=944, hit=54.34%
- edge_under_5: n=307, hit=51.79%

## Top Loss Types
- Under->Over: 477
- Over->Under: 189
