// Mock data for NBA dashboard
export const mockPlayerStats = {
  stephen_curry: {
    bio: {
      name: 'Stephen Curry',
      heightFeet: 6,
      heightInches: 2,
      position: 'PG',
      weight: 185,
      college: 'Davidson'
    },
    seasonAverages: {
      pts: 29.5,
      reb: 5.2,
      ast: 6.1,
      fg3_pct: 0.427,
      fg_pct: 0.493,
      ft_pct: 0.915,
      min: 34.2,
      stl: 1.5,
      blk: 0.4,
      to: 3.1,
      pf: 2.8
    },
    advanced: {
      player_efficiency_rating: 0.245,
      usage_percentage: 0.321,
      pace: 101.2,
      true_shooting_percentage: 0.647,
      effective_field_goal_percentage: 0.598,
      offensive_rating: 122.8,
      defensive_rating: 112.3,
      assist_percentage: 0.287,
      assist_to_turnover_ratio: 1.97,
      turnover_ratio: 0.132,
      rebound_percentage: 0.087,
      defensive_rebound_percentage: 0.094,
      net_rating: 10.5
    }
  }
};

export const mockDepthChart = {
  GSW: {
    PG: [
      { name: 'Stephen Curry', jersey: 30 },
      { name: 'Chris Paul', jersey: 3 }
    ],
    SG: [
      { name: 'Klay Thompson', jersey: 11 },
      { name: 'Moses Moody', jersey: 4 }
    ],
    SF: [
      { name: 'Andrew Wiggins', jersey: 22 },
      { name: 'Jonathan Kuminga', jersey: 0 }
    ],
    PF: [
      { name: 'Draymond Green', jersey: 23 },
      { name: 'Trayce Jackson-Davis', jersey: 32 }
    ],
    C: [
      { name: 'Kevon Looney', jersey: 5 },
      { name: 'Dario Saric', jersey: 20 }
    ]
  }
};

export const mockGameSchedule = {
  stephen_curry: {
    nextGame: {
      opponent: 'LAL',
      dateISO: '2024-12-25T22:00:00Z',
      homeAway: 'home'
    }
  }
};

export const mockDefensiveStats = {
  LAL: {
    ptsAllowed: { rank: 15, value: 112.5 },
    rebAllowed: { rank: 8, value: 43.2 },
    astAllowed: { rank: 22, value: 26.8 },
    fgmAllowed: { rank: 12, value: 42.1 },
    fgaAllowed: { rank: 18, value: 89.3 },
    fg3mAllowed: { rank: 25, value: 13.7 },
    fg3aAllowed: { rank: 28, value: 37.4 }
  }
};