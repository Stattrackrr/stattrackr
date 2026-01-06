import { LINE_MOVEMENT_ENABLED } from '../constants';

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
  lineMovementData: LineMovementData | null
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
      const changeStr = delta !== 0 ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : '';
      fallbackRows.push({
        ts: new Date(currentLine.timestamp).getTime(),
        timeLabel: formatLabel(currentLine, 'Current'),
        line: currentLine.line,
        change: changeStr,
        direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
      });
    }

    return fallbackRows.sort((a, b) => b.ts - a.ts);
  }

  return [];
}

