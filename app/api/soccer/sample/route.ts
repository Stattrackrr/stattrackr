import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SAMPLE_PATH = path.join(process.cwd(), 'data', 'soccerway-match-sample.json');
const EXTRACTOR_PATH = path.join(process.cwd(), 'scripts', 'extract-soccerway-match.js');
const TEAM_SAMPLE_PATH = path.join(process.cwd(), 'data', 'soccerway-teams-sample.json');
const TEAM_EXTRACTOR_PATH = path.join(process.cwd(), 'scripts', 'extract-soccerway-teams.js');

type SoccerSamplePayload = Record<string, unknown>;

function readJsonFile(filePath: string): SoccerSamplePayload | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as SoccerSamplePayload;
  } catch {
    return null;
  }
}

function readSample(): SoccerSamplePayload | null {
  return readJsonFile(SAMPLE_PATH);
}

function readTeamSample(): SoccerSamplePayload | null {
  return readJsonFile(TEAM_SAMPLE_PATH);
}

function runExtractor(scriptPath: string, logLabel: string): boolean {
  try {
    execFileSync('node', [scriptPath], {
      cwd: process.cwd(),
      timeout: 120000,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return true;
  } catch (error) {
    console.error(logLabel, error);
    return false;
  }
}

function refreshSample(): SoccerSamplePayload | null {
  const ok = runExtractor(EXTRACTOR_PATH, '[Soccer sample] Refresh failed:');
  return ok ? readSample() : null;
}

function refreshTeamSample(): SoccerSamplePayload | null {
  const ok = runExtractor(TEAM_EXTRACTOR_PATH, '[Soccer teams] Refresh failed:');
  return ok ? readTeamSample() : null;
}

export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const includeTeams = request.nextUrl.searchParams.get('includeTeams') === '1';
  const matchPayload = refresh ? refreshSample() : readSample();
  const teamsPayload = includeTeams ? (refresh ? refreshTeamSample() : readTeamSample()) : null;

  if (!matchPayload && !teamsPayload) {
    return NextResponse.json(
      { error: 'Soccer sample not found. Run the extractor or refresh this endpoint.' },
      { status: 404 }
    );
  }

  if (!includeTeams) {
    return NextResponse.json(matchPayload);
  }

  return NextResponse.json({
    matchSample: matchPayload,
    teamSample: teamsPayload,
  });
}
