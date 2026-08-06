# AFL Disposals Model Card

- Generated: 2026-08-06T12:57:51Z
- Model: afl-disp-20260806-125634
- Sample count: 764
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 51.05%, brier 0.276679, logloss 0.779657, clv+ 16.62%

## Confidence Buckets
- high_0.65_plus: n=256, hit=51.95%
- low: n=270, hit=51.11%
- mid_0.57_0.65: n=238, hit=50.0%

## Edge Buckets
- edge_5_8: n=109, hit=49.54%
- edge_8_plus: n=459, hit=51.42%
- edge_under_5: n=196, hit=51.02%

## Top Loss Types
- Under->Over: 247
- Over->Under: 127
