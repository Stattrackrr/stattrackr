# AFL Disposals Model Card

- Generated: 2026-05-08T12:12:09Z
- Model: afl-disp-20260508-120802
- Sample count: 759
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 56.52%, brier 0.240715, logloss 0.673912, clv+ 29.51%

## Confidence Buckets
- high_0.65_plus: n=125, hit=70.4%
- low: n=445, hit=51.46%
- mid_0.57_0.65: n=189, hit=59.26%

## Edge Buckets
- edge_5_8: n=26, hit=69.23%
- edge_8_plus: n=306, hit=63.07%
- edge_under_5: n=427, hit=51.05%

## Top Loss Types
- Under->Over: 264
- Over->Under: 66
