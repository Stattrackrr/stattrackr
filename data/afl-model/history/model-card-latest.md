# AFL Disposals Model Card

- Generated: 2026-05-10T11:50:43Z
- Model: afl-disp-20260510-114902
- Sample count: 900
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 55.11%, brier 0.243496, logloss 0.679699, clv+ 30.89%

## Confidence Buckets
- high_0.65_plus: n=82, hit=70.73%
- low: n=494, hit=50.2%
- mid_0.57_0.65: n=324, hit=58.64%

## Edge Buckets
- edge_5_8: n=47, hit=57.45%
- edge_8_plus: n=374, hit=61.5%
- edge_under_5: n=479, hit=49.9%

## Top Loss Types
- Under->Over: 215
- Over->Under: 189
