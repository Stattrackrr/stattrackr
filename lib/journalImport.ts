export const VALID_RESULTS = new Set(['pending', 'win', 'loss', 'void']);
export const VALID_STATUSES = new Set(['pending', 'live', 'completed']);
export const VALID_OVER_UNDER = new Set(['over', 'under']);
export const IMPORT_REVIEW_STATUSES = new Set([
  'pending_review',
  'approved',
  'rejected',
  'duplicate',
  'failed',
]);

export type ImportReviewStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'duplicate'
  | 'failed';

export type ImportConfidence = 'high' | 'medium' | 'low';
export type ImportedBetType = 'single' | 'parlay' | 'same_game_multi' | 'unknown';

export type SourceBook =
  | 'sportsbet'
  | 'tab'
  | 'neds'
  | 'ladbrokes'
  | 'bet365_au'
  | 'unknown';

export type JournalParlayLegInput = {
  playerName?: string | null;
  playerId?: string | null;
  team?: string | null;
  opponent?: string | null;
  gameDate?: string | null;
  overUnder?: 'over' | 'under' | null;
  line?: number | string | null;
  statType?: string | null;
  isGameProp?: boolean | null;
  won?: boolean | null;
  void?: boolean | null;
};

export type JournalBetInput = {
  date: string;
  sport: string;
  market?: string | null;
  selection: string;
  stake: number | string;
  currency: string;
  odds: number | string;
  result?: 'pending' | 'win' | 'loss' | 'void' | null;
  status?: 'pending' | 'live' | 'completed' | null;
  bookmaker?: string | null;
  player_id?: string | null;
  player_name?: string | null;
  team?: string | null;
  opponent?: string | null;
  stat_type?: string | null;
  line?: number | string | null;
  over_under?: 'over' | 'under' | null;
  game_date?: string | null;
  parlay_legs?: JournalParlayLegInput[] | null;
};

export type SportsbookImportPayload = {
  source?: string | null;
  source_book: string;
  source_external_id?: string | null;
  source_page_url?: string | null;
  captured_at?: string | null;
  auto_add?: boolean | null;
  parser_name?: string | null;
  parse_confidence?: ImportConfidence | null;
  bet_type?: ImportedBetType | null;
  parse_notes?: string | null;
  bet: JournalBetInput;
  raw_payload?: Record<string, unknown> | null;
};

export type NormalizedImportRecord = {
  source: string;
  sourceBook: SourceBook;
  sourceExternalId: string | null;
  sourcePageUrl: string | null;
  capturedAt: string;
  autoAdd: boolean;
  parserName: string | null;
  parseConfidence: ImportConfidence;
  betType: ImportedBetType;
  parseNotes: string | null;
  rawPayload: Record<string, unknown> | null;
  normalizedBet: JournalBetInput;
  dedupeKey: string;
};

export type BetInsertMetadata = {
  source?: string | null;
  sourceBook?: string | null;
  sourceExternalId?: string | null;
  importBatchId?: string | null;
  capturedAt?: string | null;
};

function normalizeImportConfidence(value: unknown): ImportConfidence {
  const normalized = asOptionalTrimmedString(value)?.toLowerCase();
  if (normalized === 'high') return 'high';
  if (normalized === 'low') return 'low';
  return 'medium';
}

function normalizeImportedBetType(value: unknown): ImportedBetType {
  const normalized = asOptionalTrimmedString(value)?.toLowerCase();
  if (normalized === 'single') return 'single';
  if (normalized === 'parlay') return 'parlay';
  if (normalized === 'same_game_multi') return 'same_game_multi';
  if (normalized === 'same game multi') return 'same_game_multi';
  return 'unknown';
}

function serializeParlayLegsForDedupe(legs: JournalBetInput['parlay_legs']) {
  if (!Array.isArray(legs) || legs.length === 0) return '';

  return legs
    .map((leg) =>
      [
        leg?.playerName ?? '',
        leg?.playerId ?? '',
        leg?.team ?? '',
        leg?.opponent ?? '',
        leg?.gameDate ?? '',
        leg?.overUnder ?? '',
        leg?.line === null || leg?.line === undefined ? '' : String(leg.line),
        leg?.statType ?? '',
        leg?.isGameProp === true ? 'game' : leg?.isGameProp === false ? 'player' : '',
      ].join('|')
    )
    .join('||')
    .toLowerCase();
}

function normalizeIsoDate(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be a valid date`);
  }

  return parsed.toISOString().slice(0, 10);
}

export function asOptionalTrimmedString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function asRequiredTrimmedString(value: unknown, field: string): string {
  const normalized = asOptionalTrimmedString(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

export function asFiniteNumber(value: unknown, field: string): number {
  const normalized =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  if (!Number.isFinite(normalized)) {
    throw new Error(`${field} must be a valid number`);
  }
  return normalized;
}

export function sanitizeParlayLegs(value: unknown) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) {
    throw new Error('parlay_legs must be an array');
  }

  return value.map((leg, index) => {
    if (!leg || typeof leg !== 'object') {
      throw new Error(`parlay_legs[${index}] must be an object`);
    }

    const record = leg as Record<string, unknown>;
    const overUnder = asOptionalTrimmedString(record.overUnder);
    if (overUnder && !VALID_OVER_UNDER.has(overUnder)) {
      throw new Error(`parlay_legs[${index}].overUnder must be over or under`);
    }

    const lineValue = record.line;
    const normalizedLine =
      lineValue === null || lineValue === undefined || lineValue === ''
        ? null
        : asFiniteNumber(lineValue, `parlay_legs[${index}].line`);

    const wonValue = record.won;
    const normalizedWon =
      wonValue === null || wonValue === undefined ? null : Boolean(wonValue);

    const voidValue = record.void;
    const normalizedVoid =
      voidValue === null || voidValue === undefined ? null : Boolean(voidValue);

    return {
      playerName: asOptionalTrimmedString(record.playerName),
      playerId: asOptionalTrimmedString(record.playerId),
      team: asOptionalTrimmedString(record.team),
      opponent: asOptionalTrimmedString(record.opponent),
      gameDate: asOptionalTrimmedString(record.gameDate),
      overUnder: overUnder as 'over' | 'under' | null,
      line: normalizedLine,
      statType: asOptionalTrimmedString(record.statType),
      isGameProp: typeof record.isGameProp === 'boolean' ? record.isGameProp : null,
      won: normalizedWon,
      void: normalizedVoid,
    };
  });
}

export function normalizeSourceBook(value: unknown): SourceBook {
  const normalized = asOptionalTrimmedString(value)?.toLowerCase() ?? '';
  if (normalized === 'sportsbet') return 'sportsbet';
  if (normalized === 'tab') return 'tab';
  if (normalized === 'neds') return 'neds';
  if (normalized === 'ladbrokes') return 'ladbrokes';
  if (normalized === 'bet365' || normalized === 'bet365 au' || normalized === 'bet365_au') {
    return 'bet365_au';
  }
  return 'unknown';
}

export function sourceBookLabel(value: string | null | undefined): string {
  const book = normalizeSourceBook(value);
  switch (book) {
    case 'sportsbet':
      return 'Sportsbet';
    case 'tab':
      return 'TAB';
    case 'neds':
      return 'Neds';
    case 'ladbrokes':
      return 'Ladbrokes';
    case 'bet365_au':
      return 'bet365 AU';
    default:
      return 'Unknown';
  }
}

export function buildSelectionLabel(bet: Partial<JournalBetInput>): string {
  const explicit = asOptionalTrimmedString(bet.selection);
  if (explicit) return explicit;

  const playerName = asOptionalTrimmedString(bet.player_name);
  const overUnder = asOptionalTrimmedString(bet.over_under);
  const line = bet.line;
  const statType = asOptionalTrimmedString(bet.stat_type);

  const parts = [
    playerName,
    overUnder,
    line === null || line === undefined || line === '' ? null : String(line),
    statType,
  ].filter(Boolean);

  if (parts.length > 0) {
    return parts.join(' ');
  }

  return asRequiredTrimmedString(bet.market, 'selection');
}

export function normalizeJournalBetInput(bet: Record<string, unknown>): JournalBetInput {
  const result = asOptionalTrimmedString(bet.result) ?? 'pending';
  if (!VALID_RESULTS.has(result)) {
    throw new Error('result must be pending, win, loss, or void');
  }

  const status = asOptionalTrimmedString(bet.status) ?? 'pending';
  if (!VALID_STATUSES.has(status)) {
    throw new Error('status must be pending, live, or completed');
  }

  const overUnder = asOptionalTrimmedString(bet.over_under);
  if (overUnder && !VALID_OVER_UNDER.has(overUnder)) {
    throw new Error('over_under must be over or under');
  }

  const lineValue = bet.line;
  const line =
    lineValue === null || lineValue === undefined || lineValue === ''
      ? null
      : asFiniteNumber(lineValue, 'line');

  const normalizedDate = normalizeIsoDate(asRequiredTrimmedString(bet.date, 'date'), 'date');
  const normalizedGameDate = asOptionalTrimmedString(bet.game_date)
    ? normalizeIsoDate(asRequiredTrimmedString(bet.game_date, 'game_date'), 'game_date')
    : null;

  const normalized: JournalBetInput = {
    date: normalizedDate,
    sport: asRequiredTrimmedString(bet.sport, 'sport').toUpperCase(),
    market: asOptionalTrimmedString(bet.market),
    selection: buildSelectionLabel(bet),
    stake: asFiniteNumber(bet.stake, 'stake'),
    currency: asRequiredTrimmedString(bet.currency, 'currency').toUpperCase(),
    odds: asFiniteNumber(bet.odds, 'odds'),
    result: result as 'pending' | 'win' | 'loss' | 'void',
    status: status as 'pending' | 'live' | 'completed',
    bookmaker: asOptionalTrimmedString(bet.bookmaker),
    player_id: asOptionalTrimmedString(bet.player_id),
    player_name: asOptionalTrimmedString(bet.player_name),
    team: asOptionalTrimmedString(bet.team),
    opponent: asOptionalTrimmedString(bet.opponent),
    stat_type: asOptionalTrimmedString(bet.stat_type),
    line,
    over_under: overUnder as 'over' | 'under' | null,
    game_date: normalizedGameDate,
    parlay_legs: sanitizeParlayLegs(bet.parlay_legs),
  };

  return normalized;
}

export function buildBetInsertPayload(
  bet: Record<string, unknown>,
  userId: string,
  metadata: BetInsertMetadata = {}
) {
  const normalized = normalizeJournalBetInput(bet);

  return {
    user_id: userId,
    date: normalized.date,
    sport: normalized.sport,
    market: normalized.market ?? null,
    selection: normalized.selection,
    stake: Number(normalized.stake),
    currency: normalized.currency,
    odds: Number(normalized.odds),
    result: normalized.result ?? 'pending',
    status: normalized.status ?? 'pending',
    bookmaker: normalized.bookmaker ?? null,
    player_id: normalized.player_id ?? null,
    player_name: normalized.player_name ?? null,
    team: normalized.team ?? null,
    opponent: normalized.opponent ?? null,
    stat_type: normalized.stat_type ?? null,
    line: normalized.line ?? null,
    over_under: normalized.over_under ?? null,
    game_date: normalized.game_date ?? null,
    parlay_legs: normalized.parlay_legs ?? null,
    source: asOptionalTrimmedString(metadata.source) ?? 'manual',
    source_book: asOptionalTrimmedString(metadata.sourceBook),
    source_external_id: asOptionalTrimmedString(metadata.sourceExternalId),
    import_batch_id: asOptionalTrimmedString(metadata.importBatchId),
    captured_at: asOptionalTrimmedString(metadata.capturedAt),
  };
}

export function buildImportDedupeKey(record: {
  sourceBook: string;
  sourceExternalId?: string | null;
  normalizedBet: JournalBetInput;
}) {
  const explicitId = asOptionalTrimmedString(record.sourceExternalId);
  if (explicitId) {
    return `${record.sourceBook}|${explicitId}`;
  }

  const bet = record.normalizedBet;
  const parts = [
    record.sourceBook,
    bet.date,
    bet.sport,
    bet.market ?? '',
    bet.selection,
    String(bet.stake),
    bet.currency,
    String(bet.odds),
    bet.bookmaker ?? '',
    bet.team ?? '',
    bet.opponent ?? '',
    bet.player_name ?? '',
    bet.stat_type ?? '',
    bet.line === null || bet.line === undefined ? '' : String(bet.line),
    bet.over_under ?? '',
    serializeParlayLegsForDedupe(bet.parlay_legs ?? null),
  ];
  return parts.join('|').toLowerCase();
}

export function normalizeSportsbookImportPayload(payload: Record<string, unknown>): NormalizedImportRecord {
  const sourceBook = normalizeSourceBook(payload.source_book);
  const betValue = payload.bet;
  if (!betValue || typeof betValue !== 'object') {
    throw new Error('bet is required');
  }

  const normalizedBet = normalizeJournalBetInput(betValue as Record<string, unknown>);
  const capturedAtRaw = asOptionalTrimmedString(payload.captured_at);
  const capturedAt =
    capturedAtRaw && !Number.isNaN(new Date(capturedAtRaw).getTime())
      ? new Date(capturedAtRaw).toISOString()
      : new Date().toISOString();

  const source = asOptionalTrimmedString(payload.source) ?? 'extension';
  const sourceExternalId = asOptionalTrimmedString(payload.source_external_id);
  const sourcePageUrl = asOptionalTrimmedString(payload.source_page_url);
  const autoAdd = payload.auto_add === true;
  const parserName = asOptionalTrimmedString(payload.parser_name);
  const parseConfidence = normalizeImportConfidence(payload.parse_confidence);
  const betType = normalizeImportedBetType(payload.bet_type);
  const parseNotes = asOptionalTrimmedString(payload.parse_notes);
  const rawPayloadBase =
    payload.raw_payload && typeof payload.raw_payload === 'object'
      ? (payload.raw_payload as Record<string, unknown>)
      : {};
  const rawPayload = {
    ...rawPayloadBase,
    parser_name: parserName,
    parser_confidence: parseConfidence,
    bet_type: betType,
  };

  return {
    source,
    sourceBook,
    sourceExternalId,
    sourcePageUrl,
    capturedAt,
    autoAdd,
    parserName,
    parseConfidence,
    betType,
    parseNotes,
    rawPayload,
    normalizedBet: {
      ...normalizedBet,
      bookmaker: normalizedBet.bookmaker ?? sourceBookLabel(sourceBook),
    },
    dedupeKey: buildImportDedupeKey({
      sourceBook,
      sourceExternalId,
      normalizedBet: {
        ...normalizedBet,
        bookmaker: normalizedBet.bookmaker ?? sourceBookLabel(sourceBook),
      },
    }),
  };
}
