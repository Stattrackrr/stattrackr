# AFL Disposals Model Card

- Generated: 2026-06-30T13:12:43Z
- Model: afl-disp-20260630-130940
- Sample count: 1576
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 51.9%, brier 0.272345, logloss 0.766251, clv+ 22.65%

## Confidence Buckets
- high_0.65_plus: n=591, hit=53.64%
- low: n=524, hit=49.43%
- mid_0.57_0.65: n=461, hit=52.49%

## Edge Buckets
- edge_5_8: n=213, hit=50.7%
- edge_8_plus: n=986, hit=52.84%
- edge_under_5: n=377, hit=50.13%

## Top Loss Types
- Under->Over: 508
- Over->Under: 250
