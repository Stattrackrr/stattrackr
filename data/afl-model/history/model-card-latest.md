# AFL Disposals Model Card

- Generated: 2026-06-11T14:37:13Z
- Model: afl-disp-20260611-143457
- Sample count: 1521
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 55.56%, brier 0.245541, logloss 0.683948, clv+ 23.54%

## Confidence Buckets
- high_0.65_plus: n=11, hit=81.82%
- low: n=1344, hit=54.09%
- mid_0.57_0.65: n=166, hit=65.66%

## Edge Buckets
- edge_5_8: n=865, hit=52.95%
- edge_8_plus: n=187, hit=65.24%
- edge_under_5: n=469, hit=56.5%

## Top Loss Types
- Under->Over: 548
- Over->Under: 128
