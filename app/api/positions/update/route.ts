import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { authorizeAdminRequest } from '@/lib/adminAuth';
import { checkRateLimit, strictRateLimiter } from '@/lib/rateLimit';

// Normalize player name (lowercase, remove special chars)
function normName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

// Validate position
function isValidPosition(pos: string): pos is 'PG' | 'SG' | 'SF' | 'PF' | 'C' {
  return ['PG', 'SG', 'SF', 'PF', 'C'].includes(pos);
}

// Load existing positions file
async function loadPositionsFile(filePath: string): Promise<any> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return { positions: {}, aliases: {} };
  }
}

// Save positions file
async function savePositionsFile(filePath: string, data: any): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export async function POST(req: NextRequest) {
  try {
    // Authentication check - admin only
    const authResult = await authorizeAdminRequest(req);
    if (!authResult.authorized) {
      return authResult.response;
    }

    // Rate limiting
    const rateResult = checkRateLimit(req, strictRateLimiter);
    if (!rateResult.allowed && rateResult.response) {
      return rateResult.response;
    }

    const body = await req.json();
    const { team, updates, forceOverride } = body;

    // Validate inputs
    if (!updates || typeof updates !== 'object') {
      return NextResponse.json(
        { error: 'Invalid updates. Expected object with player names as keys and positions as values.' },
        { status: 400 }
      );
    }

    // Determine file path
    const isServerless = process.env.VERCEL === '1' || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME;
    if (isServerless) {
      return NextResponse.json(
        { error: 'Position updates are not supported in serverless environment. Use local development or a database.' },
        { status: 503 }
      );
    }

    let filePath: string;
    if (team) {
      // Team-specific file
      const teamAbbr = team.toUpperCase();
      filePath = path.resolve(process.cwd(), 'data', 'player_positions', 'teams', `${teamAbbr}.json`);
    } else {
      // Master file
      filePath = path.resolve(process.cwd(), 'data', 'player_positions', 'master.json');
    }

    // Load existing data
    const existing = await loadPositionsFile(filePath);
    const positions = existing.positions || {};
    const aliases = existing.aliases || {};

    // Apply updates
    const normalized: Record<string, string> = {};
    const errors: string[] = [];
    const updated: string[] = [];

    for (const [playerName, position] of Object.entries(updates)) {
      if (!isValidPosition(position as string)) {
        errors.push(`Invalid position for ${playerName}: ${position}. Must be PG, SG, SF, PF, or C.`);
        continue;
      }

      const normalizedName = normName(playerName);
      positions[normalizedName] = position as 'PG' | 'SG' | 'SF' | 'PF' | 'C';
      normalized[normalizedName] = position as string;
      updated.push(`${playerName} → ${position}`);
    }

    // Save updated file
    const updatedData = {
      positions,
      aliases
    };

    await savePositionsFile(filePath, updatedData);

    return NextResponse.json({
      success: true,
      message: `Updated ${updated.length} position(s) in ${team ? `team ${team}` : 'master'} file`,
      updated,
      errors: errors.length > 0 ? errors : undefined,
      filePath: path.relative(process.cwd(), filePath),
      forceOverride: forceOverride || false
    });

  } catch (error: any) {
    console.error('[Position Update] Error:', error);
    const isProduction = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      { 
        error: isProduction 
          ? 'An error occurred. Please try again later.' 
          : 'Failed to update positions',
        ...(isProduction ? {} : { details: error.message })
      },
      { status: 500 }
    );
  }
}

// GET endpoint to view current positions
export async function GET(req: NextRequest) {
  try {
    // Authentication check - admin only
    const authResult = await authorizeAdminRequest(req);
    if (!authResult.authorized) {
      return authResult.response;
    }

    // Rate limiting
    const rateResult = checkRateLimit(req, strictRateLimiter);
    if (!rateResult.allowed && rateResult.response) {
      return rateResult.response;
    }

    const searchParams = req.nextUrl.searchParams;
    const team = searchParams.get('team');

    const isServerless = process.env.VERCEL === '1' || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME;
    if (isServerless) {
      return NextResponse.json(
        { error: 'Position viewing is not supported in serverless environment.' },
        { status: 503 }
      );
    }

    let filePath: string;
    if (team) {
      const teamAbbr = team.toUpperCase();
      filePath = path.resolve(process.cwd(), 'data', 'player_positions', 'teams', `${teamAbbr}.json`);
    } else {
      filePath = path.resolve(process.cwd(), 'data', 'player_positions', 'master.json');
    }

    const data = await loadPositionsFile(filePath);

    return NextResponse.json({
      team: team || 'master',
      positions: data.positions || {},
      aliases: data.aliases || {},
      count: Object.keys(data.positions || {}).length
    });

  } catch (error: any) {
    console.error('[Position Get] Error:', error);
    const isProduction = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      { 
        error: isProduction 
          ? 'An error occurred. Please try again later.' 
          : 'Failed to load positions',
        ...(isProduction ? {} : { details: error.message })
      },
      { status: 500 }
    );
  }
}


