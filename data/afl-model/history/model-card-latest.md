# AFL Disposals Model Card

- Generated: 2026-04-06T13:36:34Z
- Model: afl-disp-20260406-133618
- Sample count: 100
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 55.0%, brier 0.2642, logloss 0.725017, clv+ 25.0%

## Confidence Buckets
- high_0.65_plus: n=38, hit=47.37%
- low: n=33, hit=57.58%
- mid_0.57_0.65: n=29, hit=62.07%

## Edge Buckets
- edge_5_8: n=18, hit=50.0%
- edge_8_plus: n=62, hit=53.23%
- edge_under_5: n=20, hit=65.0%

## Top Loss Types
- Under->Over: 29
- Over->Under: 16
