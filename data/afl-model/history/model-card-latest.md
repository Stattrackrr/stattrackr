# AFL Disposals Model Card

- Generated: 2026-08-15T11:17:58Z
- Model: afl-disp-20260815-111712
- Sample count: 598
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 50.5%, brier 0.278502, logloss 0.789714, clv+ 16.22%

## Confidence Buckets
- high_0.65_plus: n=208, hit=52.4%
- low: n=204, hit=50.0%
- mid_0.57_0.65: n=186, hit=48.92%

## Edge Buckets
- edge_5_8: n=89, hit=50.56%
- edge_8_plus: n=362, hit=51.38%
- edge_under_5: n=147, hit=48.3%

## Top Loss Types
- Under->Over: 197
- Over->Under: 99
