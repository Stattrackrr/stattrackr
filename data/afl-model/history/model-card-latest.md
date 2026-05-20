# AFL Disposals Model Card

- Generated: 2026-05-20T13:39:18Z
- Model: afl-disp-20260520-133815
- Sample count: 1041
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.75%, brier 0.245402, logloss 0.683531, clv+ 28.43%

## Confidence Buckets
- high_0.65_plus: n=17, hit=64.71%
- low: n=635, hit=51.02%
- mid_0.57_0.65: n=389, hit=60.41%

## Edge Buckets
- edge_5_8: n=69, hit=63.77%
- edge_8_plus: n=386, hit=59.84%
- edge_under_5: n=586, hit=50.34%

## Top Loss Types
- Under->Over: 441
- Over->Under: 30
