# AFL Disposals Model Card

- Generated: 2026-06-02T14:53:01Z
- Model: afl-disp-20260602-145043
- Sample count: 1399
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.61%, brier 0.248036, logloss 0.690674, clv+ 25.95%

## Confidence Buckets
- high_0.65_plus: n=14, hit=57.14%
- low: n=1218, hit=53.61%
- mid_0.57_0.65: n=167, hit=61.68%

## Edge Buckets
- edge_5_8: n=316, hit=49.37%
- edge_8_plus: n=187, hit=62.03%
- edge_under_5: n=896, hit=54.91%

## Top Loss Types
- Under->Over: 582
- Over->Under: 53
