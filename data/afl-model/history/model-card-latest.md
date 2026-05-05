# AFL Disposals Model Card

- Generated: 2026-05-05T12:00:26Z
- Model: afl-disp-20260505-115931
- Sample count: 742
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 55.8%, brier 0.242126, logloss 0.676764, clv+ 28.03%

## Confidence Buckets
- high_0.65_plus: n=145, hit=67.59%
- low: n=440, hit=51.14%
- mid_0.57_0.65: n=157, hit=57.96%

## Edge Buckets
- edge_5_8: n=64, hit=65.62%
- edge_8_plus: n=273, hit=60.81%
- edge_under_5: n=405, hit=50.86%

## Top Loss Types
- Under->Over: 299
- Over->Under: 29
