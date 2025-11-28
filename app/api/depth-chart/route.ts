export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import cache, { CACHE_TTL, getCacheKey } from '@/lib/cache';
import { checkRateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';
const DBG = process.env.DEBUG_DEPTH_CHART === '1';

// ESPN abbreviation alias map for matching quirks
const ESPN_ABBR_ALIASES: Record<string, string[]> = {
  ATL: ['ATL'],
  BOS: ['BOS'],
  BKN: ['BKN', 'BRK'],
  CHA: ['CHA', 'CHH'],
  CHI: ['CHI'],
  CLE: ['CLE'],
  DAL: ['DAL'],
  DEN: ['DEN'],
  DET: ['DET'],
  GSW: ['GS', 'GSW'],
  HOU: ['HOU'],
  IND: ['IND'],
  LAC: ['LAC'],
  LAL: ['LAL'],
  MEM: ['MEM'],
  MIA: ['MIA'],
  MIL: ['MIL'],
  MIN: ['MIN'],
  NOP: ['NO', 'NOP', 'NOR', 'NOH'],
  NYK: ['NY', 'NYK'],
  OKC: ['OKC', 'SEA'],
  ORL: ['ORL'],
  PHI: ['PHI'],
  PHX: ['PHX', 'PHO'],
  POR: ['POR'],
  SAC: ['SAC'],
  SAS: ['SA', 'SAS', 'SAN'],
  TOR: ['TOR'],
  UTA: ['UTA', 'UTAH', 'UTH'],
  WAS: ['WAS', 'WSH'],
};

const abbrCandidates = (inAbbr: string): string[] => {
  const A = (inAbbr || '').toUpperCase();
  const set = new Set<string>([A]);
  (ESPN_ABBR_ALIASES[A] || []).forEach(x => set.add(x.toUpperCase()));
  if (A.length === 3) set.add(A.slice(0, 2));
  if (A === 'WAS') set.add('WSH');
  return [...set];
};

const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim();

function toKey(v: string | undefined): 'PG'|'SG'|'SF'|'PF'|'C'|undefined {
  const up = String(v || '').toUpperCase();
  if (['PG','SG','SF','PF','C'].includes(up)) return up as any;
  if (up.startsWith('POINT')) return 'PG';
  if (up.startsWith('SHOOT')) return 'SG';
  if (up.startsWith('SMALL')) return 'SF';
  if (up.startsWith('POWER')) return 'PF';
  if (up.startsWith('CENTER') || up === 'CTR') return 'C';
  return undefined;
}

const KEYS: Array<'PG'|'SG'|'SF'|'PF'|'C'> = ['PG','SG','SF','PF','C'];
const ALT: Record<'PG'|'SG'|'SF'|'PF'|'C', Array<'PG'|'SG'|'SF'|'PF'|'C'>> = {
  PG: ['SG'],
  SG: ['PG'],
  SF: ['PF'],
  PF: ['SF', 'C'],
  C:  ['PF'],
};

export async function GET(req: NextRequest) {
  // Check rate limit
  const rateLimitResult = checkRateLimit(req);
  if (!rateLimitResult.allowed) {
    return rateLimitResult.response!;
  }
  
  try {
    const { searchParams } = new URL(req.url);
    const inputTeam = (searchParams.get('team') || '').toUpperCase();
    const playerName = searchParams.get('player') || '';
    const forceRefresh = searchParams.get('refresh') === '1';

    if (!inputTeam) {
      return NextResponse.json({ success: false, error: 'Missing team' }, { status: 400 });
    }

    // Try cache first unless forced refresh
    const cacheKey = getCacheKey.depthChart(inputTeam);
    if (!forceRefresh) {
      const hit = cache.get<any>(cacheKey);
      if (hit) return NextResponse.json(hit, { status: 200 });
    }

    // Resolve ESPN team by abbreviation
    const teamsResp = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams', { cache: 'no-store' });
    if (!teamsResp.ok) throw new Error('Failed to load ESPN teams');
    const teamsJson = await teamsResp.json();
    const allTeams: any[] = teamsJson?.sports?.[0]?.leagues?.[0]?.teams?.map((t: any) => t.team) || [];
    const cands = abbrCandidates(inputTeam);
    
    // Try multiple fields: abbreviation, shortDisplayName, name, displayName
    const team = allTeams.find((t: any) => {
      const abbr = String(t?.abbreviation || '').toUpperCase();
      const shortName = String(t?.shortDisplayName || '').toUpperCase();
      const name = String(t?.name || '').toUpperCase();
      const displayName = String(t?.displayName || '').toUpperCase();
      return cands.includes(abbr) || cands.includes(shortName) || cands.includes(name) || cands.includes(displayName);
    });
    
    const debug: Record<string, any> = { 
      inputTeam, 
      candidates: cands, 
      matchedTeam: team?.abbreviation || team?.shortDisplayName || team?.name || null,
      allTeamAbbrs: allTeams.map(t => ({ 
        abbr: t?.abbreviation, 
        shortName: t?.shortDisplayName, 
        name: t?.name,
        id: t?.id 
      })),
      endpoints: {} 
    };
    if (!team?.id) return NextResponse.json({ success: false, error: `Unknown team: ${inputTeam}` , debug }, { status: 404 });

    // Fetch roster for jersey numbers
    const rosterResp = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${team.id}?enable=roster`, { cache: 'no-store' });
    const rosterJson = rosterResp.ok ? await rosterResp.json() : null;
    const rosterAthletes: any[] = rosterJson?.team?.athletes || [];
    const findJersey = (name: string) => {
      const n = norm(name);
      const p = rosterAthletes.find(a => norm(a?.displayName || '') === n);
      return p?.jersey || '';
    };

    // Try JSON depth endpoints (preferred)
    const out: Record<'PG'|'SG'|'SF'|'PF'|'C', string[]> = { PG: [], SG: [], SF: [], PF: [], C: [] };

    const extractGroupOrdered = (g: any): string[] => {
      const items = g?.athletes || g?.items || g?.players || g?.entries || [];
      const arr = Array.isArray(items) ? items : [];
      const takeName = (x: any) => x?.athlete?.displayName || x?.player?.displayName || x?.displayName || x?.name;
      const orderOf = (x: any, i: number) => {
        const v = x?.positionDepth ?? x?.depth ?? x?.order ?? x?.rank ?? x?.slot ?? x?.displayOrder ?? x?.index;
        const n = Number(v);
        return Number.isFinite(n) ? n : i; // fallback to original index
      };
      const decorated = arr.map((x: any, i: number) => ({ 
        name: takeName(x), 
        ord: orderOf(x, i),
        rawOrder: x?.positionDepth ?? x?.depth ?? x?.order ?? x?.rank ?? x?.slot ?? x?.displayOrder ?? x?.index,
        originalIndex: i
      })).filter((o: any) => typeof o.name === 'string' && o.name.trim());
      
      // Debug Milwaukee positions - add to debug object
      if (team?.abbreviation === 'MIL' && decorated.length > 0) {
        if (!debug.positionDetails) debug.positionDetails = {};
        debug.positionDetails[g?.position?.abbreviation || 'unknown'] = decorated.map(d => ({
          name: d.name,
          rawOrder: d.rawOrder,
          originalIndex: d.originalIndex,
          finalOrder: d.ord
        }));
      }
      
      decorated.sort((a: any, b: any) => a.ord - b.ord);
      return decorated.map((d: any) => d.name);
    };

    const stableUnique = (list: string[]): string[] => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const n of list) {
        const k = norm(n);
        if (!seen.has(k)) { seen.add(k); out.push(n); }
      }
      return out;
    };

    const tryJson = async () => {
      // 1) site.api (?enable=depthchart on team)
      const aUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${team.id}?enable=depthchart`;
      const a = await fetch(aUrl, { cache: 'no-store' }).catch(() => null);
      debug.endpoints.siteApi = { url: aUrl, ok: !!(a && a.ok) };
      if (a && a.ok) {
        const j = await a.json();
        const groups: any[] = j?.team?.depthChart?.positions || j?.team?.depthChart || j?.depthChart || [];
        debug.endpoints.siteApi.groups = Array.isArray(groups) ? groups.length : 0;
        if (Array.isArray(groups) && groups.length) {
          for (const g of groups) {
            const key = toKey(g?.position?.abbreviation || g?.positionAbbr || g?.abbr || g?.abbreviation || g?.position || g?.name);
            if (!key) continue;
            const names = stableUnique(extractGroupOrdered(g));
            if (names.length) {
              out[key] = names.slice(0, 5);
              // Debug: log what we extracted for this position
              if (team?.abbreviation === 'MIL') {
                console.log(`ESPN API ${key}:`, names);
              }
            }
          }
          debug.endpoints.siteApi.extracted = { PG: out.PG.length, SG: out.SG.length, SF: out.SF.length, PF: out.PF.length, C: out.C.length };
          if (Object.values(out).some(v => v.length)) return true;
        }
      }
      // 1b) site.api direct /depthchart endpoint
      const a2Url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${team.id}/depthchart`;
      const a2 = await fetch(a2Url, { cache: 'no-store' }).catch(() => null);
      debug.endpoints.siteApiDirect = { url: a2Url, ok: !!(a2 && a2.ok) };
      if (a2 && a2.ok) {
        const j2 = await a2.json();
        const groups2: any[] = j2?.team?.depthChart?.positions || j2?.depthChart?.positions || j2?.positions || j2 || [];
        debug.endpoints.siteApiDirect.groups = Array.isArray(groups2) ? groups2.length : 0;
        if (Array.isArray(groups2) && groups2.length) {
          for (const g of groups2) {
            const key = toKey(g?.position?.abbreviation || g?.positionAbbr || g?.abbr || g?.abbreviation || g?.position || g?.name);
            if (!key) continue;
            const names = stableUnique(extractGroupOrdered(g));
            if (names.length) out[key] = names.slice(0, 5);
          }
          debug.endpoints.siteApiDirect.extracted = { PG: out.PG.length, SG: out.SG.length, SF: out.SF.length, PF: out.PF.length, C: out.C.length };
          if (Object.values(out).some(v => v.length)) return true;
        }
      }
      // 2) site.web.api (singular then plural)
      const webUrls = [
        `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/teams/${team.id}/depthchart?region=us&lang=en&contentorigin=espn`,
        `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/teams/${team.id}/depthcharts?region=us&lang=en&contentorigin=espn`,
      ];
      for (const url of webUrls) {
        const r = await fetch(url, { cache: 'no-store' }).catch(() => null);
        debug.endpoints[url.includes('depthcharts') ? 'siteWebDepthcharts' : 'siteWebDepthchart'] = { url, ok: !!(r && r.ok) };
        if (r && r.ok) {
          const j = await r.json();
          const groups: any[] = j?.items || j?.positions || j?.depthCharts || [];
          const keyName = url.includes('depthcharts') ? 'siteWebDepthcharts' : 'siteWebDepthchart';
          debug.endpoints[keyName].groups = Array.isArray(groups) ? groups.length : 0;
          if (Array.isArray(groups) && groups.length) {
            for (const g of groups) {
              const key = toKey(g?.position?.abbreviation || g?.positionAbbr || g?.abbr || g?.position || g?.name);
              if (!key) continue;
              const names = stableUnique(extractGroupOrdered(g));
              if (names.length) out[key] = names.slice(0, 5);
            }
            debug.endpoints[keyName].extracted = { PG: out.PG.length, SG: out.SG.length, SF: out.SF.length, PF: out.PF.length, C: out.C.length };
            if (Object.values(out).some(v => v.length)) return true;
          }
        }
      }
      return false;
    };

    // JSON endpoints return no depth chart data for some teams - force HTML parsing
    let ok = false;

    // Fallback: HTML (only if JSON provided nothing)
    if (!ok) {
      let depthUrl: string | null = null;
      const links: any[] = Array.isArray(team?.links) ? team.links : [];
      for (const l of links) if (Array.isArray(l?.rel) && l.rel.includes('depthchart') && l?.href) { depthUrl = l.href; break; }
      if (!depthUrl) depthUrl = `https://www.espn.com/nba/team/depth/_/name/${String(team?.abbreviation || '').toLowerCase()}`;
      const htmlResp = await fetch(depthUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
      debug.endpoints.html = { url: depthUrl, ok: !!(htmlResp && htmlResp.ok) };
      if (htmlResp.ok) {
        const html = await htmlResp.text();
        const compact = html.replace(/\n|\r/g, ' ').replace(/\s+/g, ' ');
        if (DBG) console.log('HTML content length:', html.length);
        if (DBG) console.log('Contains STARTER:', /(STARTER)/i.test(html));
        if (DBG) console.log('Contains positions:', /(\bPG\b|\bSG\b|\bSF\b|\bPF\b|\bC\b)/i.test(html));

        // Try to locate the depth chart table by headers  
        const tableMatches = Array.from(compact.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi));
        let parsed = false;
        
        if (DBG) console.log(`Found ${tableMatches.length} tables for ${team?.abbreviation}`);
        
        // Add detailed debug info
        if (!debug.htmlParsingDetails) debug.htmlParsingDetails = {};
        debug.htmlParsingDetails.tablesFound = tableMatches.length;
        debug.htmlParsingDetails.tableParsingDetails = [];
        
        // Modern ESPN uses different structures - try multiple approaches
        
        // Modern ESPN uses split tables: positions in one table, players in another
        let positionTable = null;
        let playersTable = null;
        
        // Find position table and players table
        for (let tableIndex = 0; tableIndex < tableMatches.length; tableIndex++) {
          const tm = tableMatches[tableIndex];
          const tbl = tm[0];
          
          const hasStarters = /(STARTER|2ND|3RD|4TH|5TH)/i.test(tbl);
          const hasPositions = /(\bPG\b|\bSG\b|\bSF\b|\bPF\b|\bC\b)/i.test(tbl);
          
          if (DBG) console.log(`Table ${tableIndex}: hasStarters=${hasStarters}, hasPositions=${hasPositions}`);
          
          if (hasPositions && !hasStarters) {
            positionTable = { index: tableIndex, content: tbl };
            if (DBG) console.log(`Found position table at index ${tableIndex}`);
          } else if (hasStarters && !hasPositions) {
            playersTable = { index: tableIndex, content: tbl };
            if (DBG) console.log(`Found players table at index ${tableIndex}`);
          }
        }
        
        // Try to parse split tables
        if (positionTable && playersTable) {
          if (DBG) console.log('Using split-table parsing approach');
          
          // Extract positions in order from position table
          const positionRows = Array.from(positionTable.content.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi));
          const positions: Array<'PG'|'SG'|'SF'|'PF'|'C'> = [];
          
          for (const rowMatch of positionRows) {
            const rowHtml = rowMatch[0];
            const cellMatches = Array.from(rowHtml.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi));
            
            for (const cellMatch of cellMatches) {
              const cellText = cellMatch[1].replace(/<[^>]*>/g, '').trim().toUpperCase();
              if (['PG', 'SG', 'SF', 'PF', 'C'].includes(cellText)) {
                positions.push(cellText as any);
                if (DBG) console.log(`Found position: ${cellText} at index ${positions.length - 1}`);
                break;
              }
            }
          }
          
          // Extract player data from players table
          const playerRows = Array.from(playersTable.content.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi));
          if (DBG) console.log(`Players table has ${playerRows.length} rows, positions array has ${positions.length} positions`);
          
          // Map positions to player rows (skip header row)
          let dataRowIndex = 0;
          for (let posIndex = 0; posIndex < positions.length; posIndex++) {
            const position = positions[posIndex];
            
            // Find corresponding data row (skip header rows)
            let foundRow = null;
            for (let rowIndex = dataRowIndex; rowIndex < playerRows.length; rowIndex++) {
              const rowHtml = playerRows[rowIndex][0];
              const isHeaderRow = /<th[^>]*>/i.test(rowHtml);
              
              if (!isHeaderRow) {
                foundRow = rowHtml;
                dataRowIndex = rowIndex + 1;
                break;
              }
            }
            
            if (!foundRow) {
            if (DBG) console.log(`No data row found for position ${position}`);
              continue;
            }
            
            if (DBG) console.log(`Processing position ${position} with row: ${foundRow.substring(0, 100)}`);
            
            // Extract players from this row
            const cellMatches = Array.from(foundRow.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi));
            const players: string[] = [];
            
            for (const cellMatch of cellMatches) {
              const cellContent = cellMatch[1];
              
              // Extract player name using multiple methods
              let playerName: string | null = null;
              
              // Method 1: Player link
              const playerLink = cellContent.match(/<a[^>]*href="[^"]*\/player\/[^"]*"[^>]*>([^<]+)<\/a>/i);
              if (playerLink) {
                playerName = playerLink[1].trim();
              } else {
                // Method 2: Any link
                const anyLink = cellContent.match(/<a[^>]*>([^<]+)<\/a>/i);
                if (anyLink) {
                  playerName = anyLink[1].trim();
                } else {
                  // Method 3: Plain text (strip headers)
                  let plainText = cellContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                  plainText = plainText.replace(/\b(STARTER|2ND|3RD|4TH|5TH)\b/gi, ' ').replace(/\s+/g, ' ').trim();
                  plainText = plainText.replace(/^[-,\s]+|[-,\s]+$/g, '');
                  if (plainText && plainText !== '-' && plainText.length > 1 && !/^\d+$/.test(plainText)) {
                    playerName = plainText;
                  }
                }
              }
              
              if (playerName && playerName.length > 1 && !playerName.match(/^\d+$/)) {
                players.push(playerName);
                if (DBG) console.log(`  Added player to ${position}: ${playerName}`);
              }
            }
            
            if (players.length > 0) {
              out[position] = stableUnique(players);
              parsed = true;
              if (DBG) console.log(`Position ${position}: Final players = [${players.join(', ')}]`);
            }
          }
        }
        
        // Fallback to original single-table approach if split tables not found
        if (!parsed) {
          if (DBG) console.log('Split-table parsing failed, trying single-table approach');
          for (let tableIndex = 0; tableIndex < tableMatches.length; tableIndex++) {
            const tm = tableMatches[tableIndex];
            const tbl = tm[0];
            
            const hasStarters = /(STARTER|2ND|3RD|4TH|5TH)/i.test(tbl);
            const hasPositions = /(\bPG\b|\bSG\b|\bSF\b|\bPF\b|\bC\b)/i.test(tbl);
            
            // Must have both positions and player data in single table
            if (!hasPositions || !hasStarters) {
              continue;
            }
          
            if (DBG) console.log(`Single-table approach for table ${tableIndex}`);
            
            // Extract all table rows
            const rowMatches = Array.from(tbl.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi));
            
            for (const rowMatch of rowMatches) {
              const rowHtml = rowMatch[0];
              
              // Extract all cells from this row
              const cellMatches = Array.from(rowHtml.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi));
              if (cellMatches.length === 0) continue;
              
              // Check if first cell contains a position
              const firstCellContent = cellMatches[0][1];
              const firstCellText = firstCellContent.replace(/<[^>]*>/g, '').trim().toUpperCase();
              
              // Map position text to position key
              let position: 'PG'|'SG'|'SF'|'PF'|'C'|null = null;
              if (firstCellText === 'PG') position = 'PG';
              else if (firstCellText === 'SG') position = 'SG';
              else if (firstCellText === 'SF') position = 'SF';
              else if (firstCellText === 'PF') position = 'PF';
              else if (firstCellText === 'C') position = 'C';
              
              if (!position) continue;
              
              // Extract players from remaining cells (skip position cell)
              const playerCells = cellMatches.slice(1);
              const players: string[] = [];
              
              for (const cellMatch of playerCells) {
                const cellContent = cellMatch[1];
                
                // Extract player name using multiple methods
                let playerName: string | null = null;
                
                // Method 1: Player link
                const playerLink = cellContent.match(/<a[^>]*href="[^"]*\/player\/[^"]*"[^>]*>([^<]+)<\/a>/i);
                if (playerLink) {
                  playerName = playerLink[1].trim();
                } else {
                  // Method 2: Any link
                  const anyLink = cellContent.match(/<a[^>]*>([^<]+)<\/a>/i);
                  if (anyLink) {
                    playerName = anyLink[1].trim();
                  } else {
                    // Method 3: Plain text
                    let plainText = cellContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                    plainText = plainText.replace(/\b(STARTER|2ND|3RD|4TH|5TH)\b/gi, ' ').replace(/\s+/g, ' ').trim();
                    plainText = plainText.replace(/^[-,\s]+|[-,\s]+$/g, '');
                    if (plainText && plainText !== '-' && plainText.length > 1 && !/^\d+$/.test(plainText)) {
                      playerName = plainText;
                    }
                  }
                }
                
                // Add valid player names
                if (playerName && playerName.length > 1 && !playerName.match(/^\d+$/)) {
                  players.push(playerName);
                }
              }
              
              // Store players for this position
              if (players.length > 0) {
                out[position] = stableUnique(players);
                parsed = true;
              }
            }
            
            if (parsed) break;
          }
        }

        // If table heuristic failed, try position-by-position scan across the whole document
        if (!parsed) {
          console.log('Table parsing failed, trying fallback position-by-position parsing...');
          debug.htmlParsingDetails.fallbackMethod = 'position-by-position';
          
          for (const k of KEYS) {
            const posAlt = k === 'PG' ? 'Point Guard' : k === 'SG' ? 'Shooting Guard' : k === 'SF' ? 'Small Forward' : k === 'PF' ? 'Power Forward' : 'Center';
            const rowRe = new RegExp(`(<tr[^>]*>[\n\r\t\s\S]*?(?:${k}|${posAlt})[\n\r\t\s\S]*?<\/tr>)`, 'i');
            const m = compact.match(rowRe);
            if (DBG) console.log(`Fallback - Position ${k}: Found row = ${!!m}`);
            if (!m) continue;
            
            const rowHtml = m[1];
            const cells = Array.from(rowHtml.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)).map(x => x[1]);
            if (DBG) console.log(`Fallback - Position ${k}: Found ${cells.length} cells`);
            
            const names: string[] = [];
            for (let i = 1; i < cells.length; i++) {
              const cell = cells[i];
              if (DBG) console.log(`  Fallback - Position ${k} Cell ${i}: ${cell.substring(0, 150)}`);
              
              const mm = cell.match(/<a\b[^>]*>([^<]+)<\/a>/i);
              const nm = (mm?.[1] || '').trim();
              if (nm) {
                if (DBG) console.log(`    Fallback - Found player: ${nm}`);
                names.push(nm);
              } else {
                // Try plain text for fallback too
                let plainText = cell.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                plainText = plainText.replace(/\b(STARTER|2ND|3RD|4TH|5TH)\b/gi, ' ').replace(/\s+/g, ' ').trim();
                plainText = plainText.replace(/^[-,\s]+|[-,\s]+$/g, '');
                if (plainText && plainText !== '-' && plainText.length > 1 && !/^\d+$/.test(plainText)) {
                  if (DBG) console.log(`    Fallback - Found player via plain text: ${plainText}`);
                  names.push(plainText);
                }
              }
            }
            
            const ordered = stableUnique(names);
            if (DBG) console.log(`Fallback - Position ${k}: Final players = [${ordered.join(', ')}]`);
            if (ordered.length) out[k] = ordered.slice(0, 5);
          }
        }

        // Method 2: Try modern ESPN structure (div-based or React components)
        if (!parsed) {
          if (DBG) console.log('Table parsing failed, trying modern ESPN structure...');
          
          // Look for position headers followed by player names
          for (const k of KEYS) {
            const positionRegex = new RegExp(`[^a-z]${k}[^a-z]`, 'ig');
            let match;
            while ((match = positionRegex.exec(compact)) !== null) {
              const startPos = match.index || 0;
              const section = compact.substring(startPos, startPos + 1000);
              
              // Look for player names in nearby content
              const playerLinkRegex = /<a[^>]*player[^>]*>([^<]+)<\/a>/gi;
              const playerNames: string[] = [];
              let playerMatch;
              while ((playerMatch = playerLinkRegex.exec(section)) !== null) {
                const name = playerMatch[1].trim();
                if (name.length > 2) playerNames.push(name);
              }
              
              if (playerNames.length > 0) {
                if (DBG) console.log(`Found ${playerNames.length} players for ${k}:`, playerNames);
                out[k] = stableUnique([...out[k], ...playerNames]);
                parsed = true;
              }
            }
          }
        }
        
        // Method 3: Look for any player links and try to infer positions
        if (!parsed) {
          console.log('Modern structure parsing failed, trying player link extraction...');
          const playerLinkRegex = /<a[^>]*href="[^"]*player[^"]*"[^>]*>([^<]+)<\/a>/gi;
          const playerNames: string[] = [];
          let playerMatch;
          while ((playerMatch = playerLinkRegex.exec(compact)) !== null) {
            const name = playerMatch[1].trim();
            if (name.length > 2 && name !== 'Player') {
              playerNames.push(name);
            }
          }
          
          if (playerNames.length > 0) {
            if (DBG) console.log('Found player links:', playerNames.slice(0, 10));
            // Distribute players across positions (basic fallback)
            const perPosition = Math.ceil(playerNames.length / 5);
            KEYS.forEach((k, i) => {
              const start = i * perPosition;
              const end = start + perPosition;
              out[k] = playerNames.slice(start, end);
            });
            parsed = true;
          }
        }

        debug.endpoints.html.extracted = { PG: out.PG.length, SG: out.SG.length, SF: out.SF.length, PF: out.PF.length, C: out.C.length };
        ok = Object.values(out).some(v => v.length);
      }
    }

    // Skip roster contamination - only use pure depth chart data
    const byPos: Record<'PG'|'SG'|'SF'|'PF'|'C', string[]> = { PG: [], SG: [], SF: [], PF: [], C: [] };

    // Use only the scraped depth chart data - no filtering or fallbacks
    for (const k of KEYS) {
      out[k] = stableUnique(out[k]).slice(0, 5);
    }

    // Redistribute bench players to avoid duplicate positions (unless more than 4 bench players)
    // Keep starters (first player at each position) fixed, redistribute bench players
    const redistributeBenchPlayers = (positions: Record<'PG'|'SG'|'SF'|'PF'|'C', string[]>) => {
      const result: Record<'PG'|'SG'|'SF'|'PF'|'C', string[]> = {
        PG: [],
        SG: [],
        SF: [],
        PF: [],
        C: []
      };
      
      // Extract starters (first player at each position)
      const starters: Record<'PG'|'SG'|'SF'|'PF'|'C', string> = {
        PG: positions.PG[0] || '',
        SG: positions.SG[0] || '',
        SF: positions.SF[0] || '',
        PF: positions.PF[0] || '',
        C: positions.C[0] || ''
      };
      
      // Collect all bench players (positions 2+)
      const benchPlayers: Array<{ name: string; originalPos: 'PG'|'SG'|'SF'|'PF'|'C'; depth: number }> = [];
      for (const k of KEYS) {
        for (let i = 1; i < positions[k].length; i++) {
          benchPlayers.push({
            name: positions[k][i],
            originalPos: k,
            depth: i
          });
        }
      }
      
      // Count total bench players
      const totalBench = benchPlayers.length;
      
      // If 4 or fewer bench players, ensure no duplicate positions
      // If more than 4, allow duplicates (realistic scenario)
      if (totalBench <= 4) {
        // Redistribute bench players to fill positions without duplicates
        const positionCounts: Record<'PG'|'SG'|'SF'|'PF'|'C', number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
        const assigned: Record<'PG'|'SG'|'SF'|'PF'|'C', string[]> = { PG: [], SG: [], SF: [], PF: [], C: [] };
        
        // Position priority for redistribution (guards can play either guard position, forwards can play either forward position)
        const getAlternatePositions = (pos: 'PG'|'SG'|'SF'|'PF'|'C'): Array<'PG'|'SG'|'SF'|'PF'|'C'> => {
          if (pos === 'PG') return ['SG', 'SF'];
          if (pos === 'SG') return ['PG', 'SF'];
          if (pos === 'SF') return ['SG', 'PF'];
          if (pos === 'PF') return ['SF', 'C'];
          if (pos === 'C') return ['PF', 'SF'];
          return [];
        };
        
        // Sort bench players by depth (prioritize original position order)
        benchPlayers.sort((a, b) => {
          if (a.originalPos !== b.originalPos) {
            const posOrder = ['PG', 'SG', 'SF', 'PF', 'C'];
            return posOrder.indexOf(a.originalPos) - posOrder.indexOf(b.originalPos);
          }
          return a.depth - b.depth;
        });
        
        // Assign bench players to positions
        for (const player of benchPlayers) {
          // Try original position first
          if (positionCounts[player.originalPos] === 0) {
            assigned[player.originalPos].push(player.name);
            positionCounts[player.originalPos] = 1;
          } else {
            // Try alternate positions
            const alternates = getAlternatePositions(player.originalPos);
            let assignedTo = null;
            
            for (const altPos of alternates) {
              if (positionCounts[altPos] === 0) {
                assigned[altPos].push(player.name);
                positionCounts[altPos] = 1;
                assignedTo = altPos;
                break;
              }
            }
            
            // If no alternate available, assign to original position (duplicate allowed if > 4 bench)
            if (!assignedTo) {
              assigned[player.originalPos].push(player.name);
              positionCounts[player.originalPos]++;
            }
          }
        }
        
        // Build final result: starters + redistributed bench
        for (const k of KEYS) {
          result[k] = [starters[k]].filter(Boolean);
          result[k].push(...assigned[k]);
        }
      } else {
        // More than 4 bench players - keep original distribution (duplicates allowed)
        for (const k of KEYS) {
          result[k] = positions[k];
        }
      }
      
      return result;
    };
    
    // Redistribute bench players
    const redistributed = redistributeBenchPlayers(out);

    // Build response with jerseys and optional player alignment
    const depthChart = KEYS.reduce((acc, k) => {
      const uniq = Array.from(new Set(redistributed[k] || [])).slice(0, 5);
      acc[k] = uniq.map(name => ({ name, jersey: findJersey(name) }));
      return acc;
    }, {} as Record<'PG'|'SG'|'SF'|'PF'|'C', { name: string; jersey: string }[]>);

    let highlight: { position: string; index: number } | null = null;
    if (playerName) {
      const target = norm(playerName);
      for (const k of KEYS) {
        const idx = depthChart[k].findIndex(p => norm(p.name) === target);
        if (idx >= 0) { highlight = { position: k, index: idx }; break; }
      }
    }

    // Add basic debug info
    debug.finalExtracted = { PG: out.PG.length, SG: out.SG.length, SF: out.SF.length, PF: out.PF.length, C: out.C.length };
    
    const newHash = JSON.stringify(depthChart);
    let changed = true;
    try {
      const prev = cache.get<any>(cacheKey);
      const prevHash = prev?.__hash;
      if (prevHash && prevHash === newHash) changed = false;
    } catch {}

    const payload = { success: ok, team: team?.abbreviation, depthChart, highlight, debug, changed, __hash: newHash };
    cache.set(cacheKey, payload, CACHE_TTL.DEPTH_CHART);
    return NextResponse.json(payload, { status: ok ? 200 : 206 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}
