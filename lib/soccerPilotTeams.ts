import fs from 'fs';
import path from 'path';

const TEAM_SAMPLE_PATH = path.join(process.cwd(), 'data', 'soccerway-teams-sample.json');

export type SoccerPilotTeam = {
  name: string;
  href: string;
  competitions: Array<{ country: string; competition: string }>;
};

function normalizeTeamHref(href: string): string {
  const value = String(href || '').trim();
  if (!value) return '';
  return (value.startsWith('/') ? value : `/${value}`).replace(/\/+$/, '');
}

export function readSoccerPilotTeams(limit = 10): SoccerPilotTeam[] {
  try {
    if (!fs.existsSync(TEAM_SAMPLE_PATH)) return [];
    const raw = fs.readFileSync(TEAM_SAMPLE_PATH, 'utf8');
    const json = JSON.parse(raw) as { uniqueTeams?: unknown[] };
    const uniqueTeams = Array.isArray(json?.uniqueTeams) ? json.uniqueTeams : [];

    return uniqueTeams
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const row = entry as Record<string, unknown>;
        const name = String(row.name || '').trim();
        const href = normalizeTeamHref(String(row.href || ''));
        if (!name || !href) return null;
        const competitionsRaw = Array.isArray(row.competitions) ? row.competitions : [];
        const competitions = competitionsRaw
          .map((competition) => {
            if (!competition || typeof competition !== 'object') return null;
            const c = competition as Record<string, unknown>;
            return {
              country: String(c.country || '').trim(),
              competition: String(c.competition || '').trim(),
            };
          })
          .filter((competition): competition is { country: string; competition: string } => competition != null);
        return { name, href, competitions };
      })
      .filter((team): team is SoccerPilotTeam => team != null)
      .slice(0, Math.max(1, limit));
  } catch {
    return [];
  }
}
