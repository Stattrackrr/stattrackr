# AFL Disposals Model Card

- Generated: 2026-06-05T13:57:10Z
- Model: afl-disp-20260605-135222
- Sample count: 1442
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.72%, brier 0.246084, logloss 0.68501, clv+ 25.38%

## Confidence Buckets
- high_0.65_plus: n=39, hit=76.92%
- low: n=1363, hit=53.85%
- mid_0.57_0.65: n=40, hit=62.5%

## Edge Buckets
- edge_5_8: n=466, hit=51.93%
- edge_8_plus: n=116, hit=65.52%
- edge_under_5: n=860, hit=54.77%

## Top Loss Types
- Under->Over: 625
- Over->Under: 28
