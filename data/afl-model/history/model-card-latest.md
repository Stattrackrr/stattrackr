# AFL Disposals Model Card

- Generated: 2026-04-25T11:43:27Z
- Model: afl-disp-20260425-113713
- Sample count: 476
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 58.4%, brier 0.23725, logloss 0.665386, clv+ 26.05%

## Confidence Buckets
- high_0.65_plus: n=82, hit=74.39%
- low: n=363, hit=54.82%
- mid_0.57_0.65: n=31, hit=58.06%

## Edge Buckets
- edge_5_8: n=33, hit=60.61%
- edge_8_plus: n=113, hit=69.91%
- edge_under_5: n=330, hit=54.24%

## Top Loss Types
- Under->Over: 149
- Over->Under: 49
