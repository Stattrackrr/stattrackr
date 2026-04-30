# AFL Disposals Model Card

- Generated: 2026-04-30T12:19:43Z
- Model: afl-disp-20260430-121435
- Sample count: 575
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 55.83%, brier 0.241774, logloss 0.674803, clv+ 28.52%

## Confidence Buckets
- high_0.65_plus: n=108, hit=68.52%
- low: n=369, hit=51.76%
- mid_0.57_0.65: n=98, hit=57.14%

## Edge Buckets
- edge_5_8: n=5, hit=60.0%
- edge_8_plus: n=205, hit=63.41%
- edge_under_5: n=365, hit=51.51%

## Top Loss Types
- Over->Under: 146
- Under->Over: 108
