# AFL Disposals Model Card

- Generated: 2026-09-02T14:59:59Z
- Model: afl-disp-20260902-145824
- Sample count: 325
- Guardrails pass: True
- Promoted: True
- Candidate metrics: hit 50.15%, brier 0.278021, logloss 0.775588, clv+ 13.85%

## Confidence Buckets
- high_0.65_plus: n=130, hit=53.08%
- low: n=97, hit=53.61%
- mid_0.57_0.65: n=98, hit=42.86%

## Edge Buckets
- edge_5_8: n=45, hit=48.89%
- edge_8_plus: n=207, hit=49.76%
- edge_under_5: n=73, hit=52.05%

## Top Loss Types
- Under->Over: 119
- Over->Under: 43
