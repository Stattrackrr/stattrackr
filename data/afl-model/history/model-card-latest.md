# AFL Disposals Model Card

- Generated: 2026-08-22T11:18:55Z
- Model: afl-disp-20260822-111812
- Sample count: 491
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.18%, brier 0.267848, logloss 0.762031, clv+ 15.89%

## Confidence Buckets
- high_0.65_plus: n=173, hit=55.49%
- low: n=158, hit=54.43%
- mid_0.57_0.65: n=160, hit=52.5%

## Edge Buckets
- edge_5_8: n=76, hit=55.26%
- edge_8_plus: n=309, hit=52.75%
- edge_under_5: n=106, hit=57.55%

## Top Loss Types
- Under->Over: 162
- Over->Under: 63
