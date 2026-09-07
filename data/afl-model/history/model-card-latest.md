# AFL Disposals Model Card

- Generated: 2026-09-07T16:18:44Z
- Model: afl-disp-20260907-161758
- Sample count: 290
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 47.24%, brier 0.283438, logloss 0.792291, clv+ 11.72%

## Confidence Buckets
- high_0.65_plus: n=110, hit=50.91%
- low: n=94, hit=43.62%
- mid_0.57_0.65: n=86, hit=46.51%

## Edge Buckets
- edge_5_8: n=39, hit=46.15%
- edge_8_plus: n=186, hit=48.92%
- edge_under_5: n=65, hit=43.08%

## Top Loss Types
- Under->Over: 112
- Over->Under: 41
