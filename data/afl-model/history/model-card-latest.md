# AFL Disposals Model Card

- Generated: 2026-04-11T17:20:09Z
- Model: afl-disp-20260411-171915
- Sample count: 178
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 58.99%, brier 0.237101, logloss 0.665691, clv+ 27.53%

## Confidence Buckets
- high_0.65_plus: n=6, hit=83.33%
- low: n=79, hit=51.9%
- mid_0.57_0.65: n=93, hit=63.44%

## Edge Buckets
- edge_5_8: n=68, hit=55.88%
- edge_8_plus: n=103, hit=62.14%
- edge_under_5: n=7, hit=42.86%

## Top Loss Types
- Under->Over: 73
