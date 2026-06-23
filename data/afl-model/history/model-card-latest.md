# AFL Disposals Model Card

- Generated: 2026-06-23T13:45:55Z
- Model: afl-disp-20260623-134355
- Sample count: 1609
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.2%, brier 0.248168, logloss 0.69087, clv+ 22.06%

## Confidence Buckets
- high_0.65_plus: n=34, hit=61.76%
- low: n=1472, hit=53.46%
- mid_0.57_0.65: n=103, hit=62.14%

## Edge Buckets
- edge_5_8: n=233, hit=54.08%
- edge_8_plus: n=123, hit=64.23%
- edge_under_5: n=1253, hit=53.23%

## Top Loss Types
- Under->Over: 571
- Over->Under: 166
