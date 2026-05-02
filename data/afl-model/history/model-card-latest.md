# AFL Disposals Model Card

- Generated: 2026-05-02T17:34:19Z
- Model: afl-disp-20260502-172905
- Sample count: 698
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 56.3%, brier 0.24245, logloss 0.693432, clv+ 26.79%

## Confidence Buckets
- high_0.65_plus: n=107, hit=69.16%
- low: n=559, hit=53.31%
- mid_0.57_0.65: n=32, hit=65.62%

## Edge Buckets
- edge_5_8: n=55, hit=54.55%
- edge_8_plus: n=145, hit=68.28%
- edge_under_5: n=498, hit=53.01%

## Top Loss Types
- Under->Over: 220
- Over->Under: 85
