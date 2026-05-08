# AFL Disposals Model Card

- Generated: 2026-05-08T18:10:59Z
- Model: afl-disp-20260508-180722
- Sample count: 787
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 56.42%, brier 0.240981, logloss 0.674663, clv+ 27.95%

## Confidence Buckets
- high_0.65_plus: n=152, hit=70.39%
- low: n=615, hit=52.85%
- mid_0.57_0.65: n=20, hit=60.0%

## Edge Buckets
- edge_5_8: n=117, hit=56.41%
- edge_8_plus: n=168, hit=69.05%
- edge_under_5: n=502, hit=52.19%

## Top Loss Types
- Under->Over: 327
- Over->Under: 16
