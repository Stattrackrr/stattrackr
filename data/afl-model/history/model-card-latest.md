# AFL Disposals Model Card

- Generated: 2026-04-19T17:21:24Z
- Model: afl-disp-20260419-172015
- Sample count: 390
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 56.41%, brier 0.239413, logloss 0.669369, clv+ 24.62%

## Confidence Buckets
- high_0.65_plus: n=31, hit=80.65%
- low: n=322, hit=53.11%
- mid_0.57_0.65: n=37, hit=64.86%

## Edge Buckets
- edge_5_8: n=156, hit=53.85%
- edge_8_plus: n=76, hit=72.37%
- edge_under_5: n=158, hit=51.27%

## Top Loss Types
- Under->Over: 116
- Over->Under: 54
