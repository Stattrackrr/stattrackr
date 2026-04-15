 'use client';

import { useEffect, useMemo, useState } from 'react';
import { americanToDecimal } from '@/lib/currencyUtils';
import { getBookmakerInfo } from '@/lib/bookmakers';

type HistoryRow = {
  snapshotKey?: string;
  capturedAt?: string;
  gameDate?: string;
  commenceTime?: string | null;
  weekKey?: string;
  playerName?: string;
  homeTeam?: string;
  awayTeam?: string;
  playerTeam?: string;
  opponentTeam?: string;
  bookmaker?: string;
  line?: number;
  overOdds?: string | null;
  underOdds?: string | null;
  modelExpectedDisposals?: number | null;
  modelEdge?: number | null;
  actualDisposals?: number | null;
  actualTog?: number | null;
  differenceLine?: number | null;
  differenceModel?: number | null;
  resultColor?: 'green' | 'red' | null;
  kicks?: number | null;
  handballs?: number | null;
  marks?: number | null;
  tackles?: number | null;
};

type EvalSummary = {
  hasData?: boolean;
  generatedAt?: string | null;
  sampleCount?: number;
  decision?: {
    pass?: boolean;
    promoted?: boolean;
  };
  candidate?: {
    hitRate?: number;
    brierScore?: number;
    logLoss?: number;
    calibrationMethod?: string;
  } | null;
};

function normalizeTeamNameForLogo(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeLogoUrl(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  return raw.replace(/^http:\/\//i, 'https://');
}

const AFL_LOGO_ALIASES: Record<string, string[]> = {
  adelaide: ['adelaide', 'adelaidecrows', 'crows'],
  brisbane: ['brisbane', 'brisbanelions', 'lions'],
  carlton: ['carlton', 'carltonblues', 'blues'],
  collingwood: ['collingwood', 'collingwoodmagpies', 'magpies'],
  essendon: ['essendon', 'essendonbombers', 'bombers'],
  fremantle: ['fremantle', 'fremantledockers', 'dockers'],
  geelong: ['geelong', 'geelongcats', 'cats'],
  goldcoast: ['goldcoast', 'goldcoastsuns', 'suns'],
  gws: ['gws', 'gwsgiants', 'greaterwesternsydney', 'greaterwesternsydneygiants', 'giants'],
  hawthorn: ['hawthorn', 'hawthornhawks', 'hawks'],
  melbourne: ['melbourne', 'melbournedemons', 'demons'],
  northmelbourne: ['northmelbourne', 'northmelbournekangaroos', 'kangaroos', 'north'],
  portadelaide: ['portadelaide', 'portadelaidepower', 'power'],
  richmond: ['richmond', 'richmondtigers', 'tigers'],
  stkilda: ['stkilda', 'stkildasaints', 'saints'],
  sydney: ['sydney', 'sydneyswans', 'swans'],
  westcoast: ['westcoast', 'westcoasteagles', 'eagles'],
  westernbulldogs: ['westernbulldogs', 'bulldogs', 'footscray'],
};

function resolveTeamLogo(teamName: string, logoByTeam: Record<string, string>): string | null {
  const normalized = normalizeTeamNameForLogo(teamName);
  if (!normalized) return null;
  if (logoByTeam[normalized]) return logoByTeam[normalized];
  for (const aliases of Object.values(AFL_LOGO_ALIASES)) {
    if (!aliases.includes(normalized)) continue;
    for (const alias of aliases) {
      if (logoByTeam[alias]) return logoByTeam[alias];
    }
  }
  return null;
}

function formatDate(value?: string): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-AU', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return value.toFixed(decimals);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toLocalIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseYmdToUtcMs(value?: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return Date.UTC(y, m - 1, d);
}

function formatOddsDecimal(odds?: string | null): string {
  const raw = String(odds ?? '').trim();
  if (!raw) return '-';
  const numeric = Number.parseFloat(raw);
  if (!Number.isFinite(numeric)) return raw;
  if (Math.abs(numeric) >= 100) return americanToDecimal(numeric).toFixed(2);
  if (numeric > 1) return numeric.toFixed(2);
  return raw;
}

function getSideLabel(value: number, line: number): 'Over' | 'Under' | 'Push' {
  if (value > line) return 'Over';
  if (value < line) return 'Under';
  return 'Push';
}

function getRowOutcome(row: HistoryRow): { result: 'Win' | 'Loss' | 'Push' | '-'; modelSide: 'Over' | 'Under' | 'Push' | null; line: number; model: number } {
  const line = typeof row.line === 'number' ? row.line : Number.parseFloat(String(row.line ?? ''));
  const model = typeof row.modelExpectedDisposals === 'number' ? row.modelExpectedDisposals : Number.parseFloat(String(row.modelExpectedDisposals ?? ''));
  const actual = typeof row.actualDisposals === 'number' ? row.actualDisposals : Number.parseFloat(String(row.actualDisposals ?? ''));
  const hasOutcome = Number.isFinite(line) && Number.isFinite(model) && Number.isFinite(actual);
  if (!hasOutcome) return { result: '-', modelSide: null, line, model };
  const modelSide = getSideLabel(model, line);
  const actualSide = getSideLabel(actual, line);
  if (modelSide === 'Push' || actualSide === 'Push') return { result: 'Push', modelSide, line, model };
  return { result: modelSide === actualSide ? 'Win' : 'Loss', modelSide, line, model };
}

function resolveMatchingGame(row: HistoryRow, games: Record<string, unknown>[]): Record<string, unknown> | null {
  const rowDate = String(row.gameDate ?? '');
  const commenceUtcDate = String(row.commenceTime ?? '').slice(0, 10);
  const commenceLocalDate = row.commenceTime ? toLocalIsoDate(new Date(row.commenceTime)) : '';
  const candidateDates = new Set([rowDate, commenceUtcDate, commenceLocalDate].filter(Boolean));

  const exact = games.find((g) => candidateDates.has(String(g?.date ?? '')));
  if (exact) return exact;

  // Fallback: FootyWire date can be shifted by timezone; pick nearest game within 1 day.
  const rowDateMs = parseYmdToUtcMs(rowDate);
  if (rowDateMs == null) return null;
  let best: Record<string, unknown> | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const game of games) {
    const gameMs = parseYmdToUtcMs(String(game?.date ?? ''));
    if (gameMs == null) continue;
    const diff = Math.abs(gameMs - rowDateMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = game;
    }
  }
  return bestDiff <= 24 * 60 * 60 * 1000 ? best : null;
}

export default function AflDisposalsHistoryPage() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logoByTeam, setLogoByTeam] = useState<Record<string, string>>({});
  const [evalSummary, setEvalSummary] = useState<EvalSummary | null>(null);

  const completeRows = useMemo(
    () =>
      rows.filter((r) =>
        isFiniteNumber(r.actualDisposals) &&
        isFiniteNumber(r.actualTog) &&
        isFiniteNumber(r.kicks) &&
        isFiniteNumber(r.handballs) &&
        isFiniteNumber(r.marks) &&
        isFiniteNumber(r.tackles) &&
        !!String(r.overOdds ?? '').trim() &&
        !!String(r.underOdds ?? '').trim()
      ),
    [rows]
  );
  const sortedRows = useMemo(() => {
    return [...completeRows].sort((a, b) => {
      const aLine = typeof a.line === 'number' ? a.line : Number.parseFloat(String(a.line ?? ''));
      const bLine = typeof b.line === 'number' ? b.line : Number.parseFloat(String(b.line ?? ''));
      const aModel =
        typeof a.modelExpectedDisposals === 'number'
          ? a.modelExpectedDisposals
          : Number.parseFloat(String(a.modelExpectedDisposals ?? ''));
      const bModel =
        typeof b.modelExpectedDisposals === 'number'
          ? b.modelExpectedDisposals
          : Number.parseFloat(String(b.modelExpectedDisposals ?? ''));
      const aGap = Number.isFinite(aLine) && Number.isFinite(aModel) ? Math.abs(aModel - aLine) : -1;
      const bGap = Number.isFinite(bLine) && Number.isFinite(bModel) ? Math.abs(bModel - bLine) : -1;
      if (aGap !== bGap) return bGap - aGap;
      return String(b.gameDate ?? '').localeCompare(String(a.gameDate ?? ''));
    });
  }, [completeRows]);
  const summary = useMemo(() => {
    let wins = 0;
    let losses = 0;
    for (const row of sortedRows) {
      const outcome = getRowOutcome(row).result;
      if (outcome === 'Win') wins += 1;
      else if (outcome === 'Loss') losses += 1;
    }
    const decisions = wins + losses;
    const hitRate = decisions > 0 ? (wins / decisions) * 100 : 0;
    return { wins, losses, hitRate };
  }, [sortedRows]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const [res, logosRes] = await Promise.all([
          fetch('/api/afl/model/disposals/history/all?limit=2000', { cache: 'no-store' }),
          fetch('/api/afl/team-logos', { cache: 'no-store' }),
        ]);
        const data = await res.json();
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || 'Failed to load model history');
        }
        if (logosRes.ok) {
          const logosJson = await logosRes.json();
          const logos = logosJson?.logos && typeof logosJson.logos === 'object' ? logosJson.logos : {};
          const nextMap: Record<string, string> = {};
          for (const [name, rawLogo] of Object.entries(logos as Record<string, unknown>)) {
            const normalizedName = normalizeTeamNameForLogo(String(name ?? ''));
            const logo = normalizeLogoUrl(String(rawLogo ?? ''));
            if (!normalizedName || !logo) continue;
            nextMap[normalizedName] = logo;
          }
          if (!cancelled) setLogoByTeam(nextMap);
        }
        if (cancelled) return;
        const initialRows: HistoryRow[] = Array.isArray(data.rows) ? data.rows : [];
        setRows(initialRows);

        // Live-resolve game stats for past games so actuals/statline stay current before cron runs.
        const todayIso = toLocalIsoDate(new Date());
        const targets = initialRows
          .map((row, idx) => ({ row, idx }))
          .filter(({ row }) =>
            !!row.gameDate &&
            String(row.gameDate) <= todayIso &&
            !!row.playerName
          );
        if (targets.length === 0) return;

        const updates = new Map<number, HistoryRow>();
        const requestKeys = new Map<string, { season: number; playerName: string }>();
        for (const { row } of targets) {
          const season = Number.parseInt(String(row.gameDate ?? '').slice(0, 4), 10);
          const playerName = String(row.playerName ?? '').trim();
          if (!Number.isFinite(season) || !playerName) continue;
          const key = `${season}|${playerName.toLowerCase()}`;
          if (!requestKeys.has(key)) requestKeys.set(key, { season, playerName });
        }

        const gamesByRequestKey = new Map<string, Record<string, unknown>[]>();
        const requestList = [...requestKeys.entries()];
        const concurrency = 8;
        for (let i = 0; i < requestList.length; i += concurrency) {
          const batch = requestList.slice(i, i + concurrency);
          const batchResults = await Promise.all(
            batch.map(async ([requestKey, request]) => {
              try {
                const params = new URLSearchParams({
                  season: String(request.season),
                  player_name: request.playerName,
                  include_both: '1',
                });
                const logsRes = await fetch(`/api/afl/player-game-logs?${params.toString()}`, { cache: 'no-store' });
                if (!logsRes.ok) return null;
                const logsData = await logsRes.json();
                const games = Array.isArray(logsData?.games) ? logsData.games : [];
                return { requestKey, games: games as Record<string, unknown>[] };
              } catch {
                return null;
              }
            })
          );
          for (const result of batchResults) {
            if (result) gamesByRequestKey.set(result.requestKey, result.games);
          }
        }

        for (const { row, idx } of targets) {
          const season = Number.parseInt(String(row.gameDate ?? '').slice(0, 4), 10);
          const playerName = String(row.playerName ?? '').trim();
          if (!Number.isFinite(season) || !playerName) continue;
          const requestKey = `${season}|${playerName.toLowerCase()}`;
          const games = gamesByRequestKey.get(requestKey);
          if (!games || games.length === 0) continue;
          const match = resolveMatchingGame(row, games);
          if (!match) continue;
          const actual = typeof match.disposals === 'number' ? match.disposals : Number.parseFloat(String(match.disposals ?? ''));
          if (!Number.isFinite(actual)) continue;
          const line = typeof row.line === 'number' ? row.line : Number.parseFloat(String(row.line ?? ''));
          const model = typeof row.modelExpectedDisposals === 'number' ? row.modelExpectedDisposals : null;
          const actualTog = typeof match.percent_played === 'number'
            ? match.percent_played
            : Number.parseFloat(String(match.percent_played ?? ''));
          const kicks = typeof match.kicks === 'number' ? match.kicks : Number.parseFloat(String(match.kicks ?? ''));
          const handballs = typeof match.handballs === 'number' ? match.handballs : Number.parseFloat(String(match.handballs ?? ''));
          const marks = typeof match.marks === 'number' ? match.marks : Number.parseFloat(String(match.marks ?? ''));
          const tackles = typeof match.tackles === 'number' ? match.tackles : Number.parseFloat(String(match.tackles ?? ''));
          updates.set(idx, {
            ...row,
            actualDisposals: Number(actual.toFixed(2)),
            actualTog: Number.isFinite(actualTog) ? Number(actualTog.toFixed(2)) : row.actualTog ?? null,
            kicks: Number.isFinite(kicks) ? Number(kicks.toFixed(0)) : row.kicks ?? null,
            handballs: Number.isFinite(handballs) ? Number(handballs.toFixed(0)) : row.handballs ?? null,
            marks: Number.isFinite(marks) ? Number(marks.toFixed(0)) : row.marks ?? null,
            tackles: Number.isFinite(tackles) ? Number(tackles.toFixed(0)) : row.tackles ?? null,
            differenceLine: Number.isFinite(line) ? Number((actual - line).toFixed(2)) : row.differenceLine ?? null,
            differenceModel: model != null ? Number((actual - model).toFixed(2)) : row.differenceModel ?? null,
            resultColor: Number.isFinite(line) ? (actual >= line ? 'green' : 'red') : row.resultColor ?? null,
          });
        }
        if (updates.size > 0 && !cancelled) {
          setRows((prev) => prev.map((row, idx) => updates.get(idx) ?? row));
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadEval = async () => {
      try {
        const res = await fetch('/api/afl/model/disposals/performance', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as EvalSummary;
        if (!cancelled) setEvalSummary(data);
      } catch {
        // Non-blocking for page rendering.
      }
    };
    void loadEval();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {loading && <p className="text-sm text-slate-400 mb-3">Loading history...</p>}
        {error && <p className="text-sm text-rose-400 mb-3">{error}</p>}
        <div className="mb-4 text-center text-xl md:text-2xl font-semibold">
          <span className="text-emerald-400">{summary.wins}</span>
          <span className="mx-2 text-slate-400">-</span>
          <span className="text-rose-400">{summary.losses}</span>
          <span className="mx-2 text-slate-500">-</span>
          <span className="text-slate-200">Hit Rate {summary.hitRate.toFixed(1)}%</span>
        </div>
        {!!evalSummary?.hasData && (
          <div className="mb-3 text-center text-xs md:text-sm text-slate-400">
            <span>
              Calib: {String(evalSummary.candidate?.calibrationMethod ?? 'n/a')}
            </span>
            <span className="mx-2">|</span>
            <span>
              Eval Hit: {typeof evalSummary.candidate?.hitRate === 'number' ? `${(evalSummary.candidate.hitRate * 100).toFixed(1)}%` : '-'}
            </span>
            <span className="mx-2">|</span>
            <span>
              Brier: {typeof evalSummary.candidate?.brierScore === 'number' ? evalSummary.candidate.brierScore.toFixed(4) : '-'}
            </span>
            <span className="mx-2">|</span>
            <span>
              Guardrails: {evalSummary.decision?.pass ? 'PASS' : 'FAIL'}
            </span>
            <span className="mx-2">|</span>
            <span>
              Promoted: {evalSummary.decision?.promoted ? 'YES' : 'NO'}
            </span>
          </div>
        )}

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-x-auto">
          <table className="w-full min-w-[1280px] text-sm">
            <thead className="bg-slate-900">
              <tr className="text-slate-300 border-b border-slate-800">
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Player</th>
                <th className="text-left p-3">Matchup</th>
                <th className="text-left p-3">Bookmaker</th>
                <th className="text-right p-3">Line</th>
                <th className="text-left p-3">Book Odds</th>
                <th className="text-right p-3">Model</th>
                <th className="text-right p-3">Actual</th>
                <th className="text-right p-3">TOG%</th>
                <th className="text-right p-3">Win/Loss</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const bookmakerInfo = getBookmakerInfo(String(row.bookmaker ?? ''));
                const homeLogo = resolveTeamLogo(String(row.homeTeam ?? ''), logoByTeam);
                const awayLogo = resolveTeamLogo(String(row.awayTeam ?? ''), logoByTeam);
                const outcome = getRowOutcome(row);
                const { result, modelSide, line, model } = outcome;
                const resultClass =
                  result === 'Win'
                    ? 'text-emerald-400'
                    : result === 'Loss'
                      ? 'text-rose-400'
                      : 'text-slate-400';
                return (
                  <tr key={`${row.snapshotKey}-${row.bookmaker}-${row.line}`} className="border-b border-slate-800/70">
                    <td className="p-3 text-slate-300">{formatDate(row.gameDate)}</td>
                    <td className="p-3 font-medium">{row.playerName || '-'}</td>
                    <td className="p-3 text-slate-300">
                      {(row.homeTeam && row.awayTeam) ? (
                        (homeLogo || awayLogo) ? (
                          <div className="flex items-center gap-2">
                            {homeLogo ? <img src={homeLogo} alt={String(row.homeTeam)} className="w-5 h-5 object-contain" /> : <span className="text-xs">{String(row.homeTeam).slice(0, 3).toUpperCase()}</span>}
                            <span className="text-slate-400 text-xs">vs</span>
                            {awayLogo ? <img src={awayLogo} alt={String(row.awayTeam)} className="w-5 h-5 object-contain" /> : <span className="text-xs">{String(row.awayTeam).slice(0, 3).toUpperCase()}</span>}
                          </div>
                        ) : (
                          `${row.homeTeam} vs ${row.awayTeam}`
                        )
                      ) : '-'}
                    </td>
                    <td className="p-3 text-slate-300">
                      {bookmakerInfo.logoUrl ? (
                        <>
                          <img
                            src={bookmakerInfo.logoUrl}
                            alt={bookmakerInfo.name}
                            className="w-6 h-6 rounded object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement | null;
                              if (fallback) fallback.style.display = 'flex';
                            }}
                          />
                          <span
                            className="w-6 h-6 rounded hidden items-center justify-center text-[10px] font-semibold text-white"
                            style={{ backgroundColor: bookmakerInfo.color }}
                          >
                            {bookmakerInfo.logo}
                          </span>
                        </>
                      ) : (
                        <span
                          className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-semibold text-white"
                          style={{ backgroundColor: bookmakerInfo.color }}
                        >
                          {bookmakerInfo.logo}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right">{formatNumber(row.line, 1)}</td>
                    <td className="p-3 text-slate-300">
                      {row.overOdds || row.underOdds ? `O ${formatOddsDecimal(row.overOdds)} | U ${formatOddsDecimal(row.underOdds)}` : '-'}
                    </td>
                    <td className="p-3 text-right">
                      {Number.isFinite(model) && Number.isFinite(line)
                        ? `${formatNumber(model, 2)} (${modelSide})`
                        : formatNumber(row.modelExpectedDisposals, 2)}
                    </td>
                    <td className="p-3 text-right">
                      {typeof row.actualDisposals === 'number' ? formatNumber(row.actualDisposals, 2) : <span className="text-slate-400">Pending</span>}
                    </td>
                    <td className="p-3 text-right text-slate-300">{typeof row.actualTog === 'number' ? formatNumber(row.actualTog, 1) : '-'}</td>
                    <td className={`p-3 text-right font-semibold ${resultClass}`}>
                      {result}
                    </td>
                  </tr>
                );
              })}
              {sortedRows.length === 0 && !loading && (
                <tr>
                  <td className="p-4 text-slate-400 text-center" colSpan={10}>
                    No completed games with full stats yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

