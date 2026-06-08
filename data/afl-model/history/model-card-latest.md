# AFL Disposals Model Card

- Generated: 2026-06-08T19:03:19Z
- Model: afl-disp-20260608-185848
- Sample count: 1576
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.82%, brier 0.245857, logloss 0.684512, clv+ 24.18%

## Confidence Buckets
- high_0.65_plus: n=59, hit=72.88%
- low: n=1517, hit=54.12%

## Edge Buckets
- edge_5_8: n=799, hit=53.57%
- edge_8_plus: n=111, hit=65.77%
- edge_under_5: n=666, hit=54.5%

## Top Loss Types
- Under->Over: 548
- Over->Under: 164
