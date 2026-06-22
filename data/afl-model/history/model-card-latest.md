# AFL Disposals Model Card

- Generated: 2026-06-22T15:52:12Z
- Model: afl-disp-20260622-155028
- Sample count: 1627
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 53.35%, brier 0.249251, logloss 0.713233, clv+ 21.45%

## Confidence Buckets
- high_0.65_plus: n=39, hit=61.54%
- low: n=1411, hit=52.37%
- mid_0.57_0.65: n=177, hit=59.32%

## Edge Buckets
- edge_5_8: n=90, hit=57.78%
- edge_8_plus: n=169, hit=59.76%
- edge_under_5: n=1368, hit=52.27%

## Top Loss Types
- Under->Over: 679
- Over->Under: 80
