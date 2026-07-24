# AFL Disposals Model Card

- Generated: 2026-07-24T18:12:33Z
- Model: afl-disp-20260724-181021
- Sample count: 1007
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 53.82%, brier 0.264405, logloss 0.736336, clv+ 15.89%

## Confidence Buckets
- high_0.65_plus: n=300, hit=53.33%
- low: n=389, hit=54.5%
- mid_0.57_0.65: n=318, hit=53.46%

## Edge Buckets
- edge_5_8: n=137, hit=51.82%
- edge_8_plus: n=586, hit=53.58%
- edge_under_5: n=284, hit=55.28%

## Top Loss Types
- Under->Over: 299
- Over->Under: 166
