# AFL Disposals Model Card

- Generated: 2026-04-05T17:17:46Z
- Model: afl-disp-20260405-171627
- Sample count: 78
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 53.85%, brier 0.267212, logloss 0.73065, clv+ 20.51%

## Confidence Buckets
- high_0.65_plus: n=31, hit=51.61%
- low: n=24, hit=66.67%
- mid_0.57_0.65: n=23, hit=43.48%

## Edge Buckets
- edge_5_8: n=13, hit=30.77%
- edge_8_plus: n=49, hit=51.02%
- edge_under_5: n=16, hit=81.25%

## Top Loss Types
- Under->Over: 25
- Over->Under: 11
