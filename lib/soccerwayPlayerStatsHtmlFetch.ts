import { SOCCERWAY_HTML_HEADERS } from '@/lib/soccerwaySquadHtml';

/** Extract each top-level <table>...</table> block (handles nested tables via depth counting). */
export function extractTopLevelTableHtmlBlocks(html: string): string[] {
  const lower = html.toLowerCase();
  const out: string[] = [];
  let pos = 0;

  const skipTagEnd = (from: number): number => {
    const gt = html.indexOf('>', from);
    return gt === -1 ? from : gt + 1;
  };

  while (pos < html.length) {
    const open = lower.indexOf('<table', pos);
    if (open === -1) break;
    const start = open;
    let i = skipTagEnd(open);
    let depth = 1;
    while (i < html.length && depth > 0) {
      const nextOpen = lower.indexOf('<table', i);
      const nextClose = lower.indexOf('</table>', i);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        i = skipTagEnd(nextOpen);
      } else {
        depth -= 1;
        i = nextClose + '</table>'.length;
      }
    }
    if (depth === 0) {
      out.push(html.slice(start, i));
      pos = i;
    } else {
      break;
    }
  }
  return out;
}

function stripCellText(innerHtml: string): string {
  return innerHtml
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse rows from a single <table>...</table> HTML fragment. */
export function parseTableRowsFromHtmlFragment(tableHtml: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRe.exec(tableHtml)) !== null) {
    const rowHtml = trMatch[1] || '';
    const cells: string[] = [];
    const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      cells.push(stripCellText(cellMatch[1] || ''));
    }
    if (cells.some((c) => c)) rows.push(cells);
  }
  if (!rows.length) return { headers: [], rows: [] };
  return {
    headers: rows[0] || [],
    rows: rows.slice(1).filter((row) => row.some((cell) => cell)),
  };
}

export function pickLargestTableFromHtml(html: string): { headers: string[]; rows: string[][] } {
  const blocks = extractTopLevelTableHtmlBlocks(html);
  let best: { headers: string[]; rows: string[][] } = { headers: [], rows: [] };
  let bestN = 0;
  for (const block of blocks) {
    const parsed = parseTableRowsFromHtmlFragment(block);
    const n = parsed.rows.length + (parsed.headers.length ? 1 : 0);
    if (n > bestN) {
      bestN = n;
      best = parsed;
    }
  }
  if (bestN === 0) {
    const fallback = parseTableRowsFromHtmlFragment(html);
    if (fallback.rows.length + (fallback.headers.length ? 1 : 0) > bestN) return fallback;
  }
  return best;
}

export async function fetchSoccerwayPlayerStatsHtml(url: string, timeoutMs = 8000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: SOCCERWAY_HTML_HEADERS,
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Soccerway returned ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}
