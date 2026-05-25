# AFL Disposals Model Card

- Generated: 2026-05-25T18:27:18Z
- Model: afl-disp-20260525-182353
- Sample count: 1233
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.99%, brier 0.246036, logloss 0.685122, clv+ 26.93%

## Confidence Buckets
- high_0.65_plus: n=55, hit=69.09%
- low: n=1030, hit=53.5%
- mid_0.57_0.65: n=148, hit=60.14%

## Edge Buckets
- edge_5_8: n=178, hit=51.12%
- edge_8_plus: n=195, hit=62.56%
- edge_under_5: n=860, hit=54.07%

## Top Loss Types
- Under->Over: 524
- Over->Under: 31
