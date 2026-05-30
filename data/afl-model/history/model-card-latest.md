# AFL Disposals Model Card

- Generated: 2026-05-30T17:56:33Z
- Model: afl-disp-20260530-175327
- Sample count: 1347
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 55.16%, brier 0.245905, logloss 0.684746, clv+ 24.57%

## Confidence Buckets
- high_0.65_plus: n=187, hit=63.64%
- low: n=1048, hit=53.53%
- mid_0.57_0.65: n=112, hit=56.25%

## Edge Buckets
- edge_5_8: n=206, hit=50.97%
- edge_8_plus: n=214, hit=62.62%
- edge_under_5: n=927, hit=54.37%

## Top Loss Types
- Under->Over: 481
- Over->Under: 123
