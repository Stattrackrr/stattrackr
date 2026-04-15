/**
 * Parse recent results embedded in Soccerway team /results/ HTML (Flashscore-style ~AA÷ blocks).
 */

export type SoccerwayRecentMatch = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  kickoffUnix: number | null;
  summaryPath: string;
};

function pickInt(raw: string | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function pickUnix(raw: string | undefined): number | null {
  const n = pickInt(raw);
  return n != null && n > 1_000_000_000 ? n : null;
}

export function parseSoccerwayTeamResultsHtml(html: string, limit = 20): SoccerwayRecentMatch[] {
  const chunks = html.split('~AA÷');
  const out: SoccerwayRecentMatch[] = [];
  const seenPath = new Set<string>();

  for (let i = 1; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (!chunk) continue;
    const parts = chunk.split('¬');
    const matchId = parts[0]?.includes('÷') ? null : parts[0];
    if (!matchId) continue;

    const fields: Record<string, string> = {};
    for (let p = 1; p < parts.length; p += 1) {
      const seg = parts[p];
      const div = seg.indexOf('÷');
      if (div === -1) continue;
      const key = seg.slice(0, div);
      const val = seg.slice(div + 1);
      if (key) fields[key] = val;
    }

    const wu = fields.WU;
    const px = fields.PX;
    const wv = fields.WV;
    const py = fields.PY;
    const ae = fields.AE;
    const af = fields.AF;
    const ag = pickInt(fields.AG);
    const ah = pickInt(fields.AH);
    const kick = pickUnix(fields.AD);

    if (!wu || !px || !wv || !py || !ae || !af || ag == null || ah == null) continue;

    const summaryPath = `/match/${wu}-${px}/${wv}-${py}/summary/`;
    if (seenPath.has(summaryPath)) continue;
    seenPath.add(summaryPath);

    out.push({
      matchId,
      homeTeam: ae,
      awayTeam: af,
      homeScore: ag,
      awayScore: ah,
      kickoffUnix: kick,
      summaryPath,
    });

    if (out.length >= limit) break;
  }

  return out;
}
