import { currentBacktestReport } from '@/lib/tennisAi/store';

export default function TennisAiAdminPage() {
  const report = currentBacktestReport();
  return (
    <main className="mx-auto max-w-3xl px-6 py-10 text-sm text-gray-100">
      <h1 className="text-xl font-semibold">Tennis AI backtest</h1>
      <p className="mt-2 text-gray-400">
        A market can show a value label only after this gate passes. Until then the analyst stays informational.
      </p>
      <dl className="mt-6 space-y-2">
        <div>Approved: {report.approved ? 'yes' : 'no'}</div>
        <div>Bets: {report.n}</div>
        <div>Log loss: {report.logLoss ?? 'n/a'}</div>
        <div>Market log loss: {report.marketLogLoss ?? 'n/a'}</div>
        <div>Closing line value: {report.clvPct == null ? 'n/a' : `${report.clvPct}%`}</div>
      </dl>
      <ul className="mt-4 list-disc pl-5 text-gray-300">
        {report.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </main>
  );
}
