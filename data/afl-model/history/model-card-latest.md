# AFL Disposals Model Card

- Generated: 2026-05-18T18:36:25Z
- Model: afl-disp-20260518-183309
- Sample count: 1041
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.56%, brier 0.245556, logloss 0.684127, clv+ 27.67%

## Confidence Buckets
- high_0.65_plus: n=126, hit=66.67%
- low: n=801, hit=52.31%
- mid_0.57_0.65: n=114, hit=57.02%

## Edge Buckets
- edge_5_8: n=172, hit=51.74%
- edge_8_plus: n=226, hit=62.39%
- edge_under_5: n=643, hit=52.57%

## Top Loss Types
- Under->Over: 416
- Over->Under: 57
