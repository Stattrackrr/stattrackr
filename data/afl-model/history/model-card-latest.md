# AFL Disposals Model Card

- Generated: 2026-04-27T18:09:17Z
- Model: afl-disp-20260427-180623
- Sample count: 549
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 55.01%, brier 0.240582, logloss 0.671175, clv+ 26.23%

## Confidence Buckets
- high_0.65_plus: n=78, hit=73.08%
- low: n=436, hit=51.61%
- mid_0.57_0.65: n=35, hit=57.14%

## Edge Buckets
- edge_5_8: n=31, hit=61.29%
- edge_8_plus: n=108, hit=68.52%
- edge_under_5: n=410, hit=50.98%

## Top Loss Types
- Under->Over: 215
- Over->Under: 32
