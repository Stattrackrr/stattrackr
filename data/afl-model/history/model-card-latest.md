# AFL Disposals Model Card

- Generated: 2026-09-03T14:54:59Z
- Model: afl-disp-20260903-145342
- Sample count: 290
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 50.69%, brier 0.28512, logloss 0.809748, clv+ 10.69%

## Confidence Buckets
- high_0.65_plus: n=110, hit=49.09%
- low: n=96, hit=51.04%
- mid_0.57_0.65: n=84, hit=52.38%

## Edge Buckets
- edge_5_8: n=45, hit=48.89%
- edge_8_plus: n=179, hit=50.84%
- edge_under_5: n=66, hit=51.52%

## Top Loss Types
- Under->Over: 108
- Over->Under: 35
