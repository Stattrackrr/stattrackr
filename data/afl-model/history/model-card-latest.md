# AFL Disposals Model Card

- Generated: 2026-07-31T18:22:11Z
- Model: afl-disp-20260731-181856
- Sample count: 932
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 53.54%, brier 0.265475, logloss 0.740863, clv+ 16.2%

## Confidence Buckets
- high_0.65_plus: n=274, hit=52.92%
- low: n=353, hit=53.54%
- mid_0.57_0.65: n=305, hit=54.1%

## Edge Buckets
- edge_5_8: n=127, hit=50.39%
- edge_8_plus: n=537, hit=53.63%
- edge_under_5: n=268, hit=54.85%

## Top Loss Types
- Under->Over: 279
- Over->Under: 154
