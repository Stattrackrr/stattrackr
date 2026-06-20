# AFL Disposals Model Card

- Generated: 2026-06-20T18:12:01Z
- Model: afl-disp-20260620-180917
- Sample count: 1588
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.6%, brier 0.246464, logloss 0.692987, clv+ 20.84%

## Confidence Buckets
- high_0.65_plus: n=25, hit=76.0%
- low: n=1310, hit=52.6%
- mid_0.57_0.65: n=253, hit=62.85%

## Edge Buckets
- edge_5_8: n=181, hit=55.8%
- edge_8_plus: n=249, hit=63.05%
- edge_under_5: n=1158, hit=52.59%

## Top Loss Types
- Under->Over: 535
- Over->Under: 186
