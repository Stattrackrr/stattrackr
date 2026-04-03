# AFL Disposals Model Runbook (V1)

This is the first hybrid model pipeline:
- Python trains/scores
- Next.js serves projections from `data/afl-model/latest-disposals-projections.json`
- Fetch-heavy steps run in batches with default concurrency `50`.
- Player logs are disk-cached under `data/afl-model/cache/player-logs` (default TTL 12h) to speed repeated runs.

## Prerequisites

- Python 3.10+
- Local app running for API-backed dataset/score steps:
  - `npm run dev`
- Optional but recommended: `scikit-learn` for stronger model candidates.
  - Without it, training falls back to baseline only.

## Daily Commands

From repo root:

- Refresh external context data first:
  - `npm run fetch:afl:dfs-usage`
  - `npm run fetch:afl:weather-context`

- Build dataset:
  - `npm run afl:model:dataset`
- Train model:
  - `npm run afl:model:train`
  - Optional speed flags:
    - `python scripts/afl_model/train_disposals_model.py --importance-max-rows 1200`
- Score upcoming disposals props:
  - `npm run afl:model:score`
- Full run:
  - `npm run afl:model:run`

Concurrency/batching defaults:
- `build_dataset.py`: `--concurrency 50 --batch-size 50`
- `score_upcoming.py`: `--concurrency 50 --batch-size 50`

Current extra context in model features:
- DFS usage file (`data/afl-dfs-usage-*.json`): CBA% + kick-ins
- OA team allowances: disposals + supporting allowances

## Output Files

- Datasets:
  - `data/afl-model/datasets/afl-disposals-train-<timestamp>.csv`
  - `data/afl-model/datasets/latest-dataset.json`
- Model artifacts:
  - `data/afl-model/models/latest-model.json`
  - `data/afl-model/models/<version>.json`
  - `data/afl-model/models/<version>.pkl` (when sklearn model wins)
- Projections:
  - `data/afl-model/latest-disposals-projections.json`
  - `data/afl-model/projections/disposals-projections-<timestamp>.json`

## How It Appears In App

- List API enrichment (`/api/afl/player-props/list`) appends:
  - `expectedDisposals`
  - `modelPOver`
  - `modelEdgeVsMarket`
  - `modelVersion`, `modelScoredAt`
- AFL page (`/afl`) shows a compact disposals model card when:
  - mode is Player Props
  - main chart stat is Disposals
  - home/away + line context are available

## Quality Checks

After training, inspect:
- `data/afl-model/models/<version>.metrics.json`
- MAE/RMSE trend over time
- `dropCandidates` in `latest-model.json` (features repeatedly negative in permutation MAE lift)
- projection row count in latest projections file

If row count is unexpectedly low:
- confirm dev server is running
- verify `/api/afl/player-props/list?enrich=false` returns disposals rows
- check player logs endpoint responds for current + prior seasons
