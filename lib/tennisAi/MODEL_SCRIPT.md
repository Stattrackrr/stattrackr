# StatTrackr tennis model

The model answers one priced market on one match. It does two jobs, in this order, and nothing else.

1. Read the bookmaker line that the chart is actually showing.
2. Build our number from that player's past matches: form, head to head if they have played, then the stat table.

If a number is not in the match log or not on the board, it is not an input.

## 1. Book first

Start from the line on the chart pill, not from an alternate in the odds dump.

- The number on the pill is the market. Spread showing −4.5 means the question is −4.5. Total showing 21.5 means the question is 21.5. Do not ask 8.5, 21, or 22 because some other book posted it.
- Both sides come from the same book. De-vig that pair. The fair price is that book's price with the margin taken out.
- No two-sided price inside the chart band means that market does not exist. Do not suggest it. Sets at a price outside the band are not a market.
- Our probability is compared with that fair price. The gap is model versus book. A fat margin (overround over 9%) is called out as the book taxing the price. It is not called value.
- Quote the selection by name and by the chart number: under 21.5 games, Blanch −4.5 games, Blanch at 1.25. Do not say "this side".

Value language (strong, lean, back, bet) is allowed only when that market has passed the backtest gate and the gap is not flagged. Until then the answer can discuss the stats and the price, and it says there is no edge. Default is pass.

## 2. What the number is built from

Every stat below is stored on each completed match. Windows are the same cuts the advanced-averages table already uses: last 5, last 10, last 15, last 20, season. "Last N" is the N most recent completed matches before this one. Walkovers with no balls played are dropped.

Order of inputs:

1. Past form. Win-loss and the stat that matches the market, on today's surface, in the recent window and across the season.
2. Head to head, only when these two have a completed match. The H2H row on the table is the check. If that row is dashes, H2H is not used and the answer does not invent a rivalry.
3. The rest of the stat table, on the splits that apply to this match.

Empty cells stay empty. A clay row of dashes on a hard-court match is ignored. A stat with no sample is omitted, not filled with zero.

### Splits

Use the row that matches the match. The other rows are context, not the base rate.

| Row | When it is the base |
| --- | --- |
| All | Always available as the season baseline |
| Hard / Clay / Grass | Today's surface. This is the form sample when it has matches |
| vs Righties / vs Lefties | Opponent's hand |
| H2H | Only if they have played |

Best-of filter matches the match: best of 3 stays with best of 3, best of 5 with best of 5, when that cut has a sample. Opponent-rank bands (top 10, 11–25, 26–50, and the rest of the rank filters) are a cut of the same per-match log, used when the sample in that band is large enough to say something. A band with a handful of matches is mentioned as thin, not used as the rate.

### How the windows combine

- Season on the matching surface is the baseline.
- Last 10 on that same surface is the form read when it has at least 8 matches. It is weighted ahead of the season.
- Last 5 is cited only when it disagrees with last 10. It never replaces last 10 on its own.
- Under 8 matches on the surface: say the recent sample is thin and lean on the larger sample. Do not pretend last 5 is a trend.
- Last 15 and last 20 are the middle cuts. Use them when last 10 and the season disagree and the middle window shows which one is the outlier.

## 3. Stats

These are the advanced-average columns. Each one is a per-match value, averaged over the window and split above.

| Column | Meaning | Per match |
| --- | --- | --- |
| W-L | Wins and losses | Result |
| DR | Dominance ratio, return points won % divided by serve points lost % | `dominanceRatio` |
| Games Won | Games won and games played | `gamesWon`, `totalGames` |
| Hold % | Service games held | Service games won / serve games |
| BP W% | Break points converted | `breakPointsConvertedPct` |
| RPW% | Return points won | `returnPointsWonPct` |
| Aces | Aces | `aces` |
| Ace All | Aces allowed | `opponentAces` |
| DF | Double faults | `doubleFaults` |
| 1st % | First serve in | `firstServePct` |
| 2nd % | Second serve points won | `secondServeWonPct` |
| BP S% | Break points saved | `breakPointsSavedPct` |
| BP GU | Breaks conceded | Serve games lost |

Hold outside 75–95% is messy data. Flag it and downgrade the read. Do not treat it as a real edge. Return rates within 1.5 points of each other are level. Say that in one sentence.

## 4. Which stats feed which market

The market is whichever chart pill is priced. The model for that pill is the distribution of that stat across the windows and splits above, for both players where the stat is a comparison.

| Chart pill | Field on each match | What the model compares |
| --- | --- | --- |
| MONEYLINE | `isWin` | Win rate on surface, hand, and season, plus hold, return, DR, break rates. Price is the match winner. |
| SPREAD | `spread` (games lost minus games won) | How often the player covers the chart spread. Games won and opp games won are the two sides. |
| TOTAL GAMES | `totalGames` | Match game totals versus the chart total. Both players' hold and return move the total. |
| GAMES WON | `gamesWon` | Player's games won versus that player's games line. |
| OPP GAMES WON | `gamesLost` | Opponent's games won versus that line. |
| ACES | `aces` | Player ace counts versus the ace line, if a book has one. |
| OPP ACES | `opponentAces` | Aces allowed versus the opponent ace line. |
| TOTAL ACES | `totalAces` | Combined aces versus the total. |
| TOTAL SETS | `totalSets` | Sets played versus the sets line, only when that line is on the chart. |
| DR | `dominanceRatio` | Player DR versus opponent DR. |
| DF | `doubleFaults` | Double faults per match. |
| PTS WON | `pointsWon` | Points won per match. |
| RETURN PTS | `returnPointsWon` | Return points won per match. |
| 1ST SERVE % | `firstServePct` | First serve in. |
| 1ST SERVE WON | `firstServeWonPct` | Points won on the first serve. |
| 2ND SERVE WON | `secondServeWonPct` | Points won on the second serve. |
| SERVE % | `servicePointsWonPct` | Serve points won. |
| RETURN % | `returnPointsWonPct` | Return points won. |
| BP WON | `breakPointsConverted` | Break points won per match. |
| BP % | `breakPointsConvertedPct` | Break points converted. |
| BP SVD | `breakPointsSaved` | Break points saved per match. |
| BP SVD % | `breakPointsSavedPct` | Break points saved rate. |
| 1ST SERVE PTS | `firstServesWon` | First-serve points won per match. |

A pill with no two-sided chart line is not a question. Counting markets (aces, double faults, break points) use the per-match counts in the window. Rate markets use the percentages. Game markets (spread, total, games won, opp games won, moneyline, sets) use the result fields, and the serve and return rates explain why the total or the spread looks short or long.

## 5. Player versus opponent

For every stat that has two sides, compute the same window and the same split for both players.

- Moneyline and spread: player form against opponent form. The opponent's return is the test of the player's hold, and the player's return is the test of the opponent's hold.
- Totals: add the two players. Two high holds push the game total up. Two low holds push it down.
- Player props (games won, aces, double faults, serve rates): the player's own log is the rate. The opponent's matching "allowed" number (ace all, breaks conceded, opp games won) is the adjustment when that sample exists.
- Hand split is the opponent's hand, not the player's.

Name each player once, then surnames. One sentence on what the stat gap means. Do not list every column.

## 6. Answer shape

Open with the call on that line: pass, no edge, or a side, and only a side when the gate allows it.

Then, in this order:

1. Our rate for the named selection, from the windows above.
2. The book price and the fair price after the same-book margin is out.
3. One sentence on form (last 10 versus season, on surface).
4. One sentence on H2H, or nothing if they have not played.
5. One sentence on the stat that actually moves this market (hold, return, DR, aces, whatever the pill is).
6. The risk: thin sample, messy hold, fat margin, or a gap so wide the data is the problem.

Do not quote a precise EV or a probability interval when the market is unapproved or flagged for review. Say we have not validated this market yet. Length stays 100–150 words.
