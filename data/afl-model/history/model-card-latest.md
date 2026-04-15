# AFL Disposals Model Card

- Generated: 2026-04-15T11:57:45Z
- Model: afl-disp-20260415-115525
- Sample count: 225
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 60.44%, brier 0.231568, logloss 0.702961, clv+ 29.78%

## Confidence Buckets
- high_0.65_plus: n=83, hit=71.08%
- low: n=122, hit=54.92%
- mid_0.57_0.65: n=20, hit=50.0%

## Edge Buckets
- edge_5_8: n=91, hit=54.95%
- edge_8_plus: n=95, hit=67.37%
- edge_under_5: n=39, hit=56.41%

## Top Loss Types
- Under->Over: 79
- Over->Under: 10
