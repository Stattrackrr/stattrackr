# AFL Disposals Model Card

- Generated: 2026-05-22T18:35:46Z
- Model: afl-disp-20260522-183037
- Sample count: 1106
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.61%, brier 0.245503, logloss 0.694341, clv+ 26.94%

## Confidence Buckets
- high_0.65_plus: n=74, hit=68.92%
- low: n=873, hit=52.35%
- mid_0.57_0.65: n=159, hit=60.38%

## Edge Buckets
- edge_5_8: n=114, hit=51.75%
- edge_8_plus: n=218, hit=64.22%
- edge_under_5: n=774, hit=52.33%

## Top Loss Types
- Under->Over: 482
- Over->Under: 20
