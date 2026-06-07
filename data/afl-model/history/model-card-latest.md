# AFL Disposals Model Card

- Generated: 2026-06-07T12:25:57Z
- Model: afl-disp-20260607-121936
- Sample count: 1552
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 55.22%, brier 0.246142, logloss 0.6859, clv+ 24.1%

## Confidence Buckets
- high_0.65_plus: n=45, hit=71.11%
- low: n=1413, hit=54.35%
- mid_0.57_0.65: n=94, hit=60.64%

## Edge Buckets
- edge_5_8: n=774, hit=54.39%
- edge_8_plus: n=137, hit=64.96%
- edge_under_5: n=641, hit=54.13%

## Top Loss Types
- Under->Over: 605
- Over->Under: 90
