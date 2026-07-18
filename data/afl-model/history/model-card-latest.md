# AFL Disposals Model Card

- Generated: 2026-07-18T11:53:51Z
- Model: afl-disp-20260718-115222
- Sample count: 1097
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 53.6%, brier 0.268032, logloss 0.747197, clv+ 18.41%

## Confidence Buckets
- high_0.65_plus: n=377, hit=51.72%
- low: n=373, hit=53.08%
- mid_0.57_0.65: n=347, hit=56.2%

## Edge Buckets
- edge_5_8: n=173, hit=53.76%
- edge_8_plus: n=660, hit=53.03%
- edge_under_5: n=264, hit=54.92%

## Top Loss Types
- Under->Over: 346
- Over->Under: 163
