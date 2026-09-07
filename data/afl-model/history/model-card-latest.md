# AFL Disposals Model Card

- Generated: 2026-09-07T20:24:00Z
- Model: afl-disp-20260907-202255
- Sample count: 289
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 48.79%, brier 0.283755, logloss 0.786937, clv+ 17.99%

## Confidence Buckets
- high_0.65_plus: n=99, hit=50.51%
- low: n=93, hit=52.69%
- mid_0.57_0.65: n=97, hit=43.3%

## Edge Buckets
- edge_5_8: n=34, hit=47.06%
- edge_8_plus: n=187, hit=47.59%
- edge_under_5: n=68, hit=52.94%

## Top Loss Types
- Under->Over: 99
- Over->Under: 49
