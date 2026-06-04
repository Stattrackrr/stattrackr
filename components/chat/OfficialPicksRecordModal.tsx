'use client';

import {
  deleteOfficialPickBet,
  fetchOfficialPicksBets,
  insertOfficialPickBet,
  OfficialPickBet,
  OfficialPickResult,
  updateOfficialPickBet,
} from '@/lib/officialPicksRecord';
import {
  computePickCalendarData,
  computePickChartData,
  computePickRecordStats,
  computePickXAxisConfig,
  formatUnits,
  type PickChartPoint,
  type PickRecordStats,
} from '@/lib/officialPicksRecordStats';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import { FormEvent, memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type OfficialPicksRecordModalProps = {
  isOpen: boolean;
  onClose: () => void;
  isAdmin: boolean;
  isDark: boolean;
};

const RESULT_OPTIONS: OfficialPickResult[] = ['pending', 'win', 'loss', 'void'];

const DOLLARS_PER_UNIT = 50;

function formatUnitDollars(units: number, dollarsPerUnit = DOLLARS_PER_UNIT): string {
  const amount = units * dollarsPerUnit;
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type NewBetForm = {
  date: string;
  selection: string;
  odds: string;
  stake_units: string;
  result: OfficialPickResult;
  sport: string;
  market: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

function plClass(value: number): string {
  if (value > 0) return 'text-green-600 dark:text-green-400';
  if (value < 0) return 'text-red-600 dark:text-red-400';
  return 'text-gray-900 dark:text-white';
}

export function OfficialPicksRecordModal({ isOpen, onClose, isAdmin, isDark }: OfficialPicksRecordModalProps) {
  const [mounted, setMounted] = useState(false);
  const [bets, setBets] = useState<OfficialPickBet[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingBetId, setSavingBetId] = useState<string | null>(null);
  const [calendarView, setCalendarView] = useState<'day' | 'week' | 'month' | 'year'>('month');
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [weekRange, setWeekRange] = useState<'1-26' | '27-52'>('1-26');
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  const [newBet, setNewBet] = useState<NewBetForm>({
    date: new Date().toISOString().slice(0, 10),
    selection: '',
    odds: '1.91',
    stake_units: '1',
    result: 'pending',
    sport: 'NBA',
    market: '',
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadBets = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await fetchOfficialPicksBets();
      setBets(rows);
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    void loadBets();
  }, [isOpen, loadBets]);

  const stats = useMemo(() => computePickRecordStats(bets), [bets]);
  const chartData = useMemo(() => computePickChartData(bets), [bets]);
  const xAxisConfig = useMemo(() => computePickXAxisConfig(chartData), [chartData]);
  const calendarData = useMemo(
    () => computePickCalendarData({ bets, calendarView, calendarDate, weekRange }),
    [bets, calendarView, calendarDate, weekRange]
  );

  const navigatePrevious = () => {
    const next = new Date(calendarDate);
    if (calendarView === 'day' || calendarView === 'week') {
      next.setMonth(next.getMonth() - 1);
    } else if (calendarView === 'month') {
      next.setFullYear(next.getFullYear() - 1);
    } else {
      next.setFullYear(next.getFullYear() - 2);
    }
    setCalendarDate(next);
  };

  const navigateNext = () => {
    const next = new Date(calendarDate);
    if (calendarView === 'day' || calendarView === 'week') {
      next.setMonth(next.getMonth() + 1);
    } else if (calendarView === 'month') {
      next.setFullYear(next.getFullYear() + 1);
    } else {
      next.setFullYear(next.getFullYear() + 2);
    }
    setCalendarDate(next);
  };

  const handleResultChange = async (betId: string, result: OfficialPickResult) => {
    setSavingBetId(betId);
    setActionError(null);
    try {
      const updated = await updateOfficialPickBet(betId, { result });
      setBets((current) => current.map((bet) => (bet.id === betId ? updated : bet)));
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setSavingBetId(null);
    }
  };

  const handleDeleteBet = async (betId: string) => {
    setSavingBetId(betId);
    setActionError(null);
    try {
      await deleteOfficialPickBet(betId);
      setBets((current) => current.filter((bet) => bet.id !== betId));
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setSavingBetId(null);
    }
  };

  const handleAddBet = async (event: FormEvent) => {
    event.preventDefault();
    if (!newBet.selection.trim()) {
      setActionError('Selection is required.');
      return;
    }

    const odds = Number(newBet.odds);
    const stakeUnits = Number(newBet.stake_units);
    if (!Number.isFinite(odds) || odds <= 1) {
      setActionError('Odds must be greater than 1.');
      return;
    }
    if (!Number.isFinite(stakeUnits) || stakeUnits <= 0) {
      setActionError('Units must be greater than 0.');
      return;
    }

    setActionError(null);
    setSavingBetId('new');
    try {
      const created = await insertOfficialPickBet({
        date: newBet.date,
        selection: newBet.selection.trim(),
        odds,
        stake_units: stakeUnits,
        result: newBet.result,
        sport: newBet.sport.trim() || 'NBA',
        market: newBet.market.trim() || null,
      });
      setBets((current) => [created, ...current]);
      setNewBet((prev) => ({
        ...prev,
        selection: '',
        market: '',
        result: 'pending',
      }));
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setSavingBetId(null);
    }
  };

  if (!isOpen || !mounted) {
    return null;
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[180] bg-black/70" onClick={onClose} aria-hidden />
      <div className="fixed inset-0 z-[190] flex items-center justify-center p-1.5 sm:p-6" onClick={onClose}>
        <div
          className="flex max-h-[min(92dvh,900px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-[#0f1a2b]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-2.5 py-3 dark:border-gray-700 sm:px-5 sm:py-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Picks Record</h2>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                Official StatTrackr units performance.{isAdmin ? '' : ' View only.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => setShowAdminPanel((value) => !value)}
                  className="rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-xs font-semibold text-purple-700 transition-colors hover:bg-purple-500/20 dark:text-purple-200"
                >
                  {showAdminPanel ? 'Hide editor' : 'Manage picks'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
                aria-label="Close picks record"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 py-3 sm:px-5 sm:py-4">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-sm text-gray-500 dark:text-gray-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading record...
              </div>
            ) : loadError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">{loadError}</div>
            ) : (
              <RecordModalBody
                stats={stats}
                chartData={chartData}
                xAxisConfig={xAxisConfig}
                isDark={isDark}
                calendarView={calendarView}
                setCalendarView={setCalendarView}
                weekRange={weekRange}
                setWeekRange={setWeekRange}
                calendarData={calendarData}
                navigatePrevious={navigatePrevious}
                navigateNext={navigateNext}
                actionError={actionError}
                isAdmin={isAdmin}
                showAdminPanel={showAdminPanel}
                bets={bets}
                savingBetId={savingBetId}
                newBet={newBet}
                setNewBet={setNewBet}
                onResultChange={handleResultChange}
                onDeleteBet={handleDeleteBet}
                onAddBet={handleAddBet}
              />
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

type RecordModalBodyProps = {
  stats: PickRecordStats;
  chartData: ReturnType<typeof computePickChartData>;
  xAxisConfig: ReturnType<typeof computePickXAxisConfig>;
  isDark: boolean;
  calendarView: 'day' | 'week' | 'month' | 'year';
  setCalendarView: (view: 'day' | 'week' | 'month' | 'year') => void;
  weekRange: '1-26' | '27-52';
  setWeekRange: (range: '1-26' | '27-52') => void;
  calendarData: ReturnType<typeof computePickCalendarData>;
  navigatePrevious: () => void;
  navigateNext: () => void;
  actionError: string | null;
  isAdmin: boolean;
  showAdminPanel: boolean;
  bets: OfficialPickBet[];
  savingBetId: string | null;
  newBet: NewBetForm;
  setNewBet: React.Dispatch<React.SetStateAction<NewBetForm>>;
  onResultChange: (betId: string, result: OfficialPickResult) => void;
  onDeleteBet: (betId: string) => void;
  onAddBet: (event: FormEvent) => void;
};

const UnitsPnlChart = memo(function UnitsPnlChart({
  chartData,
  ticks,
  isDark,
  compactChart,
}: {
  chartData: PickChartPoint[];
  ticks: number[];
  isDark: boolean;
  compactChart: boolean;
}) {
  const axisColor = isDark ? '#e2e8f0' : '#0f172a';
  const tooltipStyle: React.CSSProperties = {
    backgroundColor: isDark ? '#334155' : '#e2e8f0',
    border: `1px solid ${isDark ? '#64748b' : '#94a3b8'}`,
    borderRadius: '8px',
    color: isDark ? '#fff' : '#0f172a',
  };
  const chartMargin = compactChart
    ? { top: 8, right: 4, left: -4, bottom: 0 }
    : { top: 8, right: 4, left: 4, bottom: 4 };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={chartMargin} barCategoryGap={compactChart ? '8%' : '12%'}>
        <XAxis
          dataKey="bet"
          type="category"
          scale="band"
          stroke={axisColor}
          tick={{ fill: axisColor, fontSize: compactChart ? 9 : 11 }}
          ticks={ticks}
          tickFormatter={(value) => String(value)}
          height={compactChart ? 24 : 30}
          tickMargin={compactChart ? 4 : 8}
          axisLine={{ stroke: axisColor }}
          tickLine={false}
        />
        <YAxis
          width={compactChart ? 26 : 36}
          stroke={axisColor}
          tick={{ fill: axisColor, fontSize: compactChart ? 9 : 11 }}
          tickCount={6}
          axisLine={false}
          tickLine={false}
          tickMargin={compactChart ? 4 : 2}
        />
        <Tooltip
          isAnimationActive={false}
          cursor={{ fill: isDark ? 'rgba(148,163,184,0.15)' : 'rgba(15,23,42,0.06)' }}
          content={({ active, payload, label }) => {
            if (!active || !payload || payload.length === 0) {
              return null;
            }
            const value = Number(payload[0]?.value ?? 0);
            return (
              <div style={tooltipStyle} className="px-3 py-2 text-xs">
                <p className="font-semibold">{`Bet #${label}`}</p>
                <p className="mt-1">{`Units P&L : ${formatUnits(value)}`}</p>
                <p className={`mt-0.5 font-semibold ${value > 0 ? 'text-green-500' : value < 0 ? 'text-red-500' : ''}`}>
                  {`${formatUnitDollars(value)} @ $${DOLLARS_PER_UNIT}/u`}
                </p>
              </div>
            );
          }}
        />
        <ReferenceLine y={0} stroke={isDark ? '#6b7280' : '#9ca3af'} strokeDasharray="3 3" />
        <Bar dataKey="profit" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {chartData.map((entry, index) => (
            <Cell
              key={`bar-${index}`}
              fill={entry.profit >= 0 ? '#22c55e' : '#ef4444'}
              fillOpacity={index === 0 ? 0 : 1}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
});

function RecordModalBody(props: RecordModalBodyProps) {
  const {
    stats,
    chartData,
    xAxisConfig,
    isDark,
    calendarView,
    setCalendarView,
    weekRange,
    setWeekRange,
    calendarData,
    navigatePrevious,
    navigateNext,
    actionError,
    isAdmin,
    showAdminPanel,
    bets,
    savingBetId,
    newBet,
    setNewBet,
    onResultChange,
    onDeleteBet,
    onAddBet,
  } = props;

  const [compactChart, setCompactChart] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)');
    const sync = () => setCompactChart(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-1.5 sm:mb-4 sm:grid-cols-4 sm:gap-2">
        <StatCard label="Total Units P&L" value={formatUnits(stats.totalPL, { showSign: true })} valueClass={plClass(stats.totalPL)} />
        <StatCard label="Win %" value={`${stats.winRate.toFixed(1)}%`} />
        <StatCard label="ROI" value={`${stats.roi >= 0 ? '+' : ''}${stats.roi.toFixed(1)}%`} valueClass={plClass(stats.roi)} />
        <StatCard
          label="Record"
          value={
            <span className="inline-flex items-center gap-1">
              <span className="text-green-600 dark:text-green-400">{stats.wins}</span>
              <span className="text-gray-400">-</span>
              <span className="text-red-600 dark:text-red-400">{stats.losses}</span>
              <span className="text-gray-400">-</span>
              <span className="text-gray-500 dark:text-gray-400">{stats.voids}</span>
            </span>
          }
        />
      </div>

      <div className="mb-3 rounded-xl border border-gray-200 bg-slate-50 p-2 dark:border-gray-700 dark:bg-[#0a1929] sm:mb-4 sm:p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white sm:mb-3 sm:text-base">Units P&L Over Time</h3>
        <div className="h-48 w-full sm:h-56">
          {chartData.length <= 1 ? (
            <p className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">No settled picks yet.</p>
          ) : (
            <UnitsPnlChart chartData={chartData} ticks={xAxisConfig.ticks} isDark={isDark} compactChart={compactChart} />
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-slate-50 p-2 dark:border-gray-700 dark:bg-[#0a1929] sm:p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 sm:mb-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white sm:text-base">Betting Calendar</h3>
          <select
            value={calendarView}
            onChange={(e) => setCalendarView(e.target.value as typeof calendarView)}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 dark:border-gray-600 dark:bg-[#0f1a2b] dark:text-gray-200"
            aria-label="Select calendar timeframe"
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="year">Year</option>
          </select>
        </div>
        {calendarView === 'week' ? (
          <div className="mb-2 flex justify-center gap-2">
            {(['1-26', '27-52'] as const).map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setWeekRange(range)}
                className={`rounded-lg px-3 py-1 text-xs font-medium ${
                  weekRange === range
                    ? 'bg-purple-600 text-white'
                    : 'border border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-[#0f1a2b] dark:text-gray-300'
                }`}
              >
                {range === '1-26' ? 'Weeks 1-26' : 'Weeks 27-52'}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mb-2 flex items-center justify-between">
          <button type="button" onClick={navigatePrevious} className="rounded p-1 hover:bg-gray-200 dark:hover:bg-gray-800" aria-label="Previous period">
            ‹
          </button>
          <p className="text-xs font-semibold text-gray-900 dark:text-white">{calendarData.monthName}</p>
          <button type="button" onClick={navigateNext} className="rounded p-1 hover:bg-gray-200 dark:hover:bg-gray-800" aria-label="Next period">
            ›
          </button>
        </div>
        {calendarView === 'day' ? (
          <div className="mb-1 grid grid-cols-7 gap-1">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="text-center text-[9px] font-medium text-gray-500 dark:text-gray-400">
                {day}
              </div>
            ))}
          </div>
        ) : null}
        <div
          className={`grid ${
            calendarView === 'month' ? 'gap-1.5 sm:gap-2' : 'gap-1'
          } ${
            calendarView === 'day' || calendarView === 'week' ? 'grid-cols-7' : calendarView === 'month' ? 'grid-cols-3' : 'grid-cols-2'
          }`}
        >
          {calendarData.calendar.map((item, idx) => (
            <div
              key={idx}
              className={`flex flex-col items-center justify-center rounded-lg border border-gray-300/40 text-center dark:border-gray-600/40 ${
                calendarView === 'month'
                  ? 'min-h-[54px] p-1.5 text-[11px] sm:min-h-[58px] sm:p-2 sm:text-xs'
                  : calendarView === 'year'
                    ? 'min-h-[50px] p-1.5 text-[11px] sm:min-h-[54px] sm:text-xs'
                    : 'min-h-[46px] p-1 text-[10px] sm:min-h-[48px]'
              } ${
                !item.day
                  ? 'invisible'
                  : item.profit === 0
                    ? 'bg-gray-200 text-gray-600 dark:bg-[#0f1a2b] dark:text-gray-400'
                    : item.profit > 0
                      ? item.profit > 2
                        ? 'bg-green-600 text-white'
                        : 'bg-green-400 text-white dark:bg-green-600'
                      : item.profit < -2
                        ? 'bg-red-600 text-white'
                        : 'bg-red-400 text-white dark:bg-red-600'
              }`}
            >
              <span className="font-semibold">{item.day}</span>
              {item.day && item.profit !== 0 ? (
                <span className={`mt-0.5 font-medium ${calendarView === 'month' ? 'text-[9px] sm:text-[10px]' : 'text-[9px]'}`}>
                  {formatUnits(Math.abs(item.profit))}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {actionError ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{actionError}</p> : null}

      {isAdmin && showAdminPanel ? (
        <div className="mt-4 border-t border-gray-200 pt-3 dark:border-gray-700 sm:mt-5 sm:pt-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">Manage official picks</h3>
          <form onSubmit={onAddBet} className="mb-4 grid gap-2 rounded-xl border border-dashed border-purple-400/40 bg-purple-500/5 p-2 sm:grid-cols-2 sm:p-3">
            <input
              type="date"
              value={newBet.date}
              onChange={(e) => setNewBet((prev) => ({ ...prev, date: e.target.value }))}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-[#0f1a2b] dark:text-white"
              required
            />
            <input
              type="text"
              placeholder="Selection"
              value={newBet.selection}
              onChange={(e) => setNewBet((prev) => ({ ...prev, selection: e.target.value }))}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-[#0f1a2b] dark:text-white sm:col-span-2"
              required
            />
            <input
              type="number"
              step="0.01"
              min="1.01"
              placeholder="Odds"
              value={newBet.odds}
              onChange={(e) => setNewBet((prev) => ({ ...prev, odds: e.target.value }))}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-[#0f1a2b] dark:text-white"
              required
            />
            <input
              type="number"
              step="0.25"
              min="0.25"
              placeholder="Units"
              value={newBet.stake_units}
              onChange={(e) => setNewBet((prev) => ({ ...prev, stake_units: e.target.value }))}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-[#0f1a2b] dark:text-white"
              required
            />
            <select
              value={newBet.result}
              onChange={(e) => setNewBet((prev) => ({ ...prev, result: e.target.value as OfficialPickResult }))}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-[#0f1a2b] dark:text-white"
            >
              {RESULT_OPTIONS.map((result) => (
                <option key={result} value={result}>
                  {result}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={savingBetId === 'new'}
              className="inline-flex items-center justify-center gap-1 rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-purple-500 disabled:opacity-60"
            >
              {savingBetId === 'new' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add pick
            </button>
          </form>
          <div className="chat-scrollbar max-h-56 space-y-2 overflow-y-auto overscroll-y-contain pr-1">
            {bets.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No picks logged yet.</p>
            ) : (
              bets.map((bet) => (
                <BetRow
                  key={bet.id}
                  bet={bet}
                  savingBetId={savingBetId}
                  onResultChange={onResultChange}
                  onDeleteBet={onDeleteBet}
                />
              ))
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function StatCard({ label, value, valueClass = 'text-gray-900 dark:text-white' }: { label: string; value: React.ReactNode; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-slate-50 px-2 py-2.5 text-center dark:border-gray-700 dark:bg-[#0a1929] sm:px-3 sm:py-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 sm:text-xs">{label}</p>
      <p className={`mt-1 text-base font-semibold sm:text-lg ${valueClass}`}>{value}</p>
    </div>
  );
}

function BetRow({
  bet,
  savingBetId,
  onResultChange,
  onDeleteBet,
}: {
  bet: OfficialPickBet;
  savingBetId: string | null;
  onResultChange: (betId: string, result: OfficialPickResult) => void;
  onDeleteBet: (betId: string) => void;
}) {
  const isSaving = savingBetId === bet.id;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-2 dark:border-gray-700 dark:bg-[#111c2d]">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{bet.selection}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {bet.date} · {bet.stake_units}u @ {bet.odds}
        </p>
      </div>
      <select
        value={bet.result}
        disabled={isSaving}
        onChange={(e) => void onResultChange(bet.id, e.target.value as OfficialPickResult)}
        className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs dark:border-gray-600 dark:bg-[#0f1a2b] dark:text-white"
      >
        {RESULT_OPTIONS.map((result) => (
          <option key={result} value={result}>
            {result}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={isSaving}
        onClick={() => void onDeleteBet(bet.id)}
        className="rounded p-1 text-red-500 hover:bg-red-500/10 disabled:opacity-50"
        aria-label="Delete pick"
      >
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </button>
    </div>
  );
}
