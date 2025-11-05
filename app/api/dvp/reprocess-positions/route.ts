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
async function reprocessTeam(team: string): Promise<{ success: boolean; team: string; games?: number; error?: string }> {
  try {
    const abbr = normalizeAbbr(team);
    if (!abbr || !(abbr in NBA_TEAMS)) {
      return { success: false, team, error: 'Invalid team' };
    }
    
    // Load the stored DVP data
    const storeDir = path.resolve(process.cwd(), 'data', 'dvp_store', '2025');
    const storeFile = path.join(storeDir, `${abbr}.json`);
    
    let games: any[];
    try {
      const raw = await fs.readFile(storeFile, 'utf8');
      games = JSON.parse(raw);
      if (!Array.isArray(games)) {
        return { success: false, team, error: 'Invalid data format' };
      }
    } catch {
      return { success: false, team, error: 'No stored data found' };
    }
    
    // Load current position mappings
    const { positions, aliases } = await loadCustomPositions(abbr);
    
    // Reprocess each game
    for (const game of games) {
      const players = Array.isArray(game?.players) ? game.players : [];
      
      // Reset buckets
      const newBuckets: Record<'PG'|'SG'|'SF'|'PF'|'C', number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
      
      // Recalculate bucket totals based on EXISTING player buckets (don't change them)
      for (const player of players) {
        const bucket = player.bucket;
        
        // Add to bucket total (using pts)
        if (bucket && ['PG','SG','SF','PF','C'].includes(bucket)) {
          newBuckets[bucket as 'PG'|'SG'|'SF'|'PF'|'C'] += Number(player?.pts || 0);
        }
      }
      
      // Update game buckets
      game.buckets = newBuckets;
    }
    
    // Save updated data
    await fs.writeFile(storeFile, JSON.stringify(games, null, 2));
    
    return { success: true, team: abbr, games: games.length };
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
