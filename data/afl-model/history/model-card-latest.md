# AFL Disposals Model Card

- Generated: 2026-04-10T17:32:39Z
- Model: afl-disp-20260410-172921
- Sample count: 118
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 54.24%, brier 0.266183, logloss 0.729502, clv+ 26.27%

## Confidence Buckets
- high_0.65_plus: n=38, hit=47.37%
- low: n=41, hit=53.66%
- mid_0.57_0.65: n=39, hit=61.54%

## Edge Buckets
- edge_5_8: n=12, hit=50.0%
- edge_8_plus: n=75, hit=54.67%
- edge_under_5: n=31, hit=54.84%

## Top Loss Types
- Under->Over: 34
- Over->Under: 20
