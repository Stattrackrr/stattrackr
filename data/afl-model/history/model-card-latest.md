# AFL Disposals Model Card

- Generated: 2026-05-01T17:53:47Z
- Model: afl-disp-20260501-174937
- Sample count: 618
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 55.02%, brier 0.243472, logloss 0.714749, clv+ 27.67%

## Confidence Buckets
- high_0.65_plus: n=86, hit=67.44%
- low: n=477, hit=51.57%
- mid_0.57_0.65: n=55, hit=65.45%

## Edge Buckets
- edge_5_8: n=19, hit=68.42%
- edge_8_plus: n=140, hit=65.71%
- edge_under_5: n=459, hit=51.2%

## Top Loss Types
- Under->Over: 269
- Over->Under: 9
