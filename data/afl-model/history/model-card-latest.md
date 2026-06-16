# AFL Disposals Model Card

- Generated: 2026-06-16T15:55:20Z
- Model: afl-disp-20260616-155151
- Sample count: 1608
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.17%, brier 0.249765, logloss 0.735532, clv+ 24.13%

## Confidence Buckets
- high_0.65_plus: n=36, hit=61.11%
- low: n=1399, hit=53.4%
- mid_0.57_0.65: n=173, hit=58.96%

## Edge Buckets
- edge_5_8: n=260, hit=53.08%
- edge_8_plus: n=211, hit=59.24%
- edge_under_5: n=1137, hit=53.47%

## Top Loss Types
- Under->Over: 622
- Over->Under: 115
