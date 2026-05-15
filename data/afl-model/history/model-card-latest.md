# AFL Disposals Model Card

- Generated: 2026-05-15T18:20:17Z
- Model: afl-disp-20260515-181530
- Sample count: 939
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.53%, brier 0.243885, logloss 0.680593, clv+ 27.48%

## Confidence Buckets
- high_0.65_plus: n=144, hit=68.75%
- low: n=713, hit=51.33%
- mid_0.57_0.65: n=82, hit=57.32%

## Edge Buckets
- edge_5_8: n=38, hit=47.37%
- edge_8_plus: n=210, hit=65.24%
- edge_under_5: n=691, hit=51.66%

## Top Loss Types
- Under->Over: 407
- Over->Under: 20
