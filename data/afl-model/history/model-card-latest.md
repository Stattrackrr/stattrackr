# AFL Disposals Model Card

- Generated: 2026-06-13T18:11:01Z
- Model: afl-disp-20260613-180700
- Sample count: 1590
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.72%, brier 0.246785, logloss 0.686573, clv+ 23.02%

## Confidence Buckets
- high_0.65_plus: n=43, hit=67.44%
- low: n=1269, hit=53.03%
- mid_0.57_0.65: n=278, hit=60.43%

## Edge Buckets
- edge_5_8: n=355, hit=51.83%
- edge_8_plus: n=251, hit=60.96%
- edge_under_5: n=984, hit=54.17%

## Top Loss Types
- Under->Over: 617
- Over->Under: 103
