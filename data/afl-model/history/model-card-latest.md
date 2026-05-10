# AFL Disposals Model Card

- Generated: 2026-05-10T17:48:13Z
- Model: afl-disp-20260510-174616
- Sample count: 900
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 55.0%, brier 0.244101, logloss 0.681156, clv+ 26.44%

## Confidence Buckets
- high_0.65_plus: n=151, hit=66.89%
- low: n=709, hit=52.05%
- mid_0.57_0.65: n=40, hit=62.5%

## Edge Buckets
- edge_5_8: n=91, hit=53.85%
- edge_8_plus: n=190, hit=66.32%
- edge_under_5: n=619, hit=51.7%

## Top Loss Types
- Under->Over: 295
- Over->Under: 110
