# AFL Disposals Model Card

- Generated: 2026-06-09T13:46:24Z
- Model: afl-disp-20260609-134418
- Sample count: 1576
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.7%, brier 0.246461, logloss 0.68575, clv+ 24.43%

## Confidence Buckets
- high_0.65_plus: n=44, hit=68.18%
- low: n=1466, hit=53.82%
- mid_0.57_0.65: n=66, hit=65.15%

## Edge Buckets
- edge_5_8: n=910, hit=53.19%
- edge_8_plus: n=132, hit=65.91%
- edge_under_5: n=534, hit=54.49%

## Top Loss Types
- Under->Over: 541
- Over->Under: 173
