# 📐 Tracking Stats Layout Visual Guide

## Desktop Layout (≥ 1024px)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         NBA RESEARCH DASHBOARD                                │
├─────────────┬────────────────────────────────────────────────┬───────────────┤
│             │                                                │               │
│  LEFT       │           CENTER COLUMN (Main)                 │  RIGHT        │
│  SIDEBAR    │                                                │  SIDEBAR      │
│             │                                                │               │
│ ┌─────────┐ │ ┌────────────────────────────────────────────┐ │ ┌───────────┐ │
│ │         │ │ │  PLAYER SELECTOR & CONTROLS                │ │ │ Filter By │ │
│ │ Nav     │ │ │  [Search] [Mode Toggle] [Track/Journal]    │ │ │           │ │
│ │         │ │ └────────────────────────────────────────────┘ │ │ Player/   │ │
│ │ Links   │ │                                                │ │ Team      │ │
│ │         │ │ ┌────────────────────────────────────────────┐ │ │           │ │
│ │ Profile │ │ │  📊 CHART CONTAINER                        │ │ └───────────┘ │
│ │         │ │ │  [Stat Selector: PTS, REB, AST...]        │ │               │
│ │         │ │ │  [Timeframe: L5, L10, L20, Season, ALL]    │ │ ┌───────────┐ │
│ └─────────┘ │ │  [Betting Line Control]                    │ │ │ Opponent  │ │
│             │ │                                              │ │ │ Stats     │ │
│             │ │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓         │ │ │           │ │
│             │ │  ▓  Bar Chart with Stats          ▓         │ │ │ Defense   │ │
│             │ │  ▓  Shows recent game performance ▓         │ │ │ vs Pos    │ │
│             │ │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓         │ │ │           │ │
│             │ │                                              │ │ └───────────┘ │
│             │ │  [Hit Rate: 60%] [Avg: 25.3]               │ │               │
│             │ │ └────────────────────────────────────────────┘ │ ┌───────────┐ │
│             │ │                                                │ │ Shot      │ │
│             │ │ ┌────────────────────────────────────────────┐ │ │ Chart     │ │
│             │ │ │  OFFICIAL ODDS                             │ │ │           │ │
│             │ │ │  Opening: -120  Current: -115              │ │ │  •  •  •  │ │
│             │ │ │  [Line Movement Chart]                     │ │ │ •  🏀  •  │ │
│             │ │ └────────────────────────────────────────────┘ │ │  •  •  •  │ │
│             │ │                                                │ │           │ │
│             │ │ ┌────────────────────────────────────────────┐ │ └───────────┘ │
│             │ │ │  BEST ODDS TABLE                           │ │               │
│             │ │ │  DraftKings | FanDuel | BetMGM            │ │ ┌───────────┐ │
│             │ │ │  PTS  REB  AST  3PT  P+R+A                │ │ │ Injuries  │ │
│             │ │ └────────────────────────────────────────────┘ │ │           │ │
│             │ │                                                │ │ ⚕️  OUT    │ │
│             │ │ ┌────────────────────────────────────────────┐ │ │ 🤕  GTD    │ │
│             │ │ │  DEPTH CHART                               │ │ │           │ │
│             │ │ │  PG    SG    SF    PF    C                │ │ └───────────┘ │
│             │ │ │  👤    👤    👤    👤    👤               │ │               │
│             │ │ └────────────────────────────────────────────┘ │ ┌───────────┐ │
│             │ │                                                │ │ Game Info │ │
│             │ │ ┌────────────────────────────────────────────┐ │ │           │ │
│             │ │ │  PLAYER BOX SCORE                          │ │ │ MIL vs BOS│ │
│             │ │ │  Last 5 Games Stats                        │ │ │           │ │
│             │ │ │  Date | Opp | MIN | PTS | REB | AST       │ │ │ 7:00 PM   │ │
│             │ │ └────────────────────────────────────────────┘ │ │           │ │
│             │ │                                                │ └───────────┘ │
│             │ │ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │               │
│             │ │ ┃  ✨ ADVANCED TRACKING STATS ✨            ┃ │               │
│             │ │ ┃                                            ┃ │               │
│             │ │ ┃  🎯 Passing & Playmaking                  ┃ │               │
│             │ │ ┃  ┌──────────┬──────────┬──────────┐       ┃ │               │
│             │ │ ┃  │Potential │ Actual   │Ast Points│       ┃ │               │
│             │ │ ┃  │Assists   │ Assists  │Created   │       ┃ │               │
│             │ │ ┃  │  9.2     │   6.5    │  14.8    │       ┃ │               │
│             │ │ ┃  └──────────┴──────────┴──────────┘       ┃ │               │
│             │ │ ┃  │Passes    │ Assist % │Secondary │       ┃ │               │
│             │ │ ┃  │Made      │          │Assists   │       ┃ │               │
│             │ │ ┃  │  52.3    │  12.4%   │  1.8     │       ┃ │               │
│             │ │ ┃  └──────────┴──────────┴──────────┘       ┃ │               │
│             │ │ ┃                                            ┃ │               │
│             │ │ ┃  🏀 Rebounding Tracking                   ┃ │               │
│             │ │ ┃  ┌──────────┬──────────┬──────────┐       ┃ │               │
│             │ │ ┃  │Rebound   │Reb Chance│Total Reb │       ┃ │               │
│             │ │ ┃  │Chances   │    %     │          │       ┃ │               │
│             │ │ ┃  │  15.2    │  66.4%   │  10.1    │       ┃ │               │
│             │ │ ┃  └──────────┴──────────┴──────────┘       ┃ │               │
│             │ │ ┃  │Contested │Uncontested│Contest %│       ┃ │               │
│             │ │ ┃  │Rebounds  │ Rebounds  │         │       ┃ │               │
│             │ │ ┃  │   6.2    │    3.9    │  61.4%  │       ┃ │               │
│             │ │ ┃  └──────────┴──────────┴──────────┘       ┃ │               │
│             │ │ ┃                                            ┃ │               │
│             │ │ ┃  [Offensive Reb Details] [Defensive Reb]  ┃ │               │
│             │ │ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │               │
│             │ │       👆 NEW TRACKING STATS CONTAINER         │               │
│             │ │                                                │               │
└─────────────┴────────────────────────────────────────────────┴───────────────┘
```

## Mobile Layout (< 1024px)

```
┌─────────────────────────────────────────┐
│     NBA RESEARCH DASHBOARD              │
├─────────────────────────────────────────┤
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  PLAYER SELECTOR & CONTROLS       │  │
│  │  [Search Box]                     │  │
│  │  [Player/Team Mode Toggle]        │  │
│  │  [Track] [Journal]                │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  📊 CHART CONTAINER               │  │
│  │  [Stat: PTS ▼]                    │  │
│  │  [Timeframe: L10 ▼]               │  │
│  │  [Betting Line: 25.5]             │  │
│  │                                   │  │
│  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓         │  │
│  │  ▓                      ▓         │  │
│  │  ▓   Bar Chart         ▓         │  │
│  │  ▓                      ▓         │  │
│  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓         │  │
│  │                                   │  │
│  │  Hit Rate: 60% | Avg: 25.3       │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  OPPONENT ANALYSIS & TEAM MATCHUP │  │
│  │  Defense vs Position              │  │
│  │  Team Comparison Charts           │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  SHOT CHART                       │  │
│  │       •    •    •                 │  │
│  │    •    🏀    •                   │  │
│  │       •    •    •                 │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  ADVANCED STATS                   │  │
│  │  OFF RTG | TS% | eFG% | USG%     │  │
│  │  NET RTG | DEF RTG | PIE          │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  OFFICIAL ODDS                    │  │
│  │  Opening: -120 | Current: -115   │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  BEST ODDS                        │  │
│  │  DraftKings | FanDuel | BetMGM   │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  DEPTH CHART                      │  │
│  │  PG   SG   SF   PF   C           │  │
│  │  👤   👤   👤   👤   👤          │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  INJURIES                         │  │
│  │  ⚕️  Player 1 - OUT               │  │
│  │  🤕  Player 2 - GTD               │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  PLAYER BOX SCORE                 │  │
│  │  Last 5 Games                     │  │
│  │  Date | MIN | PTS | REB | AST    │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓  │
│  ┃  ✨ ADVANCED TRACKING STATS ✨   ┃  │
│  ┃                                   ┃  │
│  ┃  🎯 Passing & Playmaking          ┃  │
│  ┃  ┌────────┬────────┐              ┃  │
│  ┃  │Potential│Actual  │              ┃  │
│  ┃  │Assists  │Assists │              ┃  │
│  ┃  │  9.2    │  6.5   │              ┃  │
│  ┃  ├────────┼────────┤              ┃  │
│  ┃  │Ast Pts │Passes  │              ┃  │
│  ┃  │Created │Made    │              ┃  │
│  ┃  │  14.8  │  52.3  │              ┃  │
│  ┃  └────────┴────────┘              ┃  │
│  ┃                                   ┃  │
│  ┃  🏀 Rebounding Tracking           ┃  │
│  ┃  ┌────────┬────────┐              ┃  │
│  ┃  │Rebound │Reb Chc │              ┃  │
│  ┃  │Chances │   %    │              ┃  │
│  ┃  │  15.2  │ 66.4%  │              ┃  │
│  ┃  ├────────┼────────┤              ┃  │
│  ┃  │Contest │Uncontest│             ┃  │
│  ┃  │Rebounds│Rebounds │             ┃  │
│  ┃  │  6.2   │  3.9   │              ┃  │
│  ┃  └────────┴────────┘              ┃  │
│  ┃                                   ┃  │
│  ┃  [More Details ▼]                ┃  │
│  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛  │
│      👆 NEW TRACKING STATS            │
│                                         │
│  [Scroll for more...]                  │
│                                         │
└─────────────────────────────────────────┘
```

## Key Visual Indicators

### 🎯 Highlighted Stats (Blue Background)
- Potential Assists
- Assist Points Created
- Rebound Chances
- Rebound Chance %

### 📊 Regular Stats (Gray Background)
- Actual Assists
- Passes Made
- Assist %
- Total Rebounds
- Contested/Uncontested Rebounds

### Color Coding
- **Green values** = Above average performance
- **Orange values** = Average performance
- **Red values** = Below average performance

### Responsive Grid
- **Mobile (< 640px)**: 2 columns
- **Tablet (640px - 768px)**: 2-3 columns
- **Desktop (≥ 1024px)**: 3 columns

## Example Values (Giannis Antetokounmpo 2024-25)

```
🎯 Passing & Playmaking
┌────────────────┬─────────────┬──────────────────┐
│ Potential Ast  │ Actual Ast  │ Ast Pts Created  │
│     9.2        │    6.5      │      14.8        │
├────────────────┼─────────────┼──────────────────┤
│ Passes Made    │ Assist %    │ Secondary Ast    │
│     52.3       │   12.4%     │      1.8         │
└────────────────┴─────────────┴──────────────────┘

🏀 Rebounding Tracking
┌────────────────┬─────────────┬──────────────────┐
│ Reb Chances    │ Reb Chc %   │ Total Rebounds   │
│     15.2       │   66.4%     │      10.1        │
├────────────────┼─────────────┼──────────────────┤
│ Contested Reb  │ Uncontest   │ Contest %        │
│      6.2       │    3.9      │     61.4%        │
└────────────────┴─────────────┴──────────────────┘
```

---

**Note**: The tracking stats container automatically shows/hides based on:
- ✅ Player Props mode (not Game Props)
- ✅ Player is selected
- ✅ Player has valid data

**Scroll Position**: On mobile, you'll need to scroll past all the other containers to see it. On desktop, it's visible in the center column if you scroll down.


