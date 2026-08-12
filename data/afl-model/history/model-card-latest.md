# AFL Disposals Model Card

- Generated: 2026-08-12T11:45:41Z
- Model: afl-disp-20260812-114348
- Sample count: 650
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 50.92%, brier 0.277753, logloss 0.785569, clv+ 16.46%

## Confidence Buckets
- high_0.65_plus: n=227, hit=52.42%
- low: n=219, hit=50.23%
- mid_0.57_0.65: n=204, hit=50.0%

## Edge Buckets
- edge_5_8: n=92, hit=51.09%
- edge_8_plus: n=398, hit=51.76%
- edge_under_5: n=160, hit=48.75%

## Top Loss Types
- Under->Over: 211
- Over->Under: 108
