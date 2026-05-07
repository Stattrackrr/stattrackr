# AFL Disposals Model Card

- Generated: 2026-05-07T12:31:03Z
- Model: afl-disp-20260507-122844
- Sample count: 742
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 56.2%, brier 0.241866, logloss 0.676332, clv+ 28.57%

## Confidence Buckets
- high_0.65_plus: n=172, hit=68.02%
- low: n=497, hit=51.91%
- mid_0.57_0.65: n=73, hit=57.53%

## Edge Buckets
- edge_5_8: n=48, hit=58.33%
- edge_8_plus: n=229, hit=64.63%
- edge_under_5: n=465, hit=51.83%

## Top Loss Types
- Under->Over: 303
- Over->Under: 22
