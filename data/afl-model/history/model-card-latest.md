# AFL Disposals Model Card

- Generated: 2026-05-09T17:47:53Z
- Model: afl-disp-20260509-174431
- Sample count: 861
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 55.28%, brier 0.242661, logloss 0.678083, clv+ 26.36%

## Confidence Buckets
- high_0.65_plus: n=155, hit=69.03%
- low: n=698, hit=52.15%
- mid_0.57_0.65: n=8, hit=62.5%

## Edge Buckets
- edge_5_8: n=147, hit=51.02%
- edge_8_plus: n=163, hit=68.71%
- edge_under_5: n=551, hit=52.45%

## Top Loss Types
- Under->Over: 284
- Over->Under: 101
