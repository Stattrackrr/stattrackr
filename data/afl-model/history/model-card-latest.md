# AFL Disposals Model Card

- Generated: 2026-05-16T11:51:59Z
- Model: afl-disp-20260516-114826
- Sample count: 975
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 53.95%, brier 0.244769, logloss 0.682085, clv+ 28.21%

## Confidence Buckets
- high_0.65_plus: n=63, hit=71.43%
- low: n=746, hit=50.94%
- mid_0.57_0.65: n=166, hit=60.84%

## Edge Buckets
- edge_5_8: n=18, hit=55.56%
- edge_8_plus: n=229, hit=63.76%
- edge_under_5: n=728, hit=50.82%

## Top Loss Types
- Under->Over: 449
