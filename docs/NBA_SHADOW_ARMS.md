# NBA prop shadow arms

Four frozen research policies judge the same logged snapshots, quotes and inputs. Each records its
own would-be bets in `nba_shadow_bets`. Nothing here posts a pick. Live NBA AI picks still come from
the existing model and are not connected to any arm.

## Reading the weekly scoreboard (owner)

Every Monday the `nba-model-report` cron saves one row per arm. To see it now, without saving anything:

```
npx tsx scripts/_probe-nba-arms.ts            # build it from the tables
npx tsx scripts/_probe-nba-arms.ts --saved    # the one the cron last saved
npx tsx scripts/_probe-nba-arms.ts --replay   # run every arm over the latest logged slate, no writes
```

For each arm, read in this order:

1. **Bets.** Recorded, confirmed (the price passed the phantom-price rule; only these count), and how many have a closing value yet.
2. **CLV total, (a), (b).** Total is what the bet was worth against the closing line. (a) is the price against the fair price at the moment of the bet: line shopping. (b) is the fair price moving the bet's way afterwards: the part only a real edge produces. Each has a 95% range and a 99% lower bound.
3. **Sample.** How many bets the arm needs. The number is measured from the arm's first two weeks and then fixed.
4. **Reopen.** `READY` only when all of these hold: the sample is reached, (b) has a 99% lower bound above 0, total has a 99% lower bound above 0, and calibration holds for overs and for unders. The row lists whatever is still missing.
5. **Futility.** `STOP` when the 95% upper bound of total CLV is below +1%.

**Positive total CLV that comes from (a) alone does not reopen anything.** That is what arm A shows today (total +4.6%, (a) +6.8%, (b) -2.2%), and it is what arm D is expected to show. Arm D is the yardstick: an arm is only interesting if its (b) is clearly better than D's.

Below the arms, the residual fit has two lines: the fit on all logged lines (as before) and the fit on lines with sound inputs (`inputs-v6` onward). Coefficients can be promoted only when the sound-inputs fit has 10 ET dates and 300 graded t2h lines and beats the raw market out of fold (lower bound of the lift above 0).

### When an arm can go live

Never automatically. An arm is a candidate when its row reads `READY`. Then:

1. The owner decides to wire it. That is a separate change to `lib/aiPicks`; this build contains none.
2. `selectPromotableArm()` in `lib/nba/model/promote.ts` returns the arm only if `NBA_ARM_LIVE_POSTING=on` is set and the arm clears every reopen rule. The variable is unset everywhere, and nothing calls the function yet.

The scoreboard's last line shows the switch and the promotable arm. It should read `OFF (default)` and `none`.

### What not to do

- Don't change an arm's thresholds because of a week's results. A change means new versions and a new sample.
- Don't reset arm A. Its versions (`shadow-v0.1`, `v0-market`), sample and 8-week kill / pivot decision are unchanged.

## The arms

| Arm | Name | `policy_version` | `model_version` | Decides on | Rule |
| --- | --- | --- | --- | --- | --- |
| A | control | `shadow-v0.1` | `v0-market` | t2h, injury_change | As before this build: best AU price per side against the fair with that book left out, EV >= 3%. Unconfirmed prices are recorded and flagged. |
| B | role-shock | `arm-b-role-v1` | `b-role-v1` | t2h | Only lines where tonight's minutes or usage input is in its top decile, only on the side it points to, best confirmed AU price, 4+ books, price no worse than fair. |
| C | news-lag | `arm-c-lag-v1` | `c-lag-v1` | injury_change, us_move | Both US books moved the same way, or a rotation teammate's status changed in the last 15 minutes. Bets that side at an AU price that was already up before the move and is confirmed, when it pays 3%+ against the US fair. 4+ books. |
| D | clean-shopping | `arm-d-shop-v1` | `d-shop-v1` | t2h | Best confirmed AU price per side against the fair with that book left out, 4+ books, EV between 3% and 20%. No inputs. |

Frozen constants (`lib/nba/propLog/arms.ts`), set on 15 Nov 2026 from the inputs' own spread and from bet counts, not from results:

| Constant | Value | Why |
| --- | --- | --- |
| `ARM_MIN_BOOKS` | 4 | B, C and D need a real consensus. |
| `B_MINUTES_Z_MIN` | 0.18 | 90th percentile of the size of `minutes_new_info_z` (0.178). |
| `B_USAGE_Z_MIN` | 0.05 | 90th percentile of `usage_shift_z` (0.048). |
| `B_MIN_EV` | 0 | See the note below. |
| `C_MIN_EV` | 0.03 | Against the US fair after the move. |
| `C_NEWS_MAX_AGE_MIN` | 15 | How long a teammate's status change counts as fresh. |
| `D_MIN_EV` / `D_MAX_EV` | 0.03 / 0.20 | The same bar as arm A; above 20% over 4+ books is a feed error. |

**Arm B's EV bar is 0, not the 5-8% suggested in the brief.** Until fitted coefficients are promoted, arm B scores with the market itself, so a higher bar would only be a line-shopping bar, and at +5% the arm finds fewer than 2 lines a night (about 9 at this bar). Its edge has to show as (b). To use a higher bar instead, change `B_MIN_EV` before the first deploy; after that it needs new versions.

Arm C direction: line up, or the over shorter at the same line, means the US books expect more. Both books must agree. A teammate moving toward out points to the over, toward available to the under.

## How rows stay apart

`nba_shadow_bets` is unique on `(policy, policy_version, trigger_snapshot_id, side)`. Every arm has its own `policy_version`, so arms never overwrite each other and no schema change was needed. `policy` stays `main` (t2h) or `news` (events); a bet decided on a US move is stored as `news` with `features.trigger = 'us_move'`. Every row also carries `features.arm`.

One logger run decides all arms from the same triggers and price memory, then makes one read (news bets already taken) and one batched write. An arm that throws loses only its own rows and is reported in the run's `skipped` list. Deciding all four arms on a full slate takes about 10ms per run.

## Where things are stored

| Key | Contents |
| --- | --- |
| `nba_model_report_v1` | Arm A's full report with the fits and the scoreboard (as before, plus `clean` and `scoreboard`). |
| `nba_model_report_v1:{model_version}` | Each arm's full report. |
| `nba_model_arms_v1` | The scoreboard on its own. |
| `nba_model_fit_gate_v1` | `gate` (all lines, as before), `cleanGate`, `promoteShadow`. |

Each is also saved under `:{YYYY-MM-DD}`.

## inputs-v6: three input bugs fixed

The minutes and usage coefficients were close to zero because their inputs were wrong, and the fit could not have used them anyway:

1. **Dates.** Game logs were dated by UTC tip time but compared with tonight's US Eastern day. On a real back to back the previous night's game was missing from the player's history, and "back to back" fired on one day of rest (55% of team games flagged, 18% real).
2. **Starter flags.** The read stopped at 1,000 rows, about a quarter of the season's games, so "promoted to starter" and "moved to the bench" fired off stale flags.
3. **News age.** It read a timestamp the live injury report does not carry, so it was empty on every t2h and injury_change snapshot. It now comes from the logged status changes, with the direction of the change.
4. **Scaling.** The fit's penalty did not allow for these inputs being small numbers, so even a real effect was shrunk to nothing. Features are now scaled before fitting and the scale is stored with the coefficients.

Recomputed on 13,583 graded t2h lines, tonight's minutes estimate now beats the baseline (average miss 4.41 against 4.56 minutes; it was worse than the baseline before). The residual fit on the recomputed inputs still does not beat the market (lift -0.0008, range -0.0019 to +0.0003), so nothing is promoted.

**Is arm A's earlier sample still valid?** Yes for its bets and CLV: `v0-market` gives every feature a weight of 0, so no bet depended on these inputs. No for fitting coefficients: lines logged before `inputs-v6` carry the broken inputs, so the promote decision now reads the fit on `inputs-v6` lines only, which starts from zero dates. The all-lines fit is still reported next to it.

## Gates

- **Promote coefficients:** 10+ ET dates, 300+ graded t2h lines, out-of-fold lift over the raw market with a lower bound above 0 (`fitGate.ts`, on sound inputs).
- **Reopen / go live:** sample reached, (b) 99% lower bound above 0, total 99% lower bound above 0, calibration holds for overs and unders (`report.ts`, `promote.ts`).
- **Futility:** total CLV 95% upper bound below +1% (`report.ts`).
- **Feature candidates:** one at a time, 99% bar (`candidates.ts`, unchanged).
