# AFL Disposals Model Card

- Generated: 2026-07-30T12:30:13Z
- Model: afl-disp-20260730-122827
- Sample count: 956
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 50.73%, brier 0.275983, logloss 0.774933, clv+ 16.53%

## Confidence Buckets
- high_0.65_plus: n=328, hit=51.22%
- low: n=336, hit=47.62%
- mid_0.57_0.65: n=292, hit=53.77%

## Edge Buckets
- edge_5_8: n=126, hit=52.38%
- edge_8_plus: n=581, hit=52.15%
- edge_under_5: n=249, hit=46.59%

## Top Loss Types
- Under->Over: 307
- Over->Under: 164
