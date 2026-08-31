# AFL Disposals Model Card

- Generated: 2026-08-31T21:53:25Z
- Model: afl-disp-20260831-215133
- Sample count: 386
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 48.96%, brier 0.275546, logloss 0.764729, clv+ 16.32%

## Confidence Buckets
- high_0.65_plus: n=131, hit=51.91%
- low: n=129, hit=46.51%
- mid_0.57_0.65: n=126, hit=48.41%

## Edge Buckets
- edge_5_8: n=39, hit=46.15%
- edge_8_plus: n=247, hit=50.2%
- edge_under_5: n=100, hit=47.0%

## Top Loss Types
- Under->Over: 137
- Over->Under: 60
