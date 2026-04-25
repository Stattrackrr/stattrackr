# AFL Disposals Model Card

- Generated: 2026-04-25T17:26:22Z
- Model: afl-disp-20260425-172334
- Sample count: 494
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 55.06%, brier 0.2415, logloss 0.674505, clv+ 23.89%

## Confidence Buckets
- high_0.65_plus: n=44, hit=70.45%
- low: n=372, hit=50.81%
- mid_0.57_0.65: n=78, hit=66.67%

## Edge Buckets
- edge_5_8: n=62, hit=53.23%
- edge_8_plus: n=118, hit=68.64%
- edge_under_5: n=314, hit=50.32%

## Top Loss Types
- Under->Over: 168
- Over->Under: 54
