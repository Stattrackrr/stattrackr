# AFL Disposals Model Card

- Generated: 2026-04-30T18:10:41Z
- Model: afl-disp-20260430-180714
- Sample count: 575
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.43%, brier 0.24228, logloss 0.674302, clv+ 25.04%

## Confidence Buckets
- high_0.65_plus: n=89, hit=67.42%
- low: n=445, hit=51.01%
- mid_0.57_0.65: n=41, hit=63.41%

## Edge Buckets
- edge_5_8: n=36, hit=52.78%
- edge_8_plus: n=99, hit=68.69%
- edge_under_5: n=440, hit=51.36%

## Top Loss Types
- Under->Over: 190
- Over->Under: 72
