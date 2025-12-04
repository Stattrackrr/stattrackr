require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');

/**
 * Redistribute bench player positions across all games in DvP store
 * Applies the same logic as ingest-nba but only to existing data
 */

const SEASON = '2025';

function normName(name) {
  return String(name || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
}

function parseMinToSeconds(min) {
  const s = String(min || '').trim();
  if (!s) return 0;
  const m = s.split(':');
  if (m.length < 2) return Number(s) || 0;
  const mm = Number(m[0]) || 0;
  const ss = Number(m[1]) || 0;
  return mm * 60 + ss;
}

/**
 * Check if a player can play a target position based on their current position
 * Uses position compatibility rules:
 * - Guards (PG/SG) can play other guard positions
 * - Forwards (SF/PF) can play other forward positions
 * - Centers can play PF
 * - PF can play C
 * - SF can play PF
 * - SG can play SF
 * - PG can play SG
 */
function canPlayPosition(currentPos, targetPos) {
  if (!currentPos || !targetPos) return false;
  if (currentPos === targetPos) return true;
  
  const guards = ['PG', 'SG'];
  const forwards = ['SF', 'PF'];
  
  // Guards can play other guard positions
  if (guards.includes(currentPos) && guards.includes(targetPos)) {
    return true;
  }
  
  // Forwards can play other forward positions
  if (forwards.includes(currentPos) && forwards.includes(targetPos)) {
    return true;
  }
  
  // Centers can play PF (power forward)
  if (currentPos === 'C' && targetPos === 'PF') {
    return true;
  }
  
  // PF can play C (power forwards can play center)
  if (currentPos === 'PF' && targetPos === 'C') {
    return true;
  }
  
  // SF can play PF (small forwards can play power forward)
  if (currentPos === 'SF' && targetPos === 'PF') {
    return true;
  }
  
  // SG can play SF (shooting guards can play small forward)
  if (currentPos === 'SG' && targetPos === 'SF') {
    return true;
  }
  
  // PG can play SG (point guards can play shooting guard)
  if (currentPos === 'PG' && targetPos === 'SG') {
    return true;
  }
  
  return false;
}

// Helper to check if position is guard or forward
function isGuard(pos) {
  return pos === 'PG' || pos === 'SG';
}

function isForward(pos) {
  return pos === 'SF' || pos === 'PF';
}

function redistributeBenchPositions(players) {
  // Create deep copies to avoid mutating original
  const benchPlayers = players.filter(p => !p.isStarter).map(p => ({ ...p }));
  const starterPlayers = players.filter(p => p.isStarter).map(p => ({ ...p }));
  
  if (benchPlayers.length <= 3) {
    return players; // No redistribution needed for 3 or fewer bench players
  }
  
  // Count positions for bench players
  const posCount = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
  benchPlayers.forEach(p => {
    if (p.bucket && ['PG','SG','SF','PF','C'].includes(p.bucket)) {
      posCount[p.bucket]++;
    }
  });
  
  // Maximum allowed per position based on bench size
  // 4-5 bench: max 1 per position
  // 6-8 bench: max 2 per position
  // 9+ bench: max 3 per position
  const maxPerPosition = benchPlayers.length <= 5 ? 1 : (benchPlayers.length <= 8 ? 2 : 3);
  const maxCenter = Infinity;
  
  // Guard/forward balance for normal games (4-5 bench)
  if (benchPlayers.length <= 5) {
    // Ensure guards are balanced: prefer 1 PG, 1 SG
    const totalGuards = posCount.PG + posCount.SG;
    if (totalGuards > 2) {
      if (posCount.PG > 1 && posCount.SG < 1) {
        // Too many PGs, move one to SG
        const pgPlayers = benchPlayers.filter(p => p.bucket === 'PG').sort((a, b) => {
          const aMin = parseMinToSeconds(a.min);
          const bMin = parseMinToSeconds(b.min);
          return aMin - bMin;
        });
        if (pgPlayers.length > 0) {
          pgPlayers[0].bucket = 'SG';
          posCount.PG--;
          posCount.SG++;
        }
      } else if (posCount.SG > 1 && posCount.PG < 1) {
        // Too many SGs, move one to PG
        const sgPlayers = benchPlayers.filter(p => p.bucket === 'SG').sort((a, b) => {
          const aMin = parseMinToSeconds(a.min);
          const bMin = parseMinToSeconds(b.min);
          return aMin - bMin;
        });
        if (sgPlayers.length > 0) {
          sgPlayers[0].bucket = 'PG';
          posCount.SG--;
          posCount.PG++;
        }
      }
    }
    
    // Ensure forwards are balanced: prefer 1 SF, 1 PF
    const totalForwards = posCount.SF + posCount.PF;
    if (totalForwards > 2) {
      // If one forward position has all players and the other has none, redistribute
      if (posCount.SF > 1 && posCount.PF === 0) {
        // Too many SFs, move some to PF (at least 1, but try to balance)
        const sfPlayers = benchPlayers.filter(p => p.bucket === 'SF').sort((a, b) => {
          const aMin = parseMinToSeconds(a.min);
          const bMin = parseMinToSeconds(b.min);
          return aMin - bMin;
        });
        // Move at least 1, but try to balance if possible
        const toMove = Math.max(1, Math.floor(posCount.SF / 2));
        for (let i = 0; i < Math.min(toMove, sfPlayers.length); i++) {
          sfPlayers[i].bucket = 'PF';
          posCount.SF--;
          posCount.PF++;
        }
      } else if (posCount.PF > 1 && posCount.SF === 0) {
        // Too many PFs, move some to SF (at least 1, but try to balance)
        const pfPlayers = benchPlayers.filter(p => p.bucket === 'PF').sort((a, b) => {
          const aMin = parseMinToSeconds(a.min);
          const bMin = parseMinToSeconds(b.min);
          return aMin - bMin;
        });
        // Move at least 1, but try to balance if possible
        const toMove = Math.max(1, Math.floor(posCount.PF / 2));
        for (let i = 0; i < Math.min(toMove, pfPlayers.length); i++) {
          pfPlayers[i].bucket = 'SF';
          posCount.PF--;
          posCount.SF++;
        }
      } else if (posCount.SF > 1 && posCount.PF < 1) {
        // Too many SFs, move one to PF
        const sfPlayers = benchPlayers.filter(p => p.bucket === 'SF').sort((a, b) => {
          const aMin = parseMinToSeconds(a.min);
          const bMin = parseMinToSeconds(b.min);
          return aMin - bMin;
        });
        if (sfPlayers.length > 0) {
          sfPlayers[0].bucket = 'PF';
          posCount.SF--;
          posCount.PF++;
        }
      } else if (posCount.PF > 1 && posCount.SF < 1) {
        // Too many PFs, move one to SF
        const pfPlayers = benchPlayers.filter(p => p.bucket === 'PF').sort((a, b) => {
          const aMin = parseMinToSeconds(a.min);
          const bMin = parseMinToSeconds(b.min);
          return aMin - bMin;
        });
        if (pfPlayers.length > 0) {
          pfPlayers[0].bucket = 'SF';
          posCount.PF--;
          posCount.SF++;
        }
      }
    }
    
    // Recalculate position counts after balance
    posCount.PG = benchPlayers.filter(p => p.bucket === 'PG').length;
    posCount.SG = benchPlayers.filter(p => p.bucket === 'SG').length;
    posCount.SF = benchPlayers.filter(p => p.bucket === 'SF').length;
    posCount.PF = benchPlayers.filter(p => p.bucket === 'PF').length;
    posCount.C = benchPlayers.filter(p => p.bucket === 'C').length;
  }
  
  // Additional forward balance check for blowouts (6+ bench) - ensure both SF and PF have players
  // But only if one position has 0 and the other has 3+ (to avoid over-correcting)
  if (benchPlayers.length >= 6) {
    const totalForwards = posCount.SF + posCount.PF;
    if (totalForwards >= 2) {
      // If one forward position has all players and the other has none, redistribute
      if (posCount.SF === 0 && posCount.PF >= 3) {
        // Move at least 1 PF to SF, but try to balance (move up to half)
        const pfPlayers = benchPlayers.filter(p => p.bucket === 'PF').sort((a, b) => {
          const aMin = parseMinToSeconds(a.min);
          const bMin = parseMinToSeconds(b.min);
          return aMin - bMin;
        });
        const toMove = Math.max(1, Math.min(Math.floor(posCount.PF / 2), Math.floor(totalForwards / 2)));
        for (let i = 0; i < Math.min(toMove, pfPlayers.length); i++) {
          pfPlayers[i].bucket = 'SF';
          posCount.PF--;
          posCount.SF++;
        }
      } else if (posCount.PF === 0 && posCount.SF >= 3) {
        // Move at least 1 SF to PF, but try to balance (move up to half)
        const sfPlayers = benchPlayers.filter(p => p.bucket === 'SF').sort((a, b) => {
          const aMin = parseMinToSeconds(a.min);
          const bMin = parseMinToSeconds(b.min);
          return aMin - bMin;
        });
        const toMove = Math.max(1, Math.min(Math.floor(posCount.SF / 2), Math.floor(totalForwards / 2)));
        for (let i = 0; i < Math.min(toMove, sfPlayers.length); i++) {
          sfPlayers[i].bucket = 'PF';
          posCount.SF--;
          posCount.PF++;
        }
      }
    }
    
    // Recalculate position counts after additional balance
    posCount.PG = benchPlayers.filter(p => p.bucket === 'PG').length;
    posCount.SG = benchPlayers.filter(p => p.bucket === 'SG').length;
    posCount.SF = benchPlayers.filter(p => p.bucket === 'SF').length;
    posCount.PF = benchPlayers.filter(p => p.bucket === 'PF').length;
    posCount.C = benchPlayers.filter(p => p.bucket === 'C').length;
  }
  
  // Pre-redistribution: Aggressively balance forwards and guards for extreme imbalances
  // This runs before the main redistribution loop to handle cases like SF:7, PF:1
  if (benchPlayers.length >= 6) {
    const totalForwards = posCount.SF + posCount.PF;
    const totalGuards = posCount.PG + posCount.SG;
    
    // Balance forwards: if one has 2+ more than the other, move players
    if (totalForwards >= 4) {
      const forwardDiff = Math.abs(posCount.SF - posCount.PF);
      if (forwardDiff >= 2) {
        if (posCount.SF > posCount.PF + 1) {
          // Too many SFs, move some to PF
          const sfPlayers = benchPlayers.filter(p => p.bucket === 'SF').sort((a, b) => {
            const aMin = parseMinToSeconds(a.min);
            const bMin = parseMinToSeconds(b.min);
            return aMin - bMin;
          });
          // Move enough to balance (aim for roughly equal split)
          const toMove = Math.ceil((posCount.SF - posCount.PF) / 2);
          for (let i = 0; i < Math.min(toMove, sfPlayers.length); i++) {
            sfPlayers[i].bucket = 'PF';
            posCount.SF--;
            posCount.PF++;
          }
        } else if (posCount.PF > posCount.SF + 1) {
          // Too many PFs, move some to SF
          const pfPlayers = benchPlayers.filter(p => p.bucket === 'PF').sort((a, b) => {
            const aMin = parseMinToSeconds(a.min);
            const bMin = parseMinToSeconds(b.min);
            return aMin - bMin;
          });
          // Move enough to balance (aim for roughly equal split)
          const toMove = Math.ceil((posCount.PF - posCount.SF) / 2);
          for (let i = 0; i < Math.min(toMove, pfPlayers.length); i++) {
            pfPlayers[i].bucket = 'SF';
            posCount.PF--;
            posCount.SF++;
          }
        }
      }
    }
    
    // Balance guards: if one has 2+ more than the other, move players
    if (totalGuards >= 4) {
      const guardDiff = Math.abs(posCount.PG - posCount.SG);
      if (guardDiff >= 2) {
        if (posCount.PG > posCount.SG + 1) {
          // Too many PGs, move some to SG
          const pgPlayers = benchPlayers.filter(p => p.bucket === 'PG').sort((a, b) => {
            const aMin = parseMinToSeconds(a.min);
            const bMin = parseMinToSeconds(b.min);
            return aMin - bMin;
          });
          // Move enough to balance (aim for roughly equal split)
          const toMove = Math.ceil((posCount.PG - posCount.SG) / 2);
          for (let i = 0; i < Math.min(toMove, pgPlayers.length); i++) {
            pgPlayers[i].bucket = 'SG';
            posCount.PG--;
            posCount.SG++;
          }
        } else if (posCount.SG > posCount.PG + 1) {
          // Too many SGs, move some to PG
          const sgPlayers = benchPlayers.filter(p => p.bucket === 'SG').sort((a, b) => {
            const aMin = parseMinToSeconds(a.min);
            const bMin = parseMinToSeconds(b.min);
            return aMin - bMin;
          });
          // Move enough to balance (aim for roughly equal split)
          const toMove = Math.ceil((posCount.SG - posCount.PG) / 2);
          for (let i = 0; i < Math.min(toMove, sgPlayers.length); i++) {
            sgPlayers[i].bucket = 'PG';
            posCount.SG--;
            posCount.PG++;
          }
        }
      }
    }
    
    // Recalculate position counts after pre-balancing
    posCount.PG = benchPlayers.filter(p => p.bucket === 'PG').length;
    posCount.SG = benchPlayers.filter(p => p.bucket === 'SG').length;
    posCount.SF = benchPlayers.filter(p => p.bucket === 'SF').length;
    posCount.PF = benchPlayers.filter(p => p.bucket === 'PF').length;
    posCount.C = benchPlayers.filter(p => p.bucket === 'C').length;
  }
  
  // For blowouts (6+ bench), calculate ideal distribution
  // Try to balance: guards (PG+SG) and forwards (SF+PF) should be roughly equal
  // Example: 6 bench = 2 PG, 2 SG, 1 SF, 1 PF
  let idealDistribution = null;
  if (benchPlayers.length >= 6) {
    const totalBench = benchPlayers.length;
    const totalCenters = posCount.C;
    const nonCenterBench = totalBench - totalCenters;
    
    // Calculate ideal: try to balance guards and forwards
    // For 6 bench: 4 guards (2 PG, 2 SG), 2 forwards (1 SF, 1 PF)
    // For 7 bench: 4 guards (2 PG, 2 SG), 3 forwards (2 SF, 1 PF or 1 SF, 2 PF)
    // For 8 bench: 4 guards (2 PG, 2 SG), 4 forwards (2 SF, 2 PF)
    // General rule: aim for roughly equal guards and forwards, but slightly favor guards
    
    const idealGuards = Math.ceil(nonCenterBench * 0.55); // Slightly more guards (55%)
    const idealForwards = nonCenterBench - idealGuards;
    
    // Distribute guards evenly between PG and SG
    const idealPG = Math.ceil(idealGuards / 2);
    const idealSG = Math.floor(idealGuards / 2);
    
    // Distribute forwards evenly between SF and PF
    // Ensure at least 1 at each forward position if we have 2+ forwards
    const idealSF = idealForwards >= 2 ? Math.max(1, Math.ceil(idealForwards / 2)) : idealForwards;
    const idealPF = idealForwards >= 2 ? Math.max(1, Math.floor(idealForwards / 2)) : 0;
    
    idealDistribution = {
      PG: idealPG,
      SG: idealSG,
      SF: idealSF,
      PF: idealPF,
      C: totalCenters // Keep centers as-is
    };
  }
  
  // If we have extreme imbalances (e.g., 9 SF, 0 guards), we need to be more aggressive
  // Check if any position has way too many players that can't be redistributed
  const totalGuards = posCount.PG + posCount.SG;
  const totalForwards = posCount.SF + posCount.PF;
  
  // If forwards are way more than guards (or vice versa), we may need to allow cross-position moves
  // But only as a last resort - prefer position-compatible moves first
  
  // Find over-limit positions
  const overLimit = [];
  const underLimit = [];
  
  (['PG','SG','SF','PF','C']).forEach(pos => {
    const maxAllowed = pos === 'C' ? maxCenter : maxPerPosition;
    const ideal = idealDistribution ? idealDistribution[pos] : null;
    
    // For blowouts, use ideal distribution as target
    const target = ideal !== null ? ideal : maxAllowed;
    
    if (posCount[pos] > target) {
      overLimit.push({ 
        pos, 
        count: posCount[pos], 
        target: target,
        players: benchPlayers.filter(p => p.bucket === pos) 
      });
    } else if (posCount[pos] < target && pos !== 'C') {
      underLimit.push(pos);
    }
  });
  
  // Redistribute players from over-limit positions
  // Keep redistributing until all positions are within limits
  let iterations = 0;
  const maxIterations = 30; // Increased limit for more aggressive redistribution
  
  while (iterations < maxIterations) {
    iterations++;
    
    // Recalculate position counts
    posCount.PG = benchPlayers.filter(p => p.bucket === 'PG').length;
    posCount.SG = benchPlayers.filter(p => p.bucket === 'SG').length;
    posCount.SF = benchPlayers.filter(p => p.bucket === 'SF').length;
    posCount.PF = benchPlayers.filter(p => p.bucket === 'PF').length;
    posCount.C = benchPlayers.filter(p => p.bucket === 'C').length;
    
    // Recalculate overLimit and underLimit based on current counts
    const currentOverLimit = [];
    const currentUnderLimit = [];
    
    (['PG','SG','SF','PF','C']).forEach(pos => {
      const maxAllowed = pos === 'C' ? maxCenter : maxPerPosition;
      const ideal = idealDistribution ? idealDistribution[pos] : null;
      const target = ideal !== null ? ideal : maxAllowed;
      
      if (posCount[pos] > target) {
        currentOverLimit.push({ 
          pos, 
          count: posCount[pos], 
          target: target,
          excess: posCount[pos] - target
        });
      } else if (posCount[pos] < target && pos !== 'C') {
        currentUnderLimit.push({ pos, target, current: posCount[pos] });
      }
    });
    
    // If no over-limit positions, we're done
    if (currentOverLimit.length === 0) break;
    
    // Sort by excess (most excess first)
    currentOverLimit.sort((a, b) => b.excess - a.excess);
    
    // If no under-limit positions, we need to redistribute to any position that's not over limit
    // For aggressive redistribution, also consider positions that are at limit but not over
    // When source is over limit, allow moving to positions at limit if they have fewer players
    const availablePositions = currentUnderLimit.length > 0 
      ? currentUnderLimit.map(u => u.pos)
      : (['PG','SG','SF','PF','C']).filter(pos => {
          const maxAllowed = pos === 'C' ? maxCenter : maxPerPosition;
          const ideal = idealDistribution ? idealDistribution[pos] : null;
          const target = ideal !== null ? ideal : maxAllowed;
          const targetCount = posCount[pos] || 0;
          
          // Allow if at or below target
          if (targetCount <= target) return true;
          
          // For aggressive redistribution: if source is over limit, allow target even if at limit
          // if target has fewer players than source (helps with cases like PG:4, SG:3)
          if (currentOverLimit.length > 0) {
            const sourcePos = currentOverLimit[0].pos;
            const sourceCount = posCount[sourcePos] || 0;
            // Allow if target is at limit but has fewer players than source
            if (targetCount === target && targetCount < sourceCount) return true;
            // Allow if target is slightly over (target + 1) but still has fewer players than source
            if (targetCount <= target + 1 && targetCount < sourceCount - 1) return true;
          }
          
          return false;
        });
    
    let changedThisIteration = false;
    
    for (const { pos, excess, target: targetCount } of currentOverLimit) {
      if (excess <= 0) continue;
      
      // For very aggressive redistribution, move enough players to get close to target
      // If we have SF:7 and target is 3, we need to move at least 4 players
      // But also consider balancing - if SF:7, PF:1, we should move more to balance forwards
      const currentCount = posCount[pos];
      let playersToMove = excess;
      
      // Special handling for forward balance: if one forward has way more than the other, move more
      if ((pos === 'SF' || pos === 'PF') && benchPlayers.length >= 6) {
        const otherForward = pos === 'SF' ? 'PF' : 'SF';
        const otherCount = posCount[otherForward] || 0;
        const totalForwards = currentCount + otherCount;
        
        // If imbalance is severe (e.g., SF:7, PF:1), move enough to balance
        if (currentCount > otherCount + 2 && totalForwards >= 4) {
          // Move enough to get closer to balance (aim for roughly equal split)
          const idealForThisPos = Math.ceil(totalForwards / 2);
          playersToMove = Math.max(excess, currentCount - idealForThisPos);
        }
      }
      
      // Special handling for guard balance: if one guard has way more than the other, move more
      if ((pos === 'PG' || pos === 'SG') && benchPlayers.length >= 6) {
        const otherGuard = pos === 'PG' ? 'SG' : 'PG';
        const otherCount = posCount[otherGuard] || 0;
        const totalGuards = currentCount + otherCount;
        
        // If imbalance is severe (e.g., PG:5, SG:3), move enough to balance
        if (currentCount > otherCount + 1 && totalGuards >= 4) {
          // Move enough to get closer to balance (aim for roughly equal split)
          const idealForThisPos = Math.ceil(totalGuards / 2);
          playersToMove = Math.max(excess, currentCount - idealForThisPos);
        }
      }
      
      // For very aggressive redistribution, redistribute enough players to get close to target
      const toRedistribute = benchPlayers
        .filter(p => p.bucket === pos) // Make sure we only get players still at this position
        .sort((a, b) => {
          const aMin = parseMinToSeconds(a.min);
          const bMin = parseMinToSeconds(b.min);
          return aMin - bMin;
        })
        .slice(0, Math.max(excess, playersToMove)); // Move at least the excess, but more if needed for balance
      
      for (const player of toRedistribute) {
        const currentPos = player.bucket;
        let newPos = null;
        
        // ULTRA AGGRESSIVE: If current position is over limit, move to ANY compatible position with fewer players
        // This handles cases like PG:4, SG:3 where SG is at limit but has fewer players
        const currentPosCount = posCount[currentPos] || 0;
        const allCompatible = (['PG','SG','SF','PF','C']).filter(targetPos => 
          canPlayPosition(currentPos, targetPos) && targetPos !== currentPos
        );
        
        // Find all compatible positions that have fewer OR EQUAL players than current
        // Allow equal if current is over limit - this helps balance (e.g., PG:4 -> SG:3, then SG:4 -> PG:3)
        const maxAllowed = currentPos === 'C' ? maxCenter : maxPerPosition;
        const ideal = idealDistribution ? idealDistribution[currentPos] : null;
        const currentTarget = ideal !== null ? ideal : maxAllowed;
        const isCurrentOverLimit = currentPosCount > currentTarget;
        
        const betterPositions = allCompatible.filter(targetPos => {
          const targetCount = posCount[targetPos] || 0;
          const targetMaxAllowed = targetPos === 'C' ? maxCenter : maxPerPosition;
          const targetIdeal = idealDistribution ? idealDistribution[targetPos] : null;
          const targetTarget = targetIdeal !== null ? targetIdeal : targetMaxAllowed;
          const isTargetAtOrUnderLimit = targetCount <= targetTarget;
          
          // If current is over limit, allow moving to positions with fewer OR EQUAL players
          // as long as target is at or under limit (helps with ping-pong balancing)
          if (isCurrentOverLimit) {
            return targetCount <= currentPosCount && isTargetAtOrUnderLimit;
          }
          
          // Otherwise, only allow moving to positions with fewer players
          return targetCount < currentPosCount;
        });
        
        if (betterPositions.length > 0) {
          // Prefer positions that are under limit, then at limit, then slightly over
          betterPositions.sort((a, b) => {
            const maxAllowedA = a === 'C' ? maxCenter : maxPerPosition;
            const idealA = idealDistribution ? idealDistribution[a] : null;
            const targetA = idealA !== null ? idealA : maxAllowedA;
            const countA = posCount[a] || 0;
            const overA = countA > targetA ? 1 : 0;
            
            const maxAllowedB = b === 'C' ? maxCenter : maxPerPosition;
            const idealB = idealDistribution ? idealDistribution[b] : null;
            const targetB = idealB !== null ? idealB : maxAllowedB;
            const countB = posCount[b] || 0;
            const overB = countB > targetB ? 1 : 0;
            
            // Prefer positions under limit, then by count (fewer is better)
            if (overA !== overB) return overA - overB;
            return countA - countB;
          });
          
          // Prefer adjacent positions if available
          const adjacent = {
            PG: ['SG', 'SF'],
            SG: ['PG', 'SF'],
            SF: ['SG', 'PF'],
            PF: ['SF', 'C'],
            C: ['PF', 'SF']
          };
          
          for (const adjPos of adjacent[currentPos] || []) {
            if (betterPositions.includes(adjPos)) {
              newPos = adjPos;
              break;
            }
          }
          
          if (!newPos) {
            newPos = betterPositions[0];
          }
        }
        
        // Last resort: if we have extreme imbalance and no compatible positions,
        // allow cross-position moves for forwards/guards (but only if really needed)
        if (!newPos && benchPlayers.length >= 6) {
          const totalGuards = posCount.PG + posCount.SG;
          const totalForwards = posCount.SF + posCount.PF;
          const imbalance = Math.abs(totalGuards - totalForwards);
          
          // If imbalance is severe (e.g., 9 forwards vs 0 guards), allow cross-position
          // Also allow if current position has way too many players (e.g., 4+ at one position when max is 3)
          const currentPosCount = posCount[currentPos] || 0;
          // Trigger if: imbalance > 3, or position has 4+ players (when max is 2-3), or position has 2+ more than max
          const needsRedistribution = imbalance > 3 || currentPosCount >= maxPerPosition + 1 || currentPosCount > 4;
          
          if (needsRedistribution) {
            // Forwards can sometimes play guard in extreme cases (tall guards)
            // Guards can sometimes play forward in extreme cases (small forwards)
            if (isForward(currentPos) && (totalForwards > totalGuards + 2 || currentPosCount >= maxPerPosition + 1)) {
              // Too many forwards, try guard positions (even if at limit)
              const guardOptions = ['PG', 'SG'].filter(targetPos => {
                const maxAllowed = maxPerPosition;
                const ideal = idealDistribution ? idealDistribution[targetPos] : null;
                const target = ideal !== null ? ideal : maxAllowed;
                // Allow if target is at or below limit, or if it's better than current position
                // For very aggressive redistribution, allow even if target is slightly over if it's better
                return posCount[targetPos] <= target || posCount[targetPos] < currentPosCount || 
                       (posCount[targetPos] <= target + 1 && currentPosCount > 4);
              });
              if (guardOptions.length > 0) {
                // Prefer the guard position with fewer players
                guardOptions.sort((a, b) => posCount[a] - posCount[b]);
                newPos = guardOptions[0];
              }
            } else if (isGuard(currentPos) && (totalGuards > totalForwards + 2 || currentPosCount >= maxPerPosition + 1)) {
              // Too many guards, try forward positions (even if at limit)
              const forwardOptions = ['SF', 'PF'].filter(targetPos => {
                const maxAllowed = maxPerPosition;
                const ideal = idealDistribution ? idealDistribution[targetPos] : null;
                const target = ideal !== null ? ideal : maxAllowed;
                // Allow if target is at or below limit, or if it's better than current position
                // For very aggressive redistribution, allow even if target is slightly over if it's better
                return posCount[targetPos] <= target || posCount[targetPos] < currentPosCount ||
                       (posCount[targetPos] <= target + 1 && currentPosCount > 4);
              });
              if (forwardOptions.length > 0) {
                // Prefer the forward position with fewer players
                forwardOptions.sort((a, b) => posCount[a] - posCount[b]);
                newPos = forwardOptions[0];
              }
            }
          }
        }
        
        if (newPos) {
          player.bucket = newPos;
          posCount[currentPos]--;
          posCount[newPos]++;
          changedThisIteration = true;
        }
      }
    }
    
    // If no changes were made this iteration, break to avoid infinite loop
    if (!changedThisIteration) break;
  }
  
  // Return updated players array
  return [...starterPlayers, ...benchPlayers];
}

async function processTeam(team) {
  const filePath = path.join(process.cwd(), 'data', 'dvp_store', SEASON, `${team}.json`);
  
  if (!fs.existsSync(filePath)) {
    return { team, games: 0, updated: 0 };
  }
  
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const games = Array.isArray(data) ? data : [];
  
  let updatedCount = 0;
  let totalBenchPlayers = 0;
  let redistributedCount = 0;
  
  for (const game of games) {
    const players = Array.isArray(game.players) ? game.players : [];
    const benchBefore = players.filter(p => !p.isStarter);
    totalBenchPlayers += benchBefore.length;
    
    if (benchBefore.length > 3) {
      // Store original positions for comparison (by player name)
      const originalPositions = new Map();
      benchBefore.forEach(p => {
        originalPositions.set(p.name, p.bucket);
      });
      
      // Create deep copy of players array to avoid mutating original
      const playersCopy = players.map(p => ({ ...p }));
      
      // Apply redistribution
      const updatedPlayers = redistributeBenchPositions(playersCopy);
      
      // Check if any positions changed
      const benchAfter = updatedPlayers.filter(p => !p.isStarter);
      let changed = false;
      let playersChanged = 0;
      
      for (const after of benchAfter) {
        const originalPos = originalPositions.get(after.name);
        if (originalPos !== undefined && originalPos !== after.bucket) {
          changed = true;
          playersChanged++;
        }
      }
      
      if (changed) {
        game.players = updatedPlayers;
        updatedCount++;
        redistributedCount += playersChanged;
      }
    }
  }
  
  if (updatedCount > 0) {
    // Write updated data back to file
    fs.writeFileSync(filePath, JSON.stringify(games, null, 2));
  }
  
  return { 
    team, 
    games: games.length, 
    updated: updatedCount,
    totalBench: totalBenchPlayers,
    redistributed: redistributedCount
  };
}

async function main() {
  const dvpDir = path.join(process.cwd(), 'data', 'dvp_store', SEASON);
  
  if (!fs.existsSync(dvpDir)) {
    console.log(`❌ DvP store directory not found: ${dvpDir}`);
    process.exit(1);
  }
  
  const teams = fs.readdirSync(dvpDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', '').toUpperCase())
    .sort();
  
  console.log(`\n🔄 Redistributing bench player positions for ${teams.length} teams...\n`);
  
  let totalGames = 0;
  let totalUpdated = 0;
  let totalRedistributed = 0;
  
  for (const team of teams) {
    const result = await processTeam(team);
    totalGames += result.games;
    totalUpdated += result.updated;
    totalRedistributed += result.redistributed;
    
    if (result.updated > 0) {
      console.log(`   ✅ ${team}: ${result.updated}/${result.games} games updated, ${result.redistributed} bench players redistributed`);
    }
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`   - Teams processed: ${teams.length}`);
  console.log(`   - Total games: ${totalGames}`);
  console.log(`   - Games updated: ${totalUpdated}`);
  console.log(`   - Bench players redistributed: ${totalRedistributed}`);
  console.log(`\n✅ Done!\n`);
}

main().catch(console.error);

