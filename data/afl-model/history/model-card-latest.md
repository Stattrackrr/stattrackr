# AFL Disposals Model Card

- Generated: 2026-08-01T12:03:08Z
- Model: afl-disp-20260801-120142
- Sample count: 932
- Guardrails pass: False
- Promoted: False
- Candidate metrics: hit 50.32%, brier 0.276222, logloss 0.775363, clv+ 17.17%

## Confidence Buckets
- high_0.65_plus: n=317, hit=51.42%
- low: n=326, hit=47.24%
- mid_0.57_0.65: n=289, hit=52.6%

## Edge Buckets
- edge_5_8: n=125, hit=51.2%
- edge_8_plus: n=566, hit=51.77%
- edge_under_5: n=241, hit=46.47%

## Top Loss Types
- Under->Over: 300
- Over->Under: 163
