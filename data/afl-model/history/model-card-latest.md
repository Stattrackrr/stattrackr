# AFL Disposals Model Card

- Generated: 2026-06-03T15:30:11Z
- Model: afl-disp-20260603-152724
- Sample count: 1399
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.75%, brier 0.246682, logloss 0.686302, clv+ 25.45%

## Confidence Buckets
- high_0.65_plus: n=41, hit=70.73%
- low: n=1238, hit=53.96%
- mid_0.57_0.65: n=120, hit=57.5%

## Edge Buckets
- edge_5_8: n=412, hit=52.43%
- edge_8_plus: n=145, hit=60.69%
- edge_under_5: n=842, hit=54.87%

## Top Loss Types
- Under->Over: 540
- Over->Under: 93
