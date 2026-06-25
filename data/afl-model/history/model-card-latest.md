# AFL Disposals Model Card

- Generated: 2026-06-25T13:20:55Z
- Model: afl-disp-20260625-131508
- Sample count: 1595
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.11%, brier 0.248088, logloss 0.690856, clv+ 21.25%

## Confidence Buckets
- high_0.65_plus: n=86, hit=61.63%
- low: n=1448, hit=53.31%
- mid_0.57_0.65: n=61, hit=62.3%

## Edge Buckets
- edge_5_8: n=18, hit=72.22%
- edge_8_plus: n=147, hit=61.9%
- edge_under_5: n=1430, hit=53.08%

## Top Loss Types
- Under->Over: 666
- Over->Under: 66
