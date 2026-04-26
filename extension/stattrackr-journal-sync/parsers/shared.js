(function () {
  const GLOBAL_KEY = '__STATTRACKR_JOURNAL_SYNC__';
  if (globalThis[GLOBAL_KEY]) {
    return;
  }

  const BOOK_LABELS = {
    sportsbet: 'Sportsbet',
    tab: 'TAB',
    neds: 'Neds',
    ladbrokes: 'Ladbrokes',
    bet365_au: 'bet365 AU',
    unknown: 'Unknown',
  };

  const GLOBAL_NOISE_PATTERNS = [
    /for free and confidential support/i,
    /responsible gambling/i,
    /gambling help/i,
    /cash out faqs?/i,
    /my bets faqs?/i,
    /contact us/i,
    /live chat/i,
    /email us/i,
    /call customer service/i,
    /deposit limit/i,
    /sportsbet cash/i,
    /quick links/i,
    /account overview/i,
    /bet slip is empty/i,
    /check today's racing/i,
  ];

  const FIELD_ONLY_PATTERNS = [
    /^(more|less|expand|collapse|pending|resulted|open|closed)$/i,
    /^(stake|outlay|wager|bet amount|odds|price|return|collect|cash out|receipt|ticket|reference)$/i,
  ];

  const TEAM_STAT_MAPPINGS = [
    { pattern: /\bdisposals?\b/i, statType: 'disposals' },
    { pattern: /\bkicks?\b/i, statType: 'kicks' },
    { pattern: /\bhandballs?\b/i, statType: 'handballs' },
    { pattern: /\bmarks?\b/i, statType: 'marks' },
    { pattern: /\bgoals?\b/i, statType: 'goals' },
    { pattern: /\bbehinds?\b/i, statType: 'behinds' },
    { pattern: /\btackles?\b/i, statType: 'tackles' },
    { pattern: /\bclearances?\b/i, statType: 'clearances' },
    { pattern: /\bpoints?\b/i, statType: 'pts' },
    { pattern: /\brebounds?\b/i, statType: 'reb' },
    { pattern: /\bassists?\b/i, statType: 'ast' },
    { pattern: /\bsteals?\b/i, statType: 'stl' },
    { pattern: /\bblocks?\b/i, statType: 'blk' },
    { pattern: /\b3 pointers made\b/i, statType: 'fg3m' },
    { pattern: /\bthree pointers made\b/i, statType: 'fg3m' },
    { pattern: /\btotal points\b/i, statType: 'total_pts' },
    { pattern: /\bspread\b/i, statType: 'spread' },
    { pattern: /\bhandicap\b/i, statType: 'spread' },
    { pattern: /\bhead to head\b/i, statType: 'moneyline' },
    { pattern: /\bmoneyline\b/i, statType: 'moneyline' },
    { pattern: /\bto win\b/i, statType: 'moneyline' },
  ];

  const parserRegistry = {};

  function normalizeText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function uniqueStrings(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function uniqueElements(elements) {
    const seen = new Set();
    return elements.filter((element) => {
      if (!element || seen.has(element)) return false;
      seen.add(element);
      return true;
    });
  }

  function getBookKey() {
    const host = window.location.hostname.toLowerCase();
    if (host.includes('sportsbet')) return 'sportsbet';
    if (host.includes('tab')) return 'tab';
    if (host.includes('neds')) return 'neds';
    if (host.includes('ladbrokes')) return 'ladbrokes';
    if (host.includes('bet365')) return 'bet365_au';
    return 'unknown';
  }

  function getBookLabel(bookKey) {
    return BOOK_LABELS[bookKey] || BOOK_LABELS.unknown;
  }

  function isVisibleElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (element.getClientRects().length === 0) return false;
    return true;
  }

  function getElementText(element) {
    return normalizeText(element?.innerText || element?.textContent || '');
  }

  function getElementLines(element) {
    return uniqueStrings(
      String(element?.innerText || element?.textContent || '')
        .split('\n')
        .map((line) => normalizeText(line))
        .filter((line) => line.length >= 2 && line.length <= 180)
    );
  }

  function parseAmount(raw) {
    if (!raw) return null;
    const cleaned = String(raw).replace(/[^0-9.,-]/g, '').replace(/,/g, '');
    const value = Number(cleaned);
    return Number.isFinite(value) ? value : null;
  }

  function parseOdds(raw) {
    if (!raw) return null;
    const text = normalizeText(raw);
    if (!text) return null;

    const fractionMatch = text.match(/(\d+)\s*\/\s*(\d+)/);
    if (fractionMatch) {
      const numerator = Number(fractionMatch[1]);
      const denominator = Number(fractionMatch[2]);
      if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
        return Number((1 + numerator / denominator).toFixed(3));
      }
    }

    const americanMatch = text.match(/([+-]\d{3,})/);
    if (americanMatch) {
      const american = Number(americanMatch[1]);
      if (american > 0) {
        return Number((1 + american / 100).toFixed(3));
      }
      if (american < 0) {
        return Number((1 + 100 / Math.abs(american)).toFixed(3));
      }
    }

    const decimalMatch = text.match(/(\d+(?:\.\d+)?)/);
    if (!decimalMatch) return null;
    const decimal = Number(decimalMatch[1]);
    return Number.isFinite(decimal) && decimal > 1 ? decimal : null;
  }

  function parseDateString(raw) {
    const text = normalizeText(raw);
    if (!text) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return text;
    }

    const slashMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (slashMatch) {
      const day = Number(slashMatch[1]);
      const month = Number(slashMatch[2]);
      const rawYear = Number(slashMatch[3]);
      const year = rawYear < 100 ? 2000 + rawYear : rawYear;
      const parsed = new Date(Date.UTC(year, month - 1, day));
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    }

    const textMatch = text.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})/);
    if (textMatch) {
      const parsed = new Date(`${textMatch[1]} ${textMatch[2]} ${textMatch[3]}`);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    }

    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toISOString().slice(0, 10);
  }

  function extractFieldLine(lines, patterns) {
    const combinedPatterns = patterns || [];
    return lines.find((line) => combinedPatterns.some((pattern) => pattern.test(line))) || null;
  }

  function extractStake(lines, text) {
    const line =
      extractFieldLine(lines, [/(stake|outlay|wager|bet amount)/i]) ||
      text.match(/(?:stake|outlay|wager|bet amount)\s*[:\-]?\s*([$A-Z]*\s*[\d.,]+)/i)?.[0] ||
      null;
    return parseAmount(line);
  }

  function extractOdds(lines, text) {
    const line =
      extractFieldLine(lines, [/(decimal odds|odds|price|total odds)/i, /@\s*\d/i]) ||
      text.match(/(?:decimal odds|odds|price|total odds)\s*[:@\-]?\s*([^\s]+)/i)?.[0] ||
      text.match(/@\s*([\d./+-]+)/i)?.[0] ||
      null;
    return parseOdds(line);
  }

  function extractTicketId(lines, text) {
    const line =
      extractFieldLine(lines, [/(receipt|bet id|ticket|transaction|reference)/i]) ||
      text.match(/(?:receipt|bet id|ticket|transaction|reference)(?:\s*(?:number|no|id))?\s*[:#-]?\s*([a-z0-9-]{5,})/i)?.[0] ||
      null;
    if (!line) return null;
    return normalizeText(
      line.match(/([a-z0-9-]{5,})/i)?.[1] || ''
    );
  }

  function extractPlacedDate(lines, text) {
    const line =
      extractFieldLine(lines, [/(placed|date|time|resulted|settled)/i]) ||
      text.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})/i)?.[0] ||
      null;
    return parseDateString(line) || new Date().toISOString().slice(0, 10);
  }

  function detectSport(text) {
    const upper = text.toUpperCase();
    if (
      upper.includes('AFL') ||
      upper.includes('DISPOSALS') ||
      upper.includes('BEHINDS') ||
      upper.includes('CLEARANCES') ||
      upper.includes('HANDBALLS')
    ) {
      return 'AFL';
    }
    if (upper.includes('NBA') || upper.includes('REBOUNDS') || upper.includes('ASSISTS')) return 'NBA';
    if (upper.includes('NRL') || upper.includes('TRIES')) return 'NRL';
    if (upper.includes('NFL') || upper.includes('TOUCHDOWNS')) return 'NFL';
    if (upper.includes('MLB') || upper.includes('HOME RUNS')) return 'MLB';
    if (upper.includes('NHL') || upper.includes('SHOTS ON GOAL')) return 'NHL';
    if (upper.includes('CRICKET') || upper.includes('RUNS') || upper.includes('WICKETS')) return 'CRICKET';
    if (upper.includes('SOCCER') || upper.includes('GOAL SCORER')) return 'SOCCER';
    return 'OTHER';
  }

  function parseMatchupLine(line) {
    const vsMatch = line.match(/^(.+?)\s+(?:v|vs)\s+(.+)$/i);
    if (vsMatch) {
      return {
        left: normalizeText(vsMatch[1]),
        right: normalizeText(vsMatch[2]),
      };
    }
    return null;
  }

  function deriveTeamContext(selectionText, matchup) {
    if (!matchup) {
      return { team: null, opponent: null };
    }
    const normalizedSelection = normalizeText(selectionText).toLowerCase();
    const left = matchup.left.toLowerCase();
    const right = matchup.right.toLowerCase();
    if (normalizedSelection.includes(left)) {
      return { team: matchup.left, opponent: matchup.right };
    }
    if (normalizedSelection.includes(right)) {
      return { team: matchup.right, opponent: matchup.left };
    }
    return { team: null, opponent: null };
  }

  function normalizeStatType(raw) {
    const text = normalizeText(raw).toLowerCase();
    for (const mapping of TEAM_STAT_MAPPINGS) {
      if (mapping.pattern.test(text)) {
        return mapping.statType;
      }
    }
    return text || null;
  }

  function inferMarket(selectionText) {
    const normalized = normalizeText(selectionText);
    if (!normalized) return 'sportsbook import';
    if (/same game multi|sgm/i.test(normalized)) return 'same game multi';
    if (/\b(over|under)\b/i.test(normalized) && /\b(total|points|goals|runs)\b/i.test(normalized)) {
      return 'total';
    }
    if (/\bspread\b|\bline\b|\bhandicap\b/i.test(normalized)) return 'spread';
    if (/\bmoneyline\b|\bhead to head\b|\bto win\b/i.test(normalized)) return 'moneyline';
    return normalizeStatType(normalized) || 'sportsbook import';
  }

  function isNoiseLine(line, config) {
    if (!line) return true;
    if (FIELD_ONLY_PATTERNS.some((pattern) => pattern.test(line))) return true;
    if (GLOBAL_NOISE_PATTERNS.some((pattern) => pattern.test(line))) return true;
    if ((config.ignoreLinePatterns || []).some((pattern) => pattern.test(line))) return true;
    if (/^\$?\d[\d.,]*$/.test(line)) return true;
    if (/^[A-Z]{2,5}\s+\$?\d/i.test(line)) return false;
    return false;
  }

  function looksLikeSelectionLine(line) {
    if (!line) return false;
    if (isNoiseLine(line, { ignoreLinePatterns: [] })) return false;
    return (
      /.+\s+(over|under)\s+\d+(\.\d+)?\s+.+/i.test(line) ||
      /.+\s*@\s*[\d./+-]+/i.test(line) ||
      /\b(to win|moneyline|head to head|spread|handicap|line|total|disposals|goals|marks|tackles|clearances|points|rebounds|assists|runs|wickets|tries)\b/i.test(line)
    );
  }

  function parseSelectionLine(line, matchup, fallbackDate) {
    const text = normalizeText(line);
    if (!text) return null;

    const playerPropMatch = text.match(/^(.+?)\s+(over|under)\s+([\d.]+)\s+(.+)$/i);
    if (playerPropMatch) {
      const selection = `${normalizeText(playerPropMatch[1])} ${playerPropMatch[2].toLowerCase()} ${playerPropMatch[3]} ${normalizeText(playerPropMatch[4])}`;
      return {
        selection,
        market: normalizeStatType(playerPropMatch[4]),
        leg: {
          playerName: normalizeText(playerPropMatch[1]),
          team: null,
          opponent: null,
          gameDate: fallbackDate,
          overUnder: playerPropMatch[2].toLowerCase(),
          line: Number(playerPropMatch[3]),
          statType: normalizeStatType(playerPropMatch[4]),
          isGameProp: false,
        },
        lineOdds: null,
      };
    }

    const atOddsMatch = text.match(/^(.+?)\s*@\s*([\d./+-]+)$/i);
    if (atOddsMatch) {
      const selection = normalizeText(atOddsMatch[1]);
      const teams = deriveTeamContext(selection, matchup);
      return {
        selection,
        market: 'moneyline',
        leg: {
          playerName: null,
          team: teams.team,
          opponent: teams.opponent,
          gameDate: fallbackDate,
          overUnder: null,
          line: null,
          statType: 'moneyline',
          isGameProp: true,
        },
        lineOdds: parseOdds(atOddsMatch[2]),
      };
    }

    const spreadMatch = text.match(/^(.+?)\s+([+-]\d+(?:\.\d+)?)\s*(?:spread|line|handicap)?$/i);
    if (spreadMatch) {
      const selection = normalizeText(text);
      const teams = deriveTeamContext(spreadMatch[1], matchup);
      return {
        selection,
        market: 'spread',
        leg: {
          playerName: null,
          team: teams.team,
          opponent: teams.opponent,
          gameDate: fallbackDate,
          overUnder: null,
          line: Number(spreadMatch[2]),
          statType: 'spread',
          isGameProp: true,
        },
        lineOdds: null,
      };
    }

    const totalMatch = text.match(/^(over|under)\s+([\d.]+)\s+(.+)$/i);
    if (totalMatch) {
      return {
        selection: `${totalMatch[1].toLowerCase()} ${totalMatch[2]} ${normalizeText(totalMatch[3])}`,
        market: inferMarket(text),
        leg: {
          playerName: null,
          team: null,
          opponent: null,
          gameDate: fallbackDate,
          overUnder: totalMatch[1].toLowerCase(),
          line: Number(totalMatch[2]),
          statType: normalizeStatType(totalMatch[3]),
          isGameProp: true,
        },
        lineOdds: null,
      };
    }

    if (/\b(to win|moneyline|head to head)\b/i.test(text)) {
      const selection = normalizeText(text.replace(/\b(to win|moneyline|head to head)\b/i, ''));
      const teams = deriveTeamContext(selection, matchup);
      return {
        selection: normalizeText(text),
        market: 'moneyline',
        leg: {
          playerName: null,
          team: teams.team || selection,
          opponent: teams.opponent,
          gameDate: fallbackDate,
          overUnder: null,
          line: null,
          statType: 'moneyline',
          isGameProp: true,
        },
        lineOdds: null,
      };
    }

    return {
      selection: text,
      market: inferMarket(text),
      leg: {
        playerName: null,
        team: null,
        opponent: null,
        gameDate: fallbackDate,
        overUnder: null,
        line: null,
        statType: inferMarket(text),
        isGameProp: /\bmoneyline|head to head|spread|line|total\b/i.test(text),
      },
      lineOdds: null,
    };
  }

  function collectLegLines(lines, config) {
    const filtered = lines.filter((line) => !isNoiseLine(line, config));
    const selectionLines = filtered.filter((line) => looksLikeSelectionLine(line));
    if (selectionLines.length > 0) {
      return selectionLines;
    }

    return filtered.slice(0, 3);
  }

  function getCandidateContainers(config) {
    const selectors = config.receiptSelectors || [];
    const elements = uniqueElements(
      selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))
    ).filter(isVisibleElement);

    return elements.filter((element) => {
      const text = getElementText(element);
      if (!text || text.length < 30) return false;
      if ((config.requiredTextPatterns || []).some((pattern) => !pattern.test(text))) return false;
      return true;
    });
  }

  function dedupeLegs(parsedLegs) {
    const seen = new Set();
    return parsedLegs.filter((leg) => {
      const key = JSON.stringify(leg);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function determineBetType(text, legs) {
    if (/same game multi|sgm/i.test(text)) return 'same_game_multi';
    if (/parlay|multi/i.test(text)) return 'parlay';
    if (legs.length > 1) return 'parlay';
    return 'single';
  }

  function determineConfidence(candidate, notes) {
    let score = 0;
    if (candidate.stake != null) score += 2;
    else notes.push('missing stake');
    if (candidate.odds != null) score += 2;
    else notes.push('missing odds');
    if (candidate.ticketId) score += 2;
    else notes.push('missing receipt id');
    if (candidate.legs.length > 0) score += 2;
    else notes.push('missing selection');
    if (candidate.sport !== 'OTHER') score += 1;
    if (candidate.usedFallback) score -= 2;
    if (candidate.legs.length > 1) score += 1;

    if (score >= 7) return 'high';
    if (score >= 4) return 'medium';
    return 'low';
  }

  function buildSelectionFromLegs(legs, betType) {
    if (!Array.isArray(legs) || legs.length === 0) return null;
    if (betType === 'single') return legs[0].selection;
    return `Parlay: ${legs.map((leg) => leg.selection).join(' + ')}`;
  }

  function buildImportPayload(candidate, config) {
    const bookLabel = getBookLabel(config.bookKey);
    const betType = determineBetType(candidate.text, candidate.legs);
    const selection = buildSelectionFromLegs(candidate.legs, betType);
    if (!selection || candidate.stake == null || candidate.odds == null) {
      return null;
    }

    const primaryLeg = candidate.legs[0] || null;
    const notes = [...candidate.notes];
    const confidence = determineConfidence(
      {
        stake: candidate.stake,
        odds: candidate.odds,
        ticketId: candidate.ticketId,
        legs: candidate.legs,
        sport: candidate.sport,
        usedFallback: candidate.usedFallback,
      },
      notes
    );

    return {
      source: 'extension',
      source_book: config.bookKey,
      source_external_id: candidate.ticketId,
      source_page_url: window.location.href,
      parser_name: config.parserName,
      parse_confidence: confidence,
      bet_type: betType,
      parse_notes: `${bookLabel} ${config.parserName} parser (${confidence})${notes.length ? ` - ${notes.join(', ')}` : ''}`,
      raw_payload: {
        title: document.title,
        parser_name: config.parserName,
        parser_confidence: confidence,
        bet_type: betType,
        matched_selector: candidate.selector,
        receipt_excerpt: candidate.text.slice(0, 2000),
        candidate_leg_count: candidate.legs.length,
        extracted_legs: candidate.legs.map((leg) => leg.selection),
      },
      bet: {
        date: candidate.placedDate,
        sport: candidate.sport,
        market: betType === 'single' ? primaryLeg?.market ?? 'sportsbook import' : betType,
        selection,
        stake: candidate.stake,
        currency: 'AUD',
        odds: candidate.odds,
        bookmaker: bookLabel,
        result: 'pending',
        status: 'pending',
        ...(betType === 'single' && primaryLeg
          ? {
              player_name: primaryLeg.leg.playerName,
              team: primaryLeg.leg.team,
              opponent: primaryLeg.leg.opponent,
              stat_type: primaryLeg.leg.statType,
              line: primaryLeg.leg.line,
              over_under: primaryLeg.leg.overUnder,
              game_date: primaryLeg.leg.gameDate,
            }
          : {}),
        ...(betType !== 'single'
          ? {
              parlay_legs: candidate.legs.map((leg) => leg.leg),
            }
          : {}),
      },
    };
  }

  function parseCandidate(element, selector, config) {
    const text = getElementText(element);
    const lines = getElementLines(element);
    if (!text || lines.length === 0) return null;

    const matchup = lines.map(parseMatchupLine).find(Boolean) || null;
    const placedDate = extractPlacedDate(lines, text);
    const sport = detectSport(text);
    const ticketId = extractTicketId(lines, text);
    const stake = extractStake(lines, text);
    let odds = extractOdds(lines, text);
    const legLines = collectLegLines(lines, config);
    let usedFallback = false;
    const notes = [];

    let legs = legLines
      .map((line) => parseSelectionLine(line, matchup, placedDate))
      .filter(Boolean);

    if (legs.length === 0 && lines.length > 0) {
      usedFallback = true;
      notes.push('used fallback line selection');
      const fallback = parseSelectionLine(lines.find((line) => !isNoiseLine(line, config)) || '', matchup, placedDate);
      if (fallback) {
        legs = [fallback];
      }
    }

    legs = dedupeLegs(legs);

    if (odds == null && legs.length === 1 && legs[0].lineOdds != null) {
      odds = legs[0].lineOdds;
    }

    return {
      selector,
      text,
      lines,
      placedDate,
      sport,
      ticketId,
      stake,
      odds,
      legs,
      usedFallback,
      notes,
    };
  }

  function createBookParser(config) {
    return {
      parsePage(context) {
        const candidates = getCandidateContainers(config)
          .map((element) => {
            const selector = (config.receiptSelectors || []).find((candidateSelector) => {
              try {
                return element.matches(candidateSelector);
              } catch {
                return false;
              }
            }) || config.receiptSelectors?.[0] || 'unknown';
            return parseCandidate(element, selector, config);
          })
          .filter(Boolean)
          .map((candidate) => buildImportPayload(candidate, config))
          .filter(Boolean);

        const ranked = candidates.sort((a, b) => {
          const rank = { high: 3, medium: 2, low: 1 };
          return rank[b.parse_confidence] - rank[a.parse_confidence];
        });

        if (context.autoCapture) {
          return ranked.filter((candidate) => candidate.parse_confidence === 'high');
        }

        const strongCandidates = ranked.filter((candidate) => candidate.parse_confidence !== 'low');
        return strongCandidates.length > 0 ? strongCandidates : ranked.slice(0, 1);
      },
    };
  }

  function registerParser(bookKey, parser) {
    parserRegistry[bookKey] = parser;
  }

  function getParser(bookKey) {
    return parserRegistry[bookKey] || null;
  }

  function buildImportPayloads(options) {
    const bookKey = options?.bookKey || getBookKey();
    const parser = getParser(bookKey);
    if (!parser) {
      throw new Error('No parser registered for this bookmaker.');
    }
    const payloads = parser.parsePage({
      autoCapture: options?.autoCapture === true,
    });
    if (!Array.isArray(payloads) || payloads.length === 0) {
      throw new Error('Could not identify any supported bet receipts on this page.');
    }
    return payloads;
  }

  globalThis[GLOBAL_KEY] = {
    BOOK_LABELS,
    createBookParser,
    buildImportPayloads,
    getBookKey,
    getBookLabel,
    normalizeText,
    registerParser,
  };
})();
