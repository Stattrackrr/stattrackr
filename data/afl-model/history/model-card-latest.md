# AFL Disposals Model Card

- Generated: 2026-08-04T13:00:33Z
- Model: afl-disp-20260804-125924
- Sample count: 811
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 50.68%, brier 0.275759, logloss 0.776827, clv+ 16.77%

## Confidence Buckets
- high_0.65_plus: n=269, hit=52.42%
- low: n=290, hit=49.31%
- mid_0.57_0.65: n=252, hit=50.4%

## Edge Buckets
- edge_5_8: n=113, hit=50.44%
- edge_8_plus: n=485, hit=51.75%
- edge_under_5: n=213, hit=48.36%

## Top Loss Types
- Under->Over: 259
- Over->Under: 141
