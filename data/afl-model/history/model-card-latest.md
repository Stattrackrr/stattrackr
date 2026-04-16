# AFL Disposals Model Card

- Generated: 2026-04-16T18:08:47Z
- Model: afl-disp-20260416-180559
- Sample count: 240
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 59.58%, brier 0.235734, logloss 0.660911, clv+ 30.42%

## Confidence Buckets
- high_0.65_plus: n=49, hit=71.43%
- low: n=84, hit=55.95%
- mid_0.57_0.65: n=107, hit=57.01%

## Edge Buckets
- edge_5_8: n=78, hit=56.41%
- edge_8_plus: n=152, hit=61.84%
- edge_under_5: n=10, hit=50.0%

## Top Loss Types
- Under->Over: 96
- Over->Under: 1
