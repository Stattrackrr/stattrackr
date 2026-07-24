# AFL Disposals Model Card

- Generated: 2026-07-24T12:19:32Z
- Model: afl-disp-20260724-121816
- Sample count: 1057
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 51.37%, brier 0.273989, logloss 0.769538, clv+ 17.69%

## Confidence Buckets
- high_0.65_plus: n=371, hit=52.29%
- low: n=365, hit=48.22%
- mid_0.57_0.65: n=321, hit=53.89%

## Edge Buckets
- edge_5_8: n=141, hit=50.35%
- edge_8_plus: n=639, hit=52.9%
- edge_under_5: n=277, hit=48.38%

## Top Loss Types
- Under->Over: 332
- Over->Under: 182
