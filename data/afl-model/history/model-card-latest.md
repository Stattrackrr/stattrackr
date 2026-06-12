# AFL Disposals Model Card

- Generated: 2026-06-12T14:12:57Z
- Model: afl-disp-20260612-140937
- Sample count: 1534
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 55.54%, brier 0.245565, logloss 0.683721, clv+ 24.12%

## Confidence Buckets
- high_0.65_plus: n=68, hit=67.65%
- low: n=1420, hit=54.58%
- mid_0.57_0.65: n=46, hit=67.39%

## Edge Buckets
- edge_5_8: n=732, hit=52.87%
- edge_8_plus: n=100, hit=71.0%
- edge_under_5: n=702, hit=56.13%

## Top Loss Types
- Under->Over: 521
- Over->Under: 161
