# AFL Disposals Model Card

- Generated: 2026-08-21T11:23:19Z
- Model: afl-disp-20260821-112219
- Sample count: 555
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 50.27%, brier 0.278811, logloss 0.792714, clv+ 14.77%

## Confidence Buckets
- high_0.65_plus: n=183, hit=51.91%
- low: n=195, hit=48.21%
- mid_0.57_0.65: n=177, hit=50.85%

## Edge Buckets
- edge_5_8: n=83, hit=49.4%
- edge_8_plus: n=333, hit=51.05%
- edge_under_5: n=139, hit=48.92%

## Top Loss Types
- Under->Over: 186
- Over->Under: 90
