# AFL Disposals Model Card

- Generated: 2026-05-15T12:35:44Z
- Model: afl-disp-20260515-123020
- Sample count: 926
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 54.54%, brier 0.243714, logloss 0.679872, clv+ 27.32%

## Confidence Buckets
- high_0.65_plus: n=190, hit=66.84%
- low: n=730, hit=51.37%
- mid_0.57_0.65: n=6, hit=50.0%

## Edge Buckets
- edge_5_8: n=47, hit=57.45%
- edge_8_plus: n=196, hit=66.33%
- edge_under_5: n=683, hit=50.95%

## Top Loss Types
- Under->Over: 393
- Over->Under: 28
