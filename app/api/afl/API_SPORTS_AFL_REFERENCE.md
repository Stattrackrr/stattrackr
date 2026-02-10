# API-Sports AFL API reference

**Official documentation:** https://api-sports.io/documentation/afl/v1  

**Base URL:** `https://v1.afl.api-sports.io`  
**Auth header:** `x-apisports-key: YOUR_API_KEY`

Always confirm endpoint paths and parameters in the official docs above; they may differ from other API-Sports sports.

## Endpoints used in this app

| Purpose        | Endpoint               | Typical params              | Notes                          |
|----------------|------------------------|-----------------------------|--------------------------------|
| Leagues        | `GET /leagues`         | `season=2025`               | Optional; get league id(s).    |
| Teams          | `GET /teams`          | `league=1&season=2025` or `season=2025` | Try with and without `league`. |
| Players        | `GET /players`        | `team={id}&season=2025`     | Players for one team.          |
| Player stats   | `GET /players/statistics` | `id={playerId}&season=2025` | Stats for one player.          |

## Response shape

- Success: API often returns `{ response: [ ... ] }` or `{ data: [ ... ] }`.
- Errors: `{ errors: { ... } }` or similar; we surface these in `_apiError` when the app returns no data.

## If something breaks

1. Open https://api-sports.io/documentation/afl/v1 and check the exact path and parameter names for each endpoint.
2. Test a request with the proxy: `GET /api/afl/leagues?season=2025` or use the catch-all `/api/afl/[...path]` (e.g. `/api/afl/teams?league=1&season=2025`) to see the raw API response.
3. When the player-stats route returns empty, check the response for `_hint` and `_apiError` to see what the API returned.
