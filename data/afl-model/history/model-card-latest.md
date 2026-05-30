# AFL Disposals Model Card

- Generated: 2026-05-30T12:09:25Z
- Model: afl-disp-20260530-120401
- Sample count: 1323
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 55.71%, brier 0.244429, logloss 0.681758, clv+ 25.85%

## Confidence Buckets
- high_0.65_plus: n=139, hit=69.78%
- low: n=1016, hit=53.64%
- mid_0.57_0.65: n=168, hit=56.55%

## Edge Buckets
- edge_5_8: n=145, hit=60.0%
- edge_8_plus: n=284, hit=60.92%
- edge_under_5: n=894, hit=53.36%

## Top Loss Types
- Under->Over: 516
- Over->Under: 70
