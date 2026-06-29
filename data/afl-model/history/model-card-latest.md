# AFL Disposals Model Card

- Generated: 2026-06-29T14:52:31Z
- Model: afl-disp-20260629-145007
- Sample count: 1591
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 53.05%, brier 0.266696, logloss 0.745036, clv+ 21.94%

## Confidence Buckets
- high_0.65_plus: n=587, hit=53.15%
- low: n=501, hit=50.5%
- mid_0.57_0.65: n=503, hit=55.47%

## Edge Buckets
- edge_5_8: n=199, hit=52.26%
- edge_8_plus: n=1016, hit=54.13%
- edge_under_5: n=376, hit=50.53%

## Top Loss Types
- Under->Over: 514
- Over->Under: 233
