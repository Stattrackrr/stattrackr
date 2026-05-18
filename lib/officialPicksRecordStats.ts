import type { OfficialPickBet } from '@/lib/officialPicksRecord';

export type PickRecordStats = {
  totalPL: number;
  totalStaked: number;
  winRate: number;
  roi: number;
  wins: number;
  losses: number;
  voids: number;
};

export type PickChartPoint = {
  bet: number;
  profit: number;
};

export type PickCalendarCell = {
  day: string;
  profit: number;
};

export type PickCalendarData = {
  calendar: PickCalendarCell[];
  monthName: string;
};

function getSettledBets(bets: OfficialPickBet[]): OfficialPickBet[] {
  return bets.filter((bet) => bet.result !== 'pending' && bet.result !== 'void');
}

function getBetProfitUnits(bet: OfficialPickBet): number {
  const stake = bet.stake_units;
  if (bet.result === 'win') {
    return stake * (bet.odds - 1);
  }
  if (bet.result === 'loss') {
    return -stake;
  }
  return 0;
}

export function computePickRecordStats(bets: OfficialPickBet[]): PickRecordStats {
  const settledBets = getSettledBets(bets);
  const wins = settledBets.filter((bet) => bet.result === 'win');
  const losses = settledBets.filter((bet) => bet.result === 'loss');
  const voids = bets.filter((bet) => bet.result === 'void');

  const totalStaked = settledBets.reduce((sum, bet) => sum + bet.stake_units, 0);
  const totalPL = settledBets.reduce((sum, bet) => sum + getBetProfitUnits(bet), 0);
  const winRate = settledBets.length > 0 ? (wins.length / settledBets.length) * 100 : 0;
  const roi = totalStaked > 0 ? (totalPL / totalStaked) * 100 : 0;

  return {
    totalPL,
    totalStaked,
    winRate,
    roi,
    wins: wins.length,
    losses: losses.length,
    voids: voids.length,
  };
}

export function computePickChartData(bets: OfficialPickBet[]): PickChartPoint[] {
  const settledBets = [...getSettledBets(bets)].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.created_at.localeCompare(b.created_at)
  );

  let cumulative = 0;
  const data: PickChartPoint[] = [{ bet: 0, profit: 0 }];

  settledBets.forEach((bet, index) => {
    cumulative += getBetProfitUnits(bet);
    data.push({ bet: index + 1, profit: cumulative });
  });

  return data;
}

export type PickXAxisConfig = {
  ticks: number[];
};

export function computePickXAxisConfig(chartData: PickChartPoint[]): PickXAxisConfig {
  const maxBet = chartData[chartData.length - 1]?.bet ?? 0;
  if (maxBet <= 0) {
    return { ticks: [0] };
  }

  if (maxBet <= 12) {
    return {
      ticks: Array.from({ length: maxBet + 1 }, (_, i) => i),
    };
  }

  const targetTickCount = 6;
  const roughStep = maxBet / (targetTickCount - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;
  let niceNormalized = 1;
  if (normalized <= 1) niceNormalized = 1;
  else if (normalized <= 2) niceNormalized = 2;
  else if (normalized <= 5) niceNormalized = 5;
  else niceNormalized = 10;
  const step = niceNormalized * magnitude;

  const ticks: number[] = [];
  for (let value = 0; value <= maxBet; value += step) {
    ticks.push(value);
  }

  return { ticks };
}

export function computePickCalendarData(params: {
  bets: OfficialPickBet[];
  calendarView: 'day' | 'week' | 'month' | 'year';
  calendarDate: Date;
  weekRange: '1-26' | '27-52';
}): PickCalendarData {
  const { bets, calendarView, calendarDate, weekRange } = params;
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const settledBets = getSettledBets(bets);

  if (calendarView === 'day') {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dailyPL: Record<number, number> = {};

    settledBets.forEach((bet) => {
      const betDate = new Date(bet.date);
      if (betDate.getFullYear() === year && betDate.getMonth() === month) {
        const day = betDate.getDate();
        dailyPL[day] = (dailyPL[day] ?? 0) + getBetProfitUnits(bet);
      }
    });

    const calendar: PickCalendarCell[] = [];
    for (let i = 0; i < firstDay; i++) {
      calendar.push({ day: '', profit: 0 });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      calendar.push({ day: day.toString(), profit: dailyPL[day] ?? 0 });
    }
    while (calendar.length < 42) {
      calendar.push({ day: '', profit: 0 });
    }

    return {
      calendar,
      monthName: calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    };
  }

  if (calendarView === 'week') {
    const startOfYear = new Date(year, 0, 1);
    const startWeek = weekRange === '1-26' ? 1 : 27;
    const endWeek = weekRange === '1-26' ? 26 : 52;
    const weeklyData: PickCalendarCell[] = [];

    for (let weekNum = startWeek; weekNum <= endWeek; weekNum++) {
      const weekStart = new Date(startOfYear);
      weekStart.setDate(startOfYear.getDate() + (weekNum - 1) * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);

      const weekPL = settledBets
        .filter((bet) => {
          const betDate = new Date(bet.date);
          return betDate >= weekStart && betDate <= weekEnd;
        })
        .reduce((sum, bet) => sum + getBetProfitUnits(bet), 0);

      weeklyData.push({ day: weekNum.toString(), profit: weekPL });
    }

    return {
      calendar: weeklyData,
      monthName: `${year} - Weeks ${weekRange}`,
    };
  }

  if (calendarView === 'month') {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyData: PickCalendarCell[] = [];

    for (let m = 0; m < 12; m++) {
      const monthPL = settledBets
        .filter((bet) => {
          const betDate = new Date(bet.date);
          return betDate.getFullYear() === year && betDate.getMonth() === m;
        })
        .reduce((sum, bet) => sum + getBetProfitUnits(bet), 0);

      monthlyData.push({ day: monthNames[m], profit: monthPL });
    }

    return {
      calendar: monthlyData,
      monthName: year.toString(),
    };
  }

  const yearlyData: PickCalendarCell[] = [];
  for (let y = year; y <= year + 1; y++) {
    const yearPL = settledBets
      .filter((bet) => new Date(bet.date).getFullYear() === y)
      .reduce((sum, bet) => sum + getBetProfitUnits(bet), 0);
    yearlyData.push({ day: y.toString(), profit: yearPL });
  }

  return {
    calendar: yearlyData,
    monthName: `${year} - ${year + 1}`,
  };
}

export function formatUnits(value: number, options?: { showSign?: boolean }): string {
  const sign = options?.showSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}u`;
}
