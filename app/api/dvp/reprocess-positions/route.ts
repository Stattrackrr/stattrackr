export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from 'fs';
import path from 'path';
import { normalizeAbbr, NBA_TEAMS } from "@/lib/nbaAbbr";

export const runtime = "nodejs";

// Normalize player name for matching
function normName(s: string): string {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

// Load custom positions from data/player_positions/
async function loadCustomPositions(team?: string): Promise<{ positions: Record<string, 'PG'|'SG'|'SF'|'PF'|'C'>, aliases: Record<string, string> }> {
  try {
    const dir = path.resolve(process.cwd(), 'data', 'player_positions');
    const masterPath = path.join(dir, 'master.json');
    let positions: Record<string, any> = {};
    let aliases: Record<string, string> = {};
    
    // Load master positions
    try {
      const raw = await fs.readFile(masterPath, 'utf8');
      const j = JSON.parse(raw);
      positions = { ...(j?.positions || {}) };
      aliases = { ...(j?.aliases || {}) };
    } catch {}
    
    // Load team-specific positions
    const teamsDir = path.join(dir, 'teams');
    try {
      const files = (await fs.readdir(teamsDir)).filter(f => f.endsWith('.json'));
      for (const f of files) {
        // If team is specified, only load that team's file
        if (team && !f.startsWith(team.toUpperCase())) continue;
        
        try {
          const raw = await fs.readFile(path.join(teamsDir, f), 'utf8');
          const j = JSON.parse(raw);
          const teamPos = j?.positions || {};
          for (const [k, v] of Object.entries(teamPos)) {
            const key = normName(k);
            if (['PG','SG','SF','PF','C'].includes(String(v))) {
              positions[key] = v as any;
            }
          }
          const teamAliases = j?.aliases || {};
          for (const [k, v] of Object.entries(teamAliases)) {
            aliases[normName(k)] = normName(String(v));
          }
        } catch {}
      }
    } catch {}
    
    return { positions: positions as any, aliases };
  } catch {
    return { positions: {}, aliases: {} };
  }
}

// Reprocess a single team's DVP data with updated positions
async function reprocessTeam(team: string): Promise<{ success: boolean; team: string; games?: number; playersUpdated?: number; gamesUpdated?: number; serverless?: boolean; note?: string; error?: string }> {
  try {
    const abbr = normalizeAbbr(team);
    if (!abbr || !(abbr in NBA_TEAMS)) {
      return { success: false, team, error: 'Invalid team' };
    }
    
    // Check if we're in a serverless environment
    const isServerless = process.env.VERCEL === '1' || 
                         process.env.VERCEL_ENV !== undefined || 
                         process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined ||
                         process.env.VERCEL_URL !== undefined;
    
    // Load the stored DVP data
    const storeDir = path.resolve(process.cwd(), 'data', 'dvp_store', '2025');
    const storeFile = path.join(storeDir, `${abbr}.json`);
    
    let games: any[];
    try {
      if (isServerless) {
        // In serverless, we can't read files - return error
        return { success: false, team, error: 'Reprocess not available in serverless environment. Use re-ingest instead.' };
      }
      const raw = await fs.readFile(storeFile, 'utf8');
      games = JSON.parse(raw);
      if (!Array.isArray(games)) {
        return { success: false, team, error: 'Invalid data format' };
      }
    } catch (e: any) {
      if (e.code === 'EROFS' || e.code === 'EACCES' || e.message?.includes('read-only')) {
        return { success: false, team, error: 'Read-only filesystem. Use re-ingest instead of reprocess.' };
      }
      return { success: false, team, error: 'No stored data found' };
    }
    
    // Load current position mappings
    const { positions, aliases } = await loadCustomPositions(abbr);
    
    let playersUpdated = 0;
    let gamesUpdated = 0;
    
    // Reprocess each game
    for (const game of games) {
      const players = Array.isArray(game?.players) ? game.players : [];
      
      // Reset buckets - will recalculate based on NEW positions
      const newBuckets: Record<'PG'|'SG'|'SF'|'PF'|'C', number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
      let gameChanged = false;
      
      // Update player positions based on custom mappings and recalculate buckets
      for (const player of players) {
        const playerName = String(player?.name || '').trim();
        if (!playerName) continue;
        
        // Normalize player name for lookup
        const nameKey = normName(playerName);
        
        // Check aliases first
        const canonicalName = aliases[nameKey] || nameKey;
        const lookupKey = aliases[canonicalName] || canonicalName;
        
        // Get new position from custom mappings (master or team-specific)
        let newBucket: 'PG'|'SG'|'SF'|'PF'|'C' | null = null;
        
        // Try direct lookup
        if (positions[lookupKey] && ['PG','SG','SF','PF','C'].includes(positions[lookupKey])) {
          newBucket = positions[lookupKey] as 'PG'|'SG'|'SF'|'PF'|'C';
        }
        // Try canonical name
        else if (positions[canonicalName] && ['PG','SG','SF','PF','C'].includes(positions[canonicalName])) {
          newBucket = positions[canonicalName] as 'PG'|'SG'|'SF'|'PF'|'C';
        }
        // Try original name
        else if (positions[nameKey] && ['PG','SG','SF','PF','C'].includes(positions[nameKey])) {
          newBucket = positions[nameKey] as 'PG'|'SG'|'SF'|'PF'|'C';
        }
        
        // Update player bucket if we found a new position
        if (newBucket && player.bucket !== newBucket) {
          player.bucket = newBucket;
          playersUpdated++;
          gameChanged = true;
        }
        
        // Use the updated bucket (or keep existing if no mapping found)
        const bucket = player.bucket as 'PG'|'SG'|'SF'|'PF'|'C';
        
        // Add player's points to the appropriate position bucket
        if (bucket && ['PG','SG','SF','PF','C'].includes(bucket)) {
          newBuckets[bucket] += Number(player?.pts || 0);
        }
      }
      
      // Update game buckets with recalculated totals
      game.buckets = newBuckets;
      if (gameChanged) gamesUpdated++;
    }
    
    // Save updated data (skip in serverless)
    if (!isServerless) {
      try {
        await fs.writeFile(storeFile, JSON.stringify(games, null, 2));
      } catch (e: any) {
        if (e.code === 'EROFS' || e.code === 'EACCES' || e.message?.includes('read-only')) {
          return { 
            success: false, 
            team: abbr, 
            error: 'Read-only filesystem. Data was computed but not saved. Use re-ingest instead.' 
          };
        }
        throw e;
      }
    }
    
    return { 
      success: true, 
      team: abbr, 
      games: games.length,
      playersUpdated,
      gamesUpdated,
      serverless: isServerless,
      note: isServerless ? 'Data computed but not persisted (serverless environment)' : undefined
    };
  } catch (e: any) {
    return { success: false, team, error: e?.message || 'Reprocess failed' };
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const team = searchParams.get('team');
    
    // Single team or all teams
    if (team) {
      const result = await reprocessTeam(team);
      return NextResponse.json(result);
    } else {
      // Process all teams
      const teams = Object.keys(NBA_TEAMS);
      const results: any[] = [];
      
      for (const t of teams) {
        const result = await reprocessTeam(t);
        results.push(result);
      }
      
      const successCount = results.filter(r => r.success).length;
      return NextResponse.json({ 
        success: true, 
        total: teams.length, 
        successful: successCount,
        results 
      });
    }
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'Reprocess failed' }, { status: 200 });
  }
}
