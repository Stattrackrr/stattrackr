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

  const JUNK_SELECTION_PATTERNS = [
    /for free and confidential support/i,
    /gamblinghelponline\.org\.au/i,
    /1800\s*858\s*858/i,
    /call\s+1800/i,
    /deposit limit/i,
    /set a deposit limit/i,
    /account overview/i,
    /quick links/i,
    /contact us/i,
    /live chat/i,
    /email us/i,
    /customer service/i,
    /my bets faqs?/i,
    /cash out faqs?/i,
    /sportsbet cash/i,
    /bet slip is empty/i,
    /check today's racing/i,
  ];

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

  const METADATA_LINE_PATTERNS = [
    /see tracker/i,
    /tracker\s*&\s*more/i,
    /^\d+\s+legs?(?:\s*[•·]|\s*$)/i,
    /^\d+\s+legs?\s*[•·]\s*stake/i,
    /stake\s*\$?[\d.,]+/i,
    /^outlay\s*\$?[\d.,]+/i,
    /^standard multi$/i,
    /^bet builder$/i,
    /^(mon|tue|wed|thu|fri|sat|sun),?\s+\d{1,2}\s+[a-z]{3,9}(?:\s+\d{2,4})?$/i,
    /^(today|yesterday|\d+\s+days?\s+ago)$/i,
    /^[\d.]+\s+leg(?:s)?\s+multi$/i,
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

  function getConfigNumber(config, key, fallback) {
    const value = config?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  function isMultiBetText(text) {
    return /\b(same game multi|sgm|standard multi|multi bet|bet builder|\d+\s+leg(?:s)?(?:\s+multi)?|leg\s+multi)\b/i.test(
      normalizeText(text)
    );
  }

  function isPlausibleOdds(odds, text, config) {
    if (!Number.isFinite(odds) || odds < 1.01) return false;
    const maxOdds = getConfigNumber(config, 'maxOdds', isMultiBetText(text) ? 25000 : 501);
    return odds <= maxOdds;
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

  function formatIsoDateUtc(date) {
    return date.toISOString().slice(0, 10);
  }

  function parseRelativeDate(raw) {
    const text = normalizeText(raw).toLowerCase();
    if (!text) return null;

    const now = new Date();
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    if (/\btoday\b/.test(text)) {
      return formatIsoDateUtc(base);
    }
    if (/\byesterday\b/.test(text)) {
      base.setUTCDate(base.getUTCDate() - 1);
      return formatIsoDateUtc(base);
    }

    const daysAgo = text.match(/(\d+)\s+days?\s+ago/);
    if (daysAgo) {
      base.setUTCDate(base.getUTCDate() - Number(daysAgo[1]));
      return formatIsoDateUtc(base);
    }

    return null;
  }

  function parseDateString(raw) {
    const text = normalizeText(raw);
    if (!text) return null;

    const relative = parseRelativeDate(text);
    if (relative) return relative;

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
      if (!Number.isNaN(parsed.getTime())) return formatIsoDateUtc(parsed);
    }

    const weekdayMatch = text.match(
      /(?:mon|tue|wed|thu|fri|sat|sun)day,?\s+(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{2,4}))?/i
    );
    if (weekdayMatch) {
      const year = weekdayMatch[3] ? Number(weekdayMatch[3]) : new Date().getFullYear();
      const parsed = new Date(`${weekdayMatch[1]} ${weekdayMatch[2]} ${year}`);
      if (!Number.isNaN(parsed.getTime())) return formatIsoDateUtc(parsed);
    }

    const textMatch = text.match(/(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{2,4}))?/);
    if (textMatch) {
      const year = textMatch[3] ? Number(textMatch[3]) : new Date().getFullYear();
      const parsed = new Date(`${textMatch[1]} ${textMatch[2]} ${year}`);
      if (!Number.isNaN(parsed.getTime())) return formatIsoDateUtc(parsed);
    }

    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return formatIsoDateUtc(parsed);
  }

  const DATE_FRAGMENT_PATTERNS = [
    /(\d{4}-\d{2}-\d{2})/,
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
    /((?:mon|tue|wed|thu|fri|sat|sun)day,?\s+\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{2,4})?)/i,
    /(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})/i,
    /(\d{1,2}\s+[A-Za-z]{3,9})/i,
    /\b(today|yesterday)\b/i,
    /(\d+\s+days?\s+ago)/i,
  ];

  function extractDateFromLine(line) {
    const normalized = normalizeText(line);
    if (!normalized || normalized.length > 120) return null;

    for (const pattern of DATE_FRAGMENT_PATTERNS) {
      const match = normalized.match(pattern);
      if (!match) continue;
      const fragment = match[1] || match[0];
      const parsed = parseDateString(fragment);
      if (parsed && isPlausibleBetDate(parsed)) {
        return { iso: parsed, raw: fragment };
      }
    }

    const parsed = parseDateString(normalized);
    if (parsed && isPlausibleBetDate(parsed)) {
      return { iso: parsed, raw: normalized };
    }

    return null;
  }

  function findDateHeaderNearElement(element) {
    if (!(element instanceof HTMLElement)) return null;

    let node = element;
    for (let depth = 0; depth < 10 && node; depth += 1) {
      let sibling = node.previousElementSibling;
      while (sibling) {
        const hit = extractDateFromElement(sibling);
        if (hit) return hit;
        sibling = sibling.previousElementSibling;
      }
      node = node.parentElement;
    }

    return null;
  }

  function extractDateFromElement(element) {
    if (!(element instanceof HTMLElement)) return null;

    const direct = extractDateFromLine(element.textContent || '');
    if (direct) return direct;

    const selectors = 'time,[datetime],h1,h2,h3,h4,h5,span,div,p';
    const children = element.querySelectorAll(selectors);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      const datetime = child.getAttribute?.('datetime');
      if (datetime) {
        const parsed = parseDateString(datetime);
        if (parsed && isPlausibleBetDate(parsed)) {
          return { iso: parsed, raw: datetime };
        }
      }
      const childText = normalizeText(child.textContent || '');
      if (childText.length < 4 || childText.length > 80) continue;
      const hit = extractDateFromLine(childText);
      if (hit) return hit;
    }

    return null;
  }

  function extractFieldLine(lines, patterns) {
    const combinedPatterns = patterns || [];
    return lines.find((line) => combinedPatterns.some((pattern) => pattern.test(line))) || null;
  }

  function isReturnLine(line) {
    return /\b(return|returned|collected|payout|paid|potential|to collect|winnings)\b/i.test(
      normalizeText(line)
    );
  }

  function extractStakeAmountFromText(value) {
    const text = normalizeText(value);
    if (!text) return null;

    const patterns = [
      /\d+\s+legs?\s*[•·]\s*stake\s*\$?\s*([\d.,]+)/i,
      /\bstake\s*\$?\s*([\d.,]+)/i,
      /(?:stake|outlay|wager)\s*[:\-]?\s*(?:AUD|\$)?\s*([\d.,]+)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        const amount = parseAmount(match[1]);
        if (amount != null && isPlausibleStake(amount)) return amount;
      }
    }

    return null;
  }

  function extractStake(lines, text) {
    const candidates = [];

    const pushStake = (amount, priority) => {
      if (amount != null && isPlausibleStake(amount)) {
        candidates.push({ amount, priority });
      }
    };

    for (const line of lines) {
      if (isReturnLine(line)) continue;
      const fromLine = extractStakeAmountFromText(line);
      if (fromLine != null) pushStake(fromLine, 20);
    }

    const fromText = extractStakeAmountFromText(text);
    if (fromText != null) pushStake(fromText, 18);

    const labelIndex = lines.findIndex((line) => /^(stake|outlay|wager|bet amount)$/i.test(line));
    if (labelIndex >= 0 && lines[labelIndex + 1] && !isReturnLine(lines[labelIndex + 1])) {
      const nextAmount = parseAmount(lines[labelIndex + 1].match(/([\d.,]+)/)?.[1]);
      if (nextAmount != null) pushStake(nextAmount, 16);
    }

    for (const line of lines) {
      if (isReturnLine(line)) continue;
      const moneyOnly = line.match(/^(?:AUD|\$)\s*([\d.,]+)$/i);
      if (moneyOnly) {
        pushStake(parseAmount(moneyOnly[1]), 4);
      }
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.priority - a.priority || a.amount - b.amount);
    const topPriority = candidates[0].priority;
    const best = candidates.filter((entry) => entry.priority === topPriority);
    return Math.min(...best.map((entry) => entry.amount));
  }

  function isTeamAtLine(line) {
    const normalized = normalizeText(line);
    if (!/@/.test(normalized)) return false;
    if (/@\s*[\d.]{1,6}(?:\s|$)/.test(normalized)) return false;
    return /[A-Za-z][\w'’.-]*\s+@\s+[A-Za-z][\w'’.-]*/.test(normalized);
  }

  function isPlausibleExtractedOdds(odds) {
    return Number.isFinite(odds) && odds >= 1.01 && odds <= 501;
  }

  function extractOdds(lines, text) {
    const labeledLine = extractFieldLine(lines, [/(decimal odds|odds|price|total odds)/i]);
    if (labeledLine) {
      const labeledOdds = parseOdds(labeledLine.match(/([\d./+-]+)/)?.[1]);
      if (isPlausibleExtractedOdds(labeledOdds)) return labeledOdds;
    }

    const labelIndex = lines.findIndex((line) => /^(decimal odds|odds|price|total odds)$/i.test(line));
    if (labelIndex >= 0 && lines[labelIndex + 1]) {
      const nextOdds = parseOdds(lines[labelIndex + 1]);
      if (isPlausibleExtractedOdds(nextOdds)) return nextOdds;
    }

    const atMatches = [];
    for (const line of lines) {
      if (isTeamAtLine(line)) continue;
      const atMatch = line.match(/@\s*([\d]{1,3}(?:\.\d{1,3})?)/);
      if (atMatch) {
        const odds = parseOdds(atMatch[1]);
        if (isPlausibleExtractedOdds(odds)) atMatches.push(odds);
      }
      const oddsOnly = line.match(/^([\d.]+)$/);
      if (oddsOnly) {
        const odds = parseOdds(oddsOnly[1]);
        if (isPlausibleExtractedOdds(odds)) atMatches.push(odds);
      }
    }
    if (atMatches.length > 0) {
      return atMatches[atMatches.length - 1];
    }

    const globalAt = [...text.matchAll(/@\s*([\d]{1,3}(?:\.\d{1,3})?)/g)];
    for (let index = globalAt.length - 1; index >= 0; index -= 1) {
      const odds = parseOdds(globalAt[index][1]);
      if (isPlausibleExtractedOdds(odds)) return odds;
    }

    return null;
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

  function extractDateCandidates(lines, text) {
    const candidates = [];
    const pushCandidate = (raw, priority) => {
      const parsed = parseDateString(raw);
      if (parsed && isPlausibleBetDate(parsed)) {
        candidates.push({ parsed, priority });
      }
    };

    for (const line of lines) {
      if (!line || line.length > 140) continue;
      const priority = /(placed|resulted|settled)/i.test(line) ? 3 : 2;

      for (const pattern of DATE_FRAGMENT_PATTERNS) {
        const match = line.match(pattern);
        if (match) pushCandidate(match[1] || match[0], priority);
      }

      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(line) || /^\d{1,2}\s+[A-Za-z]{3,9}(\s+\d{2,4})?$/i.test(line)) {
        pushCandidate(line, priority);
      }
    }

    for (const pattern of DATE_FRAGMENT_PATTERNS) {
      const match = text.match(pattern);
      if (match) pushCandidate(match[1] || match[0], 1);
    }

    if (candidates.length === 0) return [];

    candidates.sort((a, b) => b.priority - a.priority || b.parsed.localeCompare(a.parsed));
    return candidates.map((entry) => entry.parsed);
  }

  function extractPlacedDate(lines, text, element, config) {
    const cardCandidates = extractDateCandidates(lines, text);
    if (cardCandidates.length > 0) {
      return {
        iso: cardCandidates[0],
        raw: cardCandidates[0],
        source: 'card',
        isFallback: false,
      };
    }

    if (element && config?.inheritDateFromAncestors !== false) {
      const nearby = findDateHeaderNearElement(element);
      if (nearby) {
        return {
          iso: nearby.iso,
          raw: nearby.raw,
          source: 'section',
          isFallback: false,
        };
      }
    }

    return {
      iso: formatIsoDateUtc(new Date()),
      raw: null,
      source: 'fallback',
      isFallback: true,
    };
  }

  function detectSport(text) {
    const upper = text.toUpperCase();
    if (
      /\bRACING\b/.test(upper) ||
      /\bR\d+\b/.test(upper) ||
      /\b(THOROUGHBRED|HARNESS|GREYHOUND|MEETING|FLEMINGTON|RANDWICK|CAULFIELD)\b/.test(upper)
    ) {
      return 'RACING';
    }
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
    if (
      upper.includes('CRICKET') ||
      /\b(IPL|BBL|THE ASHES|TEST MATCH|BIG BASH)\b/.test(upper) ||
      (/\b(WICKETS?|TOP RUNSCORER|RUNS SCORED)\b/.test(upper) &&
        /\b(CRICKET|SUPER KINGS|TITANS|ROYALS|CAPITALS|KNIGHT RIDERS)\b/.test(upper))
    ) {
      return 'CRICKET';
    }
    if (
      upper.includes('SOCCER') ||
      upper.includes('GOAL SCORER') ||
      upper.includes('A-LEAGUE') ||
      upper.includes('PREMIER LEAGUE')
    ) {
      return 'SOCCER';
    }
    if (
      upper.includes('TENNIS') ||
      upper.includes('ATP') ||
      upper.includes('WTA') ||
      /\b(GRAND SLAM|WIMBLEDON|ROLAND GARROS|US OPEN)\b/.test(upper)
    ) {
      return 'TENNIS';
    }
    if (upper.includes('GOLF') || upper.includes('PGA')) return 'GOLF';
    if (upper.includes('UFC') || upper.includes('MMA') || upper.includes('BOXING')) return 'COMBAT';
    if (upper.includes('RUGBY')) return 'RUGBY';
    if (upper.includes('F1') || upper.includes('FORMULA 1') || upper.includes('MOTORSPORT')) {
      return 'MOTORSPORT';
    }
    return 'OTHER';
  }

  const GENERIC_BET_LABEL_PATTERNS = [
    /^same game multi$/i,
    /^same game multi\s+v\s+[\d.]+/i,
    /^sgm$/i,
    /^multi$/i,
    /^parlay$/i,
    /^single$/i,
    /^acca$/i,
    /^bet$/i,
    /^parlay:\s*same game multi$/i,
    /^\d+\s+legs?$/i,
    /^standard multi$/i,
    /^bet builder$/i,
  ];

  function isGenericBetLabel(text) {
    const normalized = normalizeText(text);
    if (!normalized) return true;
    return GENERIC_BET_LABEL_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  function isMetadataLine(line) {
    const text = normalizeText(line);
    if (!text) return true;
    if (METADATA_LINE_PATTERNS.some((pattern) => pattern.test(text))) return true;
    if (extractDateFromLine(text) && text.length < 28) return true;
    if (/^[•·]\s*/.test(text) && /stake|outlay|legs?/i.test(text)) return true;
    return false;
  }

  function isSubstantiveLegSelection(selection) {
    const text = normalizeText(selection);
    if (!text || text.length < 4) return false;
    if (isMetadataLine(text) || isGenericBetLabel(text) || isJunkSelection(text)) return false;
    if (/^\+/.test(text)) return false;
    return true;
  }

  const DAY_NAME_PATTERN = /^(sun|mon|tue|wed|thu|fri|sat)$/i;

  function looksLikeTeamSide(name) {
    const text = normalizeText(name);
    if (!text || text.length < 3) return false;
    if (/^\d+(\.\d+)?$/.test(text)) return false;
    if (/^[\d.,$]+$/.test(text)) return false;
    if (DAY_NAME_PATTERN.test(text)) return false;
    if (!/[A-Za-z]{3,}/.test(text)) return false;
    if (/\b(same game multi|standard multi|multi bet|bet builder)\b/i.test(text)) return false;
    if (/^\d+\s+legs?$/i.test(text)) return false;
    if (/^(multi|legs?|stake|odds|won|lost|see|tracker|more)$/i.test(text)) return false;
    return true;
  }

  function stripLeadingMoneyPrefix(text) {
    return normalizeText(text).replace(/^(?:AUD|\$)?\s*[\d.,]+\s+/, '');
  }

  function isValidFixture(fixture) {
    const text = normalizeText(fixture);
    if (!text) return false;
    if (/same game multi\s+v\s+[\d.]+/i.test(text)) return false;
    if (/\bv\s+[\d.]{1,4}$/i.test(text)) return false;
    if (/^\d+\s+leg(?:s)?\s+multi$/i.test(text)) return false;
    return /[A-Za-z]{3,}\s+(?:v|vs)\s+[A-Za-z]{3,}/i.test(text);
  }

  function extractFixtureFromLines(lines) {
    const fixtures = [];

    for (const line of lines || []) {
      const matchup = parseMatchupLine(line);
      if (!matchup) continue;
      const fixture = `${matchup.left} v ${matchup.right}`;
      if (isValidFixture(fixture)) fixtures.push(fixture);
    }

    for (const line of lines || []) {
      const fromLine = extractFixtureFromCardText(line);
      if (fromLine && isValidFixture(fromLine)) fixtures.push(fromLine);
    }

    if (fixtures.length === 0) return null;
    return fixtures.sort((a, b) => b.length - a.length)[0];
  }

  function cleanSelectionHeadline(selection) {
    const text = normalizeText(selection);
    if (!text) return null;

    const fixture = extractFixtureFromCardText(text);
    if (fixture && isValidFixture(fixture)) return fixture;

    const legMulti = text.match(/^(\d+\s+leg(?:s)?\s+(?:same game )?multi)\b/i);
    if (legMulti) return legMulti[1];

    const withoutOdds = text
      .replace(/^same game multi\s+v\s+[\d.]+\s*/i, '')
      .replace(/\s+\d+\s+leg(?:s)?\s*$/i, '')
      .trim();
    if (withoutOdds && withoutOdds !== text) {
      const retryFixture = extractFixtureFromCardText(withoutOdds);
      if (retryFixture && isValidFixture(retryFixture)) return retryFixture;
      const retryLeg = withoutOdds.match(/^(\d+\s+leg(?:s)?\s+(?:same game )?multi)\b/i);
      if (retryLeg) return retryLeg[1];
    }

    return null;
  }

  function buildDisplayTitle(multiLabel, fixture, selection) {
    if (multiLabel && fixture && isValidFixture(fixture)) return `${multiLabel} — ${fixture}`;
    if (fixture && isValidFixture(fixture)) return fixture;
    if (multiLabel) return multiLabel;
    if (selection && isValidFixture(selection)) return selection;
    const cleaned = cleanSelectionHeadline(selection);
    if (cleaned) return cleaned;
    return selection || null;
  }

  function extractFixtureFromCardText(text) {
    const normalized = stripLeadingMoneyPrefix(text);
    if (!normalized) return null;

    const candidates = [];

    const addFixture = (left, right) => {
      const cleanLeft = normalizeText(left).replace(/^(?:AUD|\$)?\s*[\d.,]+\s+/, '');
      const cleanRight = normalizeText(right).replace(/\s+(sun|mon|tue|wed|thu|fri|sat)$/i, '');
      if (!looksLikeTeamSide(cleanLeft) || !looksLikeTeamSide(cleanRight)) return;
      candidates.push(`${cleanLeft} v ${cleanRight}`);
    };

    for (const match of normalized.matchAll(
      /\b([A-Za-z][A-Za-z0-9 .'-]{2,})\s+vs\.?\s+([A-Za-z][A-Za-z0-9 .'-]{2,})\b/gi
    )) {
      addFixture(match[1], match[2]);
    }

    for (const match of normalized.matchAll(
      /\b([A-Za-z][A-Za-z0-9 .'-]{2,})\s+v\s+([A-Za-z][A-Za-z0-9 .'-]{2,})\b/gi
    )) {
      addFixture(match[1], match[2]);
    }

    for (const match of normalized.matchAll(
      /\b([A-Za-z][A-Za-z0-9 .'-]{2,})\s+@\s+([A-Za-z][A-Za-z0-9 .'-]{2,})\b/gi
    )) {
      addFixture(match[1], match[2]);
    }

    if (candidates.length === 0) return null;

    return candidates
      .filter((fixture) => isValidFixture(fixture))
      .sort((a, b) => b.length - a.length)[0];
  }

  function buildMultiLabel(text) {
    const legCount = text.match(/(\d+)\s+legs?\b/i)?.[1];
    const typeMatch = text.match(/(same game multi|standard multi|multi bet|bet builder)/i);
    if (!legCount && !typeMatch) return null;
    const type = typeMatch
      ? typeMatch[1].replace(/\b\w/g, (char) => char.toUpperCase())
      : 'Multi';
    return legCount ? `${legCount} Leg ${type}` : type;
  }

  function isSubstantiveSelection(selection) {
    const text = normalizeText(selection);
    if (!text || text.length < 4) return false;
    if (isJunkSelection(text) || isGenericBetLabel(text)) return false;
    if (/see tracker/i.test(text)) return false;
    if (/\d+\s+legs?\s*[•·]\s*stake/i.test(text)) return false;
    if (/^parlay:\s*same game multi$/i.test(text)) return false;
    if (/same game multi\s+v\s+[\d.]+/i.test(text)) return false;
    if (/^\d+\s+leg\s+(multi|same game multi|standard multi)/i.test(text)) return true;
    if (/[A-Za-z]{3,}\s+(?:v|vs)\s+[A-Za-z]{3,}/i.test(text)) return true;
    if (
      /^(?:\d+\s+leg(?:s)?|same game multi|parlay):\s*(?:multi|same game multi|\d+\s+legs?)/i.test(
        text
      )
    ) {
      return false;
    }
    if (/^most disposals gr\d/i.test(text) && !/\b(over|under|@|v|vs)\b/i.test(text)) {
      return text.length >= 12;
    }
    return text.length >= 6;
  }

  function isPlausibleStake(value) {
    return Number.isFinite(value) && value >= 0.01 && value <= 5000;
  }

  function isPlausibleBetDate(isoDate) {
    if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;
    const parsed = new Date(`${isoDate}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return false;
    const year = parsed.getUTCFullYear();
    const now = new Date();
    const max = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    return year >= 2020 && parsed.getTime() <= max.getTime();
  }

  function isJunkSelection(selection) {
    const text = normalizeText(selection);
    if (!text || text.length < 4) return true;
    if (JUNK_SELECTION_PATTERNS.some((pattern) => pattern.test(text))) return true;
    if (GLOBAL_NOISE_PATTERNS.some((pattern) => pattern.test(text)) && text.length < 120) {
      return true;
    }
    if (isGenericBetLabel(text)) return true;
    return false;
  }

  function isResultedBetText(text) {
    const normalized = normalizeText(text);
    if (!normalized) return false;
    if (/\b(won|lost|void|refunded|paid|collected|returned)\b/i.test(normalized)) {
      return true;
    }
    if (/(^|\n)\s*(win|loss)\s*($|\n)/i.test(normalized)) {
      return true;
    }
    return /\bresulted\b/i.test(normalized) && !/\b(pending|open bets|in play)\b/i.test(normalized);
  }

  function looksLikeResultedBetCard(text) {
    const normalized = normalizeText(text);
    if (!normalized || normalized.length < 15) return false;
    if (isResultedBetText(normalized)) return true;
    const hasMoney =
      /(?:stake|outlay|wager|AUD|\$)\s*[\d.,]+/i.test(normalized) ||
      /[\d.,]+\s*(?:AUD|USD)/i.test(normalized);
    const hasOdds =
      /@\s*[\d.]+/.test(normalized) ||
      /\bodds?\s*[:.]?\s*[\d.]+/i.test(normalized) ||
      /(?:^|\s)([1-9]\d*\.\d{1,3})(?:\s|$)/.test(normalized);
    return hasMoney && hasOdds && normalized.length <= 1600;
  }

  function tryBuildPayloadFromElement(element, config) {
    if (!(element instanceof HTMLElement)) return null;
    const selector =
      element.getAttribute('data-automation-id') ||
      element.tagName.toLowerCase() ||
      'element';
    const candidate = parseCandidate(element, selector, config);
    if (!candidate) return null;
    return buildImportPayload(candidate, config);
  }

  function extractFixtureKeyFromPayload(payload) {
    const bet = payload?.bet || {};
    const selection = normalizeText(bet.selection || '').toLowerCase();

    if (bet.team && bet.opponent) {
      return [normalizeText(bet.team).toLowerCase(), normalizeText(bet.opponent).toLowerCase()]
        .sort()
        .join('|');
    }

    const emDashMatch = selection.match(/—\s*(.+?)\s+(?:v|vs)\s+(.+)$/i);
    if (emDashMatch) {
      return [normalizeText(emDashMatch[1]).toLowerCase(), normalizeText(emDashMatch[2]).toLowerCase()]
        .sort()
        .join('|');
    }

    const vsMatch = selection.match(/(.+?)\s+(?:v|vs)\s+(.+)/i);
    if (vsMatch) {
      return [normalizeText(vsMatch[1]).toLowerCase(), normalizeText(vsMatch[2]).toLowerCase()]
        .sort()
        .join('|');
    }

    return '';
  }

  function extractPickKeyFromPayload(payload) {
    const bet = payload?.bet || {};
    if (bet.team) return normalizeText(bet.team).toLowerCase();

    const selection = normalizeText(bet.selection || '').toLowerCase();
    const pickMatch = selection.match(/^(.+?)\s+to\s+win\b/i);
    if (pickMatch) return normalizeText(pickMatch[1]).toLowerCase();

    const beforeDash = selection.split('—')[0]?.trim();
    if (beforeDash && beforeDash.length > 0 && beforeDash.length < 80) {
      return beforeDash;
    }

    return selection.slice(0, 80);
  }

  function buildPayloadDedupeKey(payload) {
    if (!payload?.bet) return '';
    const fixture = extractFixtureKeyFromPayload(payload);
    if (fixture) {
      return [
        payload.source_book || '',
        String(payload.bet.stake ?? ''),
        String(payload.bet.odds ?? ''),
        fixture,
      ]
        .join('|')
        .toLowerCase();
    }
    return [
      payload.source_book || '',
      String(payload.bet.stake ?? ''),
      String(payload.bet.odds ?? ''),
      extractPickKeyFromPayload(payload),
    ]
      .join('|')
      .toLowerCase();
  }

  function payloadsAreLikelyDuplicates(left, right) {
    if (!left?.bet || !right?.bet) return false;
    if (left.source_book !== right.source_book) return false;
    if (Number(left.bet.stake) !== Number(right.bet.stake)) return false;
    if (Number(left.bet.odds) !== Number(right.bet.odds)) return false;

    const pickLeft = extractPickKeyFromPayload(left);
    const pickRight = extractPickKeyFromPayload(right);
    if (pickLeft && pickLeft === pickRight) return true;

    const fixtureLeft = extractFixtureKeyFromPayload(left);
    const fixtureRight = extractFixtureKeyFromPayload(right);
    if (fixtureLeft && fixtureRight && fixtureLeft === fixtureRight) return true;
    if (fixtureLeft && pickRight && fixtureLeft.includes(pickRight)) return true;
    if (fixtureRight && pickLeft && fixtureRight.includes(pickLeft)) return true;

    return false;
  }

  function scorePayloadQuality(payload) {
    let score = 0;
    const selection = normalizeText(payload?.bet?.selection || '');
    const raw = payload?.raw_payload || {};

    if (selection.includes('—')) score += 12;
    if (/\s(?:v|vs)\s/i.test(selection)) score += 8;
    if (/\bto win\b/i.test(selection)) score += 5;
    if (selection.length > 45) score += 6;
    if (selection.length < 35 && !selection.includes('—')) score -= 12;
    if (raw.fixture && isValidFixture(String(raw.fixture))) score += 20;
    if (/same game multi\s+v\s+[\d.]+/i.test(selection)) score -= 25;

    if (raw.placed_date_source === 'card') score += 4;
    else if (raw.placed_date_source === 'section') score += 1;

    if (payload.parse_confidence === 'high') score += 3;
    else if (payload.parse_confidence === 'medium') score += 1;

    if (payload.bet?.team) score += 3;

    return score;
  }

  function mergePayloadByKey(map, payload) {
    if (!payload?.bet) return;

    let matchedKey = null;
    for (const [key, existing] of map.entries()) {
      if (payloadsAreLikelyDuplicates(existing, payload)) {
        matchedKey = key;
        break;
      }
    }

    const key = matchedKey || buildPayloadDedupeKey(payload);
    if (!key || key.split('|').filter(Boolean).length < 3) return;

    const existing = map.get(key);
    if (!existing || scorePayloadQuality(payload) > scorePayloadQuality(existing)) {
      map.set(key, payload);
    }
  }

  function findParseableBetElements(roots, config) {
    const scopes = uniqueElements(
      (Array.isArray(roots) ? roots : [roots]).filter(Boolean)
    );
    const bestByKey = new Map();

    const visitAnchor = (anchor) => {
      if (!(anchor instanceof HTMLElement) || !isVisibleElement(anchor)) return;

      let current = anchor;
      let bestPayload = null;
      let bestScore = -Infinity;

      for (let depth = 0; depth < 8 && current; depth += 1) {
        const text = getElementText(current);
        const maxClimbChars = getConfigNumber(config, 'maxClimbChars', 6500);
        if (text.length > maxClimbChars) {
          current = current.parentElement;
          continue;
        }

        const payload = tryBuildPayloadFromElement(current, config);
        if (payload) {
          const quality = scorePayloadQuality(payload);
          if (quality > bestScore) {
            bestScore = quality;
            bestPayload = payload;
          }
        }
        current = current.parentElement;
      }

      if (bestPayload) {
        mergePayloadByKey(bestByKey, bestPayload);
      }
    };

    for (const scope of scopes) {
      scope
        .querySelectorAll('[data-automation-id*="bet"], [data-automation-id*="Bet"]')
        .forEach(visitAnchor);

      scope.querySelectorAll('article, li, [role="listitem"]').forEach((element) => {
        if (
          element.querySelector(
            '[data-automation-id*="bet"], [data-automation-id*="Bet"]'
          )
        ) {
          return;
        }
        const text = getElementText(element);
        if (!looksLikeResultedBetCard(text)) return;
        visitAnchor(element);
      });
    }

    return Array.from(bestByKey.values());
  }

  function extractResult(lines, text) {
    const combined = normalizeText([...lines, text].join(' '));
    if (/\bvoid\b|\bvoided\b|\brefunded?\b/i.test(combined)) {
      return { result: 'void', status: 'completed' };
    }
    if (/\blost\b|\bloser\b|\bloss\b/i.test(combined)) {
      return { result: 'loss', status: 'completed' };
    }
    if (/\bwon\b|\bwinner\b|\bwin\b|\bcollected\b|\bpaid\b|\breturned\b/i.test(combined)) {
      return { result: 'win', status: 'completed' };
    }
    if (/\b(pending|open|in play|live)\b/i.test(combined)) {
      return { result: 'pending', status: 'pending' };
    }
    return { result: 'pending', status: 'pending' };
  }

  function parseMatchupLine(line) {
    const vsMatch = line.match(/^(.+?)\s+(?:v|vs)\s+(.+)$/i);
    if (!vsMatch) return null;

    const left = normalizeText(vsMatch[1]).replace(/^(?:AUD|\$)?\s*[\d.,]+\s+/, '');
    const right = normalizeText(vsMatch[2]).replace(/\s+(sun|mon|tue|wed|thu|fri|sat)$/i, '');
    if (!looksLikeTeamSide(left) || !looksLikeTeamSide(right)) return null;

    return {
      left,
      right,
    };
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
    if (isMetadataLine(line)) return true;
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
    if (isGenericBetLabel(line)) return false;
    if (/^(won|lost|void|refunded|pending|resulted|stake|outlay|odds)$/i.test(line)) return false;
    return (
      /.+\s+(over|under)\s+\d+(\.\d+)?\s+.+/i.test(line) ||
      (/.+\s*@\s*[\d./+-]+/i.test(line) && !/^\s*stake/i.test(line)) ||
      /^.+\s+(?:v|vs)\s+.+$/i.test(line) ||
      /\b(to win|to make|to score|moneyline|head to head|spread|handicap|line|total|disposals|goals|marks|tackles|clearances|points|rebounds|assists|runs|wickets|tries|winner|match winner|set|sets|game|games|aces|each way|first goal|anytime goal)\b/i.test(
        line
      )
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

  function stripLineOddsSuffix(line) {
    return normalizeText(String(line || '').replace(/\s*@\s*[\d./+-]+.*$/i, ''));
  }

  function isMatchupOnlyLine(line) {
    return Boolean(parseMatchupLine(line));
  }

  function lineContainedInMatchup(line, matchup) {
    if (!matchup || !line) return false;
    const normalized = stripLineOddsSuffix(line).toLowerCase();
    const left = matchup.left.toLowerCase();
    const right = matchup.right.toLowerCase();
    if (normalized === left || normalized === right) return true;
    if (normalized.length > 0 && (left.includes(normalized) || right.includes(normalized))) {
      return normalized.length < Math.max(left.length, right.length);
    }
    return false;
  }

  function collapseLegLines(legLines, matchupFromLines) {
    if (!Array.isArray(legLines) || legLines.length === 0) return legLines;

    const matchup =
      matchupFromLines || legLines.map(parseMatchupLine).find(Boolean) || null;

    let cleaned = uniqueStrings(legLines.map(stripLineOddsSuffix).filter(Boolean));
    if (cleaned.length <= 1) return cleaned.length > 0 ? cleaned : legLines;

    const matchupLines = cleaned.filter(isMatchupOnlyLine);
    const pickLines = cleaned.filter((line) => !isMatchupOnlyLine(line));

    if (pickLines.length === 1 && matchupLines.length >= 1) {
      return pickLines;
    }

    if (pickLines.length === 0 && matchupLines.length === 1) {
      return matchupLines;
    }

    if (matchup && pickLines.length === 1 && matchupLines.length > 0) {
      cleaned = pickLines;
    }

    cleaned = cleaned.filter((line, index) => {
      const lower = line.toLowerCase();
      return !cleaned.some((other, otherIndex) => {
        if (index === otherIndex) return false;
        const otherLower = other.toLowerCase();
        return otherLower.includes(lower) && lower.length < otherLower.length * 0.85;
      });
    });

    if (matchup) {
      cleaned = cleaned.filter((line) => {
        if (!isMatchupOnlyLine(line)) return true;
        return !cleaned.some((other) => other !== line && lineContainedInMatchup(other, matchup));
      });
    }

    return cleaned.length > 0 ? cleaned : legLines;
  }

  function enrichLegWithMatchup(leg, matchup) {
    if (!matchup || !leg?.leg) return;
    const teams = deriveTeamContext(leg.selection, matchup);
    if (!teams.team) return;
    leg.leg.team = teams.team;
    leg.leg.opponent = teams.opponent;
    leg.leg.isGameProp = true;
    if (!leg.leg.statType || leg.leg.statType === 'sportsbook import') {
      leg.leg.statType = 'moneyline';
    }
    if (!leg.market || leg.market === 'sportsbook import') {
      leg.market = 'moneyline';
    }
  }

  function collapseParsedLegs(legs, matchup) {
    if (!Array.isArray(legs) || legs.length === 0) return legs;

    const fixture =
      matchup || legs.map((leg) => parseMatchupLine(leg.selection)).find(Boolean) || null;

    if (legs.length <= 1) {
      if (legs.length === 1) enrichLegWithMatchup(legs[0], fixture);
      return legs;
    }

    const matchupLegs = legs.filter((leg) => parseMatchupLine(leg.selection));
    const pickLegs = legs.filter((leg) => !parseMatchupLine(leg.selection));

    if (pickLegs.length === 1 && matchupLegs.length >= 1) {
      enrichLegWithMatchup(pickLegs[0], fixture || parseMatchupLine(matchupLegs[0].selection));
      return pickLegs;
    }

    if (pickLegs.length === 0 && matchupLegs.length === 1) {
      return matchupLegs;
    }

    const collapsed = legs.filter((leg, index) => {
      const lower = leg.selection.toLowerCase();
      return !legs.some((other, otherIndex) => {
        if (index === otherIndex) return false;
        const otherLower = other.selection.toLowerCase();
        return otherLower.includes(lower) && lower.length < otherLower.length * 0.85;
      });
    });

    if (collapsed.length === 1) {
      enrichLegWithMatchup(collapsed[0], fixture);
    }

    return collapsed;
  }

  function collectLegLines(lines, config) {
    const filtered = lines.filter((line) => !isNoiseLine(line, config));
    const combined = filtered.join(' ');
    const isMulti = isMultiBetText(combined);
    const matchup = filtered.map(parseMatchupLine).find(Boolean) || null;
    const selectionLines = filtered.filter((line) => looksLikeSelectionLine(line));
    const nonMatchupPicks = selectionLines.filter((line) => !isMatchupOnlyLine(line));
    const matchupForCollapse = nonMatchupPicks.length > 1 ? null : matchup;

    if (selectionLines.length > 0) {
      return collapseLegLines(selectionLines, matchupForCollapse);
    }

    const fallbackLimit = isMulti ? 24 : 3;
    return collapseLegLines(
      filtered.filter((line) => !isJunkSelection(line)).slice(0, fallbackLimit),
      matchupForCollapse
    );
  }

  function getCandidateContainers(config, root) {
    const scope = root && root.querySelectorAll ? root : document;
    const selectors = config.receiptSelectors || [];
    const elements = uniqueElements(
      selectors.flatMap((selector) => Array.from(scope.querySelectorAll(selector)))
    ).filter(isVisibleElement);

    return elements.filter((element) => {
      const text = getElementText(element);
      if (!text || text.length < 30) return false;
      if ((config.requiredTextPatterns || []).some((pattern) => !pattern.test(text))) return false;
      if (config.requireResulted) {
      const resultedCheck = config.relaxedResulted ? looksLikeResultedBetCard(text) : isResultedBetText(text);
      if (!resultedCheck) return false;
    }
      return true;
    });
  }

  function countLabelHits(text, pattern) {
    return (text.match(pattern) || []).length;
  }

  function countSubstantiveLegLines(lines, config) {
    return lines.filter(
      (line) => looksLikeSelectionLine(line) && !isGenericBetLabel(line) && !isNoiseLine(line, config)
    ).length;
  }

  function isAggregatorBetCard(text, lines, config) {
    const maxStakes = config.strictAggregation ? 2 : 4;
    const maxResults = config.strictAggregation ? 2 : 4;
    const maxLegs = config.strictAggregation ? 8 : 14;
    const maxChars = config.strictAggregation ? 950 : 1800;

    if (countLabelHits(text, /\b(stake|outlay|wager)\b/gi) > maxStakes) return true;
    if (countLabelHits(text, /\b(won|lost)\b/gi) > maxResults) return true;
    if (countSubstantiveLegLines(lines, config) > maxLegs) return true;
    if (text.length > maxChars) return true;
    return false;
  }

  function isPlausibleLegBundle(text, legs, betType) {
    if (legs.length <= 1) return true;
    if (legs.length > 24) return false;
    if (betType === 'parlay' || betType === 'same_game_multi') return true;
    if (isMultiBetText(text)) return true;
    if (/same game multi|sgm/i.test(text)) return true;
    if (/\b(parlay|multi|leg\s*\d+|standard multi|bet builder)\b/i.test(text)) return true;
    return legs.length <= 6;
  }

  function elementLooksLikeBetCard(element, config) {
    if (!(element instanceof HTMLElement) || !isVisibleElement(element)) return false;
    const text = getElementText(element);
    const maxChars = getConfigNumber(
      config,
      'maxCardChars',
      config.strictAggregation ? 950 : isMultiBetText(text) ? 4500 : 1400
    );
    if (!text || text.length < 30 || text.length > maxChars) return false;
    if (JUNK_SELECTION_PATTERNS.some((pattern) => pattern.test(text)) && !/(stake|outlay|wager)/i.test(text)) {
      return false;
    }
    if (config.requireResulted) {
      const resultedCheck = config.relaxedResulted ? looksLikeResultedBetCard(text) : isResultedBetText(text);
      if (!resultedCheck) return false;
    }

    const lines = getElementLines(element);
    if (isAggregatorBetCard(text, lines, config)) return false;

    const stake = extractStake(lines, text);
    const odds = extractOdds(lines, text);
    if (stake == null || odds == null || !isPlausibleStake(stake)) return false;
    if (!isPlausibleOdds(odds, text, config)) return false;

    const legLines = collectLegLines(lines, config);
    const substantiveLegs = legLines.filter(
      (line) => looksLikeSelectionLine(line) && !isGenericBetLabel(line)
    );
    const meaningfulLines = lines.filter((line) => {
      if (isNoiseLine(line, config) || isGenericBetLabel(line)) return false;
      if (/^(won|lost|void|refunded|stake|outlay|odds|pending|resulted)$/i.test(line)) return false;
      return line.length >= 3;
    });
    const hasSelection =
      substantiveLegs.length > 0 ||
      lines.some((line) => parseMatchupLine(line)) ||
      meaningfulLines.length > 0;
    if (!hasSelection) return false;

    const resultHits = (text.match(/\b(won|lost)\b/gi) || []).length;
    const maxResults = config.strictAggregation ? 2 : 3;
    if (config.requireResulted && resultHits === 0) return false;
    if (config.requireResulted && resultHits > maxResults) return false;

    return true;
  }

  function dedupeNestedContainers(elements) {
    return elements.filter((element, index) => {
      return !elements.some((other, otherIndex) => {
        if (index === otherIndex || element === other) return false;
        if (!element.contains(other)) return false;
        const elementText = getElementText(element);
        const otherText = getElementText(other);
        return otherText.length > 0 && otherText.length <= elementText.length;
      });
    });
  }

  function findHeuristicBetContainers(root, config) {
    const scope = root && root.querySelectorAll ? root : document;
    const selector =
      'article, li, section, div[data-automation-id], div[class*="bet"], div[class*="Bet"]';
    const matches = [];

    scope.querySelectorAll(selector).forEach((element) => {
      if (!elementLooksLikeBetCard(element, config)) return;
      matches.push(element);
    });

    return dedupeNestedContainers(uniqueElements(matches));
  }

  function collectBetCards(root, config) {
    const scope = root && root.querySelectorAll ? root : document;
    const selectorMatches = getCandidateContainers(config, scope);
    const heuristicMatches = findHeuristicBetContainers(scope, config);
    return dedupeNestedContainers(uniqueElements([...selectorMatches, ...heuristicMatches]));
  }

  function resolveBetContainers(config, context) {
    const root =
      typeof config.resolveRoot === 'function'
        ? config.resolveRoot(context)
        : config.root || document;

    if (typeof config.findContainers === 'function') {
      const custom = config.findContainers(context, root);
      if (Array.isArray(custom) && custom.length > 0) {
        return dedupeNestedContainers(uniqueElements(custom));
      }
    }

    return collectBetCards(root, config);
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

  function buildMultiSelectionSummary(text, legs) {
    const label = buildMultiLabel(text);
    const fixture = extractFixtureFromCardText(text);
    const substantive = (legs || []).filter((leg) => isSubstantiveLegSelection(leg.selection));

    if (label && fixture) return `${label} — ${fixture}`;
    if (label) return label;
    if (fixture) return fixture;

    if (substantive.length === 0) return null;

    const parts = substantive.map((leg) => leg.selection);
    if (parts.length === 1) return parts[0];
    return `Parlay: ${parts.join(' + ')}`;
  }

  function determineBetType(text, legs) {
    if (/same game multi|sgm/i.test(text)) return 'same_game_multi';
    if (isMultiBetText(text)) return 'parlay';

    const effectiveLegs = collapseParsedLegs(legs);
    if (effectiveLegs.length <= 1) return 'single';

    if (/\b(parlay|multi)\b/i.test(text) && !/same game multi|sgm/i.test(text)) {
      return 'parlay';
    }

    const fixtures = effectiveLegs
      .map((leg) => parseMatchupLine(leg.selection))
      .filter(Boolean)
      .map((matchup) => `${matchup.left}|${matchup.right}`.toLowerCase());
    if (new Set(fixtures).size > 1) return 'parlay';

    const picks = effectiveLegs.filter((leg) => !parseMatchupLine(leg.selection));
    if (picks.length > 1) {
      const distinct = picks.filter((leg, index) => {
        const lower = leg.selection.toLowerCase();
        return !picks.some((other, otherIndex) => {
          if (index === otherIndex) return false;
          const otherLower = other.selection.toLowerCase();
          return otherLower.includes(lower) && lower.length < otherLower.length * 0.85;
        });
      });
      if (distinct.length > 1) return 'parlay';
    }

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
    else if (isMultiBetText(candidate.text)) score += 1;
    else notes.push('missing selection');
    if (candidate.sport !== 'OTHER') score += 1;
    if (candidate.usedFallback) score -= 2;
    if (candidate.legs.length > 1) score += 1;
    if (candidate.placedDateIsFallback) {
      notes.push('date not found on bet card');
      score -= 1;
    } else {
      score += 1;
    }

    if (score >= 7) return 'high';
    if (score >= 4) return 'medium';
    return 'low';
  }

  function buildSingleSelection(leg, matchup) {
    if (!leg) return null;
    const selection = leg.selection;
    if (!matchup) return selection;
    if (parseMatchupLine(selection)) return selection;

    const teams = deriveTeamContext(selection, matchup);
    const fixture = `${matchup.left} v ${matchup.right}`;
    if (teams.team && selection.toLowerCase() === teams.team.toLowerCase()) {
      return `${teams.team} to win — ${fixture}`;
    }
    if (teams.team) {
      return `${selection} — ${fixture}`;
    }
    return `${selection} — ${fixture}`;
  }

  function buildSelectionFromLegs(legs, betType, matchup, cardText) {
    const card = cardText || '';
    const legList = Array.isArray(legs) ? legs : [];
    const substantive = legList.filter((leg) => isSubstantiveLegSelection(leg.selection));

    if (betType === 'same_game_multi' || betType === 'parlay' || isMultiBetText(card)) {
      const multiSummary = buildMultiSelectionSummary(card, substantive);
      if (multiSummary) return multiSummary;
    }

    if (substantive.length === 0) return null;

    if (betType === 'single') {
      return buildSingleSelection(substantive[0], matchup);
    }

    return `Parlay: ${substantive.map((leg) => leg.selection).join(' + ')}`;
  }

  function buildImportPayload(candidate, config) {
    const bookLabel = getBookLabel(config.bookKey);
    const matchup =
      candidate.matchup || candidate.lines.map(parseMatchupLine).find(Boolean) || null;
    const legs = collapseParsedLegs(candidate.legs, matchup);
    const betType = determineBetType(candidate.text, legs);
    const selection = buildSelectionFromLegs(legs, betType, matchup, candidate.text);
    if (
      !selection ||
      candidate.stake == null ||
      candidate.odds == null ||
      isJunkSelection(selection) ||
      !isSubstantiveSelection(selection) ||
      !isPlausibleStake(candidate.stake) ||
      !isPlausibleBetDate(candidate.placedDate) ||
      !isPlausibleOdds(candidate.odds, candidate.text, config)
    ) {
      return null;
    }

    if (
      betType !== 'single' &&
      legs.length === 1 &&
      isGenericBetLabel(legs[0].selection) &&
      !isMultiBetText(candidate.text)
    ) {
      return null;
    }

    if (
      betType === 'single' &&
      matchup &&
      !selection.includes('—') &&
      !/\s(?:v|vs)\s/i.test(selection) &&
      selection.length < 50
    ) {
      return null;
    }

    if (
      selection.length > 280 ||
      !isPlausibleLegBundle(candidate.text, legs, betType) ||
      isAggregatorBetCard(candidate.text, candidate.lines, config)
    ) {
      return null;
    }

    const primaryLeg = legs[0] || null;
    const matchupFixture = matchup ? `${matchup.left} v ${matchup.right}` : null;
    const fixture =
      extractFixtureFromLines(candidate.lines) ||
      (matchupFixture && isValidFixture(matchupFixture) ? matchupFixture : null) ||
      extractFixtureFromCardText(candidate.text);
    const multiLabel = buildMultiLabel(candidate.text);
    const notes = [...candidate.notes];
    const confidence = determineConfidence(
      {
        stake: candidate.stake,
        odds: candidate.odds,
        ticketId: candidate.ticketId,
        legs,
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
        candidate_leg_count: legs.length,
        extracted_legs: legs.map((leg) => leg.selection),
        placed_date: candidate.placedDate,
        placed_date_raw: candidate.placedDateRaw,
        placed_date_source: candidate.placedDateSource,
        placed_date_inferred: candidate.placedDateIsFallback,
        fixture,
        multi_label: multiLabel,
        display_title: buildDisplayTitle(multiLabel, fixture, selection),
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
        result: candidate.result || 'pending',
        status: candidate.status || 'pending',
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
              parlay_legs: legs.map((leg) => leg.leg),
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
    const placedDateInfo = extractPlacedDate(lines, text, element, config);
    const placedDate = placedDateInfo.iso;
    const sport = detectSport(text);
    const ticketId = extractTicketId(lines, text);
    const stake = extractStake(lines, text);
    let odds = extractOdds(lines, text);
    const outcome = extractResult(lines, text);
    const legLines = collectLegLines(lines, config);
    let usedFallback = false;
    const notes = [];

    let legs = legLines
      .map((line) => parseSelectionLine(line, matchup, placedDate))
      .filter((leg) => leg && isSubstantiveLegSelection(leg.selection));

    if (legs.length === 0 && lines.length > 0 && !isMultiBetText(text)) {
      usedFallback = true;
      notes.push('used fallback line selection');
      const fallbackLine = lines.find(
        (line) => !isNoiseLine(line, config) && looksLikeSelectionLine(line)
      );
      const fallback = parseSelectionLine(fallbackLine || '', matchup, placedDate);
      if (fallback && isSubstantiveLegSelection(fallback.selection)) {
        legs = [fallback];
      }
    }

    legs = dedupeLegs(legs);
    legs = collapseParsedLegs(legs, matchup);

    if (odds == null && legs.length === 1 && legs[0].lineOdds != null) {
      odds = legs[0].lineOdds;
    }

    return {
      selector,
      text,
      lines,
      matchup,
      placedDate,
      placedDateRaw: placedDateInfo.raw,
      placedDateSource: placedDateInfo.source,
      placedDateIsFallback: placedDateInfo.isFallback,
      sport,
      ticketId,
      stake,
      odds,
      legs,
      usedFallback,
      notes,
      result: outcome.result,
      status: outcome.status,
    };
  }

  function createBookParser(config) {
    return {
      parsePage(context) {
        const requireResulted =
          context.requireResulted === true ||
          (typeof config.requireResulted === 'function'
            ? config.requireResulted(context)
            : config.requireResulted === true);
        const scopedConfig = {
          ...config,
          requireResulted,
          relaxedResulted: config.relaxedResulted === true,
          strictAggregation: config.strictAggregation === true,
        };

        let payloads = [];
        if (typeof config.findParseableElements === 'function') {
          const root =
            typeof config.resolveRoot === 'function'
              ? config.resolveRoot(context)
              : document.body;
          payloads = config.findParseableElements(root, context, scopedConfig);
        }

        if (payloads.length === 0) {
          const elements = resolveBetContainers(scopedConfig, context);
          payloads = elements
            .map((element) => tryBuildPayloadFromElement(element, scopedConfig))
            .filter(Boolean);
        }

        const ranked = payloads.sort((a, b) => {
          const rank = { high: 3, medium: 2, low: 1 };
          return rank[b.parse_confidence] - rank[a.parse_confidence];
        });

        if (context.parseAll === true) {
          const minConfidence = context.minConfidence || 'low';
          const rank = { high: 3, medium: 2, low: 1 };
          const minRank = rank[minConfidence] || 1;
          return ranked.filter((candidate) => rank[candidate.parse_confidence] >= minRank);
        }

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
      parseAll: options?.parseAll === true,
      requireResulted: options?.requireResulted === true,
      minConfidence: options?.minConfidence || 'low',
    });
    if (!Array.isArray(payloads) || payloads.length === 0) {
      throw new Error(
        'Could not find individual resulted bets on this page. Open My Bets → Resulted, scroll to load your history, then try again.'
      );
    }
    return payloads;
  }

  function dedupePayloads(payloads) {
    const kept = [];

    for (const payload of payloads) {
      if (!payload?.bet) continue;

      const ticketId = normalizeText(payload.source_external_id || '');
      if (ticketId) {
        const ticketKey = `${payload.source_book || ''}|${ticketId}`;
        const ticketIndex = kept.findIndex(
          (existing) => `${existing.source_book || ''}|${normalizeText(existing.source_external_id || '')}` === ticketKey
        );
        if (ticketIndex >= 0) {
          if (scorePayloadQuality(payload) > scorePayloadQuality(kept[ticketIndex])) {
            kept[ticketIndex] = payload;
          }
        } else {
          kept.push(payload);
        }
        continue;
      }

      const duplicateIndex = kept.findIndex((existing) => payloadsAreLikelyDuplicates(existing, payload));
      if (duplicateIndex >= 0) {
        if (scorePayloadQuality(payload) > scorePayloadQuality(kept[duplicateIndex])) {
          kept[duplicateIndex] = payload;
        }
      } else {
        kept.push(payload);
      }
    }

    return kept;
  }

  function createVirtualBetElement(text) {
    const element = document.createElement('div');
    element.textContent = text;
    return element;
  }

  globalThis[GLOBAL_KEY] = {
    BOOK_LABELS,
    createBookParser,
    buildImportPayloads,
    dedupePayloads,
    getBookKey,
    getBookLabel,
    normalizeText,
    registerParser,
    isResultedBetText,
    looksLikeResultedBetCard,
    findHeuristicBetContainers,
    collectBetCards,
    createVirtualBetElement,
    tryBuildPayloadFromElement,
    findParseableBetElements,
  };
})();
