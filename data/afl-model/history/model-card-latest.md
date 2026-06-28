# AFL Disposals Model Card

- Generated: 2026-06-28T12:20:35Z
- Model: afl-disp-20260628-121557
- Sample count: 1607
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 53.64%, brier 0.265587, logloss 0.743402, clv+ 22.28%

## Confidence Buckets
- high_0.65_plus: n=589, hit=54.33%
- low: n=520, hit=53.46%
- mid_0.57_0.65: n=498, hit=53.01%

## Edge Buckets
- edge_5_8: n=211, hit=54.5%
- edge_8_plus: n=1027, hit=54.24%
- edge_under_5: n=369, hit=51.49%

## Top Loss Types
- Under->Over: 521
- Over->Under: 224
