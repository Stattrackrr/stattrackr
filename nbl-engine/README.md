# NBL Props Analysis Engine

Evidence-first analysis of NBL player props over StatTrackr's **stored** data and **stored** odds.
It reads `../data` as it exists, never fetches, never invents, and fails closed.

## Setup

```powershell
cd nbl-engine
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
```

## Run

```powershell
.venv\Scripts\python run.py --date 2026-10-03                      # every stored market on that day
.venv\Scripts\python run.py --date 2026-10-03 --game CNS@MEL        # one game (AWY@HOM codes)
.venv\Scripts\python run.py --date 2026-10-03 --player "Joe Ingles" --stat 3PM   # full claim dump
.venv\Scripts\python run.py --inventory                             # data inventory / validation
.venv\Scripts\python run.py --grade out/2026-10-03                  # grade a previous run
.venv\Scripts\python run.py --days 3 --publish-dir ../data/nbl-model/cache/engine-picks   # what CI runs
.venv\Scripts\python -m pytest
```

## Dashboard integration

CI (`nbl-process-stats.yml` nightly, `nbl-player-prop-snapshots.yml` every 2h) runs the engine for
today + 2 days and commits one compact file per date to `data/nbl-model/cache/engine-picks/<date>.json`
(`nbl_engine/output/publish.py`). The web app reads those files in `lib/nbl/enginePicks.ts`.
The Model tab (`app/nbl/components/NblModelPanel.tsx`) is the tennis-style OpenAI chat: it sends
the engine pack to `GET/POST /api/nbl/ask`, which calls the same OpenAI model as tennis
(`gpt-5.6-luna` / `TENNIS_ASK_MODEL`, via `OPENAI_API_KEY`). OpenAI only rewrites facts already
in the pack; invented numbers fall back to the engine template. The Python engine (tiers, claims,
rules) is unchanged.

Outputs land in `out/<date>/<gameKey>/<player>_<stat>.json` (one `PickRecord` each, canonical JSON),
plus `picks.json`, `validation.json`, `skips.json`. Use `--as-of <ISO>` to pin the run time so
freshness gates and the evidence hash are reproducible.

Stats: `3PM PTS REB AST PRA PR PA RA` (keys `threeMade points rebounds assists pra pr pa ra`).

## Architecture

| Layer | Module | Output |
| --- | --- | --- |
| Ingest & validate | `nbl_engine/ingest` | `DataStore` with per-dataset `as_of` and issues; `TeamRegistry` (from schedule); `PlayerRegistry` (Rosetta ids) |
| Features | `nbl_engine/features` | pure functions: windows, hit rates, streaks, minutes, usage, team allowed/pace/ranks (rebuilt from logs), shot zones (player point share by zone vs opponent points allowed per zone, league-ranked), rebounding (OREB/DREB split, REB%/OREB%/DREB%, opponent OREB/DREB conceded ranks), market view + movement |
| Evidence | `nbl_engine/evidence/builder.py` | `ClaimRecord[]` — every fact with dataset, as_of, sample size, fixed sentence |
| Reasoning | `nbl_engine/reasoning/rules.py` | one registered rule per category → `InferenceRecord` (confirmed / not_confirmed / cannot_determine) |
| Scoring | `nbl_engine/scoring/tiers.py` | hard gates, one vote per category, tiers STRONG / LEAN / NO EDGE / AVOID |
| Narrative | `nbl_engine/narrative` | template prose built only from claim/inference text; optional LLM polish; claim verifier |
| Output | `nbl_engine/output` | canonical JSON + SHA-256 evidence hash; results grading |

All thresholds live in `thresholds.toml`.

## Guarantees

* Every number in the narrative is checked against the claim set; a pick whose narrative fails
  verification is downgraded to NO EDGE.
* Gates: stats freshness, odds freshness, minimum games, minimum minutes, line present, player not
  listed Out. A failed gate yields NO EDGE (AVOID for availability).
* Odds are context only: no implied probability, no fair odds, no EV or staking maths.
* Milestone-only markets (no priced under) cannot produce an under pick.
* Prior-season (H2H) claims are flagged `prior_season` and never counted as current form.
* Deterministic: same inputs and `--as-of` produce byte-identical files.

## Data this engine reads

`data/nbl-schedule-*.json`, `nbl-ladder-*.json`, `nbl-rosters-by-team-*.json`,
`nbl-league-player-stats-*.json`, `nbl-player-game-logs-index-*.json`, `nbl-injuries.json`,
`nbl-refresh-stamp.json`, and under `data/nbl-model/cache/`: `player-logs/`, `player-prop-lines/`,
`player-prop-history/` (timestamped delta captures), `game-odds-history/`, `shot-chart-players/`,
`shot-chart-defense/`, `lineups/`.

The Rosetta `nbl-team-stats-*.json` file is deliberately **not** used (its 2026 values are wrong);
team-level numbers are rebuilt from player logs.
