# AFL Disposals Model Card

- Generated: 2026-07-31T12:56:11Z
- Model: afl-disp-20260731-125431
- Sample count: 953
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 50.68%, brier 0.276067, logloss 0.775158, clv+ 16.89%

## Confidence Buckets
- high_0.65_plus: n=326, hit=51.23%
- low: n=336, hit=47.62%
- mid_0.57_0.65: n=291, hit=53.61%

## Edge Buckets
- edge_5_8: n=126, hit=52.38%
- edge_8_plus: n=578, hit=52.08%
- edge_under_5: n=249, hit=46.59%

## Top Loss Types
- Under->Over: 306
- Over->Under: 164
