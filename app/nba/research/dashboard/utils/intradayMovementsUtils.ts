import { LINE_MOVEMENT_ENABLED } from '../constants';
import { filterByMarket, OddsSnapshot } from '@/lib/odds';

export interface LineMovementData {
  lineMovement?: Array<{ bookmaker: string; line: number; change: number; timestamp: string }>;
  openingLine?: { line: number; bookmaker: string; timestamp: string; overOdds?: number; underOdds?: number } | null;
  currentLine?: { line: number; bookmaker: string; timestamp: string; overOdds?: number; underOdds?: number } | null;
}

export interface IntradayMovement {
  ts: number;
  timeLabel: string;
  line: number;
  change: string;
  direction: 'up' | 'down' | 'flat';
}

/**
 * Build intraday movement rows from line movement data
 */
export function processIntradayMovements(
  lineMovementData: LineMovementData | null,
  oddsSnapshots: OddsSnapshot[],
  marketKey: string
): IntradayMovement[] {
  if (!LINE_MOVEMENT_ENABLED) {
    return [];
  }
  if (lineMovementData) {
    const { lineMovement = [], openingLine, currentLine } = lineMovementData;

    if (lineMovement.length > 0) {
      return lineMovement
        .map((movement) => {
          const dt = new Date(movement.timestamp);
          const timeLabel = dt.toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
          });
          const direction = movement.change > 0 ? 'up' : movement.change < 0 ? 'down' : 'flat';
          return {
            ts: new Date(movement.timestamp).getTime(),
            timeLabel: `${timeLabel} (${movement.bookmaker})`,
            line: movement.line,
            change: `${movement.change > 0 ? '+' : ''}${movement.change.toFixed(1)}`,
            direction: direction as 'up' | 'down' | 'flat',
          };
        })
        .sort((a, b) => b.ts - a.ts); // Most recent first (descending by timestamp)
    }

    const fallbackRows: IntradayMovement[] = [];
    const formatLabel = (entry: typeof openingLine, label: string) => {
      if (!entry) return '';
      const dt = new Date(entry.timestamp);
      const time = dt.toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      });
      const suffix = entry.bookmaker ? ` (${entry.bookmaker})` : '';
      return `${time}${suffix}${label ? ` — ${label}` : ''}`;
    };

    if (openingLine) {
      fallbackRows.push({
        ts: new Date(openingLine.timestamp).getTime(),
        timeLabel: formatLabel(openingLine, 'Opening'),
        line: openingLine.line,
        change: '',
        direction: 'flat'
      });
    }

    if (currentLine) {
      const delta = openingLine ? currentLine.line - openingLine.line : 0;
      const hasDifferentTimestamp = !openingLine || currentLine.timestamp !== openingLine.timestamp;
      const hasDifferentLine = !openingLine || currentLine.line !== openingLine.line;

      if (hasDifferentTimestamp || hasDifferentLine) {
        fallbackRows.push({
          ts: new Date(currentLine.timestamp).getTime(),
          timeLabel: formatLabel(currentLine, 'Latest'),
          line: currentLine.line,
          change: openingLine ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : '',
          direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
        });
      }
    }

    if (fallbackRows.length > 0) {
      return fallbackRows.sort((a, b) => b.ts - a.ts);
    }
  }
  
  // Fallback to old snapshot logic for team mode
  const items = filterByMarket(oddsSnapshots, marketKey)
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);
  const rows: IntradayMovement[] = [];
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const cur = items[i];
    const delta = cur.line - prev.line;
    const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    const dt = new Date(cur.timestamp);
    const timeLabel = dt.toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
    rows.push({
      ts: cur.timestamp,
      timeLabel,
      line: cur.line,
      change: `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`,
      direction: dir,
    });
  }
  return rows.sort((a, b) => b.ts - a.ts); // Most recent first (descending by timestamp)
}

