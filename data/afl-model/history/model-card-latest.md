# AFL Disposals Model Card

- Generated: 2026-06-08T14:50:51Z
- Model: afl-disp-20260608-144743
- Sample count: 1576
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.82%, brier 0.246091, logloss 0.685575, clv+ 24.24%

## Confidence Buckets
- high_0.65_plus: n=121, hit=66.94%
- low: n=1430, hit=53.64%
- mid_0.57_0.65: n=25, hit=64.0%

## Edge Buckets
- edge_5_8: n=256, hit=53.52%
- edge_8_plus: n=130, hit=66.92%
- edge_under_5: n=1190, hit=53.78%

## Top Loss Types
- Under->Over: 633
- Over->Under: 79
