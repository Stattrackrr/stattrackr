import { nbaShotDistanceFt, nbaShotZone } from '../shotZones';

type Obj = Record<string, any>;

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const int = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};

/** Non-shot plays carry an int32-min placeholder instead of null; keep only on-court feet. */
const coord = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n >= -10 && n <= 100 ? n : null;
};

/** BDL minutes come as "25", "25:30" or "00". */
export function parseBdlMinutes(v: unknown): number | null {
  if (v == null || v === '') return null;
  const s = String(v);
  if (s.includes(':')) {
    const [m, sec] = s.split(':');
    const mm = Number(m);
    const ss = Number(sec);
    if (!Number.isFinite(mm)) return null;
    return Math.round((mm + (Number.isFinite(ss) ? ss / 60 : 0)) * 100) / 100;
  }
  return num(s);
}

export function mapTeam(t: Obj) {
  return {
    id: t.id,
    abbreviation: t.abbreviation,
    full_name: t.full_name,
    city: t.city || null,
    name: t.name || null,
    conference: t.conference?.trim() || null,
    division: t.division?.trim() || null,
    updated_at: new Date().toISOString(),
  };
}

export function mapPlayer(p: Obj, opts: { active: boolean; nbaPersonId?: number | null }) {
  const first = String(p.first_name ?? '').trim();
  const last = String(p.last_name ?? '').trim();
  return {
    id: p.id,
    first_name: first,
    last_name: last,
    full_name: `${first} ${last}`.trim(),
    position: p.position || null,
    height: p.height || null,
    weight: p.weight || null,
    jersey_number: p.jersey_number || null,
    college: p.college || null,
    country: p.country || null,
    draft_year: int(p.draft_year),
    draft_round: int(p.draft_round),
    draft_number: int(p.draft_number),
    team_id: p.team?.id ?? p.team_id ?? null,
    is_active: opts.active,
    nba_person_id: opts.nbaPersonId ?? null,
    updated_at: new Date().toISOString(),
  };
}

export function mapGame(g: Obj) {
  const q = (side: 'home' | 'visitor', k: string) => int(g[`${side}_${k}`]);
  return {
    id: g.id,
    season: g.season,
    game_date: String(g.date).slice(0, 10),
    tipoff_at: g.datetime || null,
    status: g.status ?? null,
    status_state: g.status_state ?? null,
    period: int(g.period),
    postseason: !!g.postseason,
    postponed: !!g.postponed,
    ist_stage: g.ist_stage ?? null,
    home_team_id: g.home_team?.id ?? g.home_team_id,
    visitor_team_id: g.visitor_team?.id ?? g.visitor_team_id,
    home_score: int(g.home_team_score),
    visitor_score: int(g.visitor_team_score),
    home_q1: q('home', 'q1'), home_q2: q('home', 'q2'), home_q3: q('home', 'q3'), home_q4: q('home', 'q4'),
    home_ot1: q('home', 'ot1'), home_ot2: q('home', 'ot2'), home_ot3: q('home', 'ot3'),
    visitor_q1: q('visitor', 'q1'), visitor_q2: q('visitor', 'q2'), visitor_q3: q('visitor', 'q3'), visitor_q4: q('visitor', 'q4'),
    visitor_ot1: q('visitor', 'ot1'), visitor_ot2: q('visitor', 'ot2'), visitor_ot3: q('visitor', 'ot3'),
    updated_at: new Date().toISOString(),
  };
}

/** Team/opponent/home come from the game, never player.team_id (that is the player's current team). */
function gameSide(row: Obj) {
  const g = row.game ?? {};
  const teamId: number = row.team?.id;
  const homeId: number = g.home_team_id ?? g.home_team?.id;
  const visitorId: number = g.visitor_team_id ?? g.visitor_team?.id;
  const isHome = teamId === homeId;
  return {
    season: g.season as number,
    game_date: String(g.date).slice(0, 10),
    postseason: !!g.postseason,
    team_id: teamId,
    opponent_team_id: isHome ? visitorId : homeId,
    is_home: isHome,
  };
}

export function mapPlayerGameStat(row: Obj, period: number) {
  const side = gameSide(row);
  return {
    game_id: row.game?.id,
    player_id: row.player?.id,
    period,
    ...side,
    minutes: parseBdlMinutes(row.min),
    pts: int(row.pts), reb: int(row.reb), oreb: int(row.oreb), dreb: int(row.dreb), ast: int(row.ast),
    stl: int(row.stl), blk: int(row.blk), turnover: int(row.turnover), pf: int(row.pf),
    fgm: int(row.fgm), fga: int(row.fga), fg3m: int(row.fg3m), fg3a: int(row.fg3a), ftm: int(row.ftm), fta: int(row.fta),
    plus_minus: int(row.plus_minus),
    updated_at: new Date().toISOString(),
  };
}

export function mapPlayerGameAdvanced(row: Obj) {
  const { season, game_date, team_id, opponent_team_id } = gameSide(row);
  const { player: _p, team: _t, game: _g, ...raw } = row;
  return {
    game_id: row.game?.id,
    player_id: row.player?.id,
    season,
    game_date,
    team_id,
    opponent_team_id,
    usage_pct: num(row.usage_percentage),
    ts_pct: num(row.true_shooting_percentage),
    efg_pct: num(row.effective_field_goal_percentage),
    pace: num(row.pace),
    possessions: num(row.possessions),
    offensive_rating: num(row.offensive_rating),
    defensive_rating: num(row.defensive_rating),
    net_rating: num(row.net_rating),
    pie: num(row.pie),
    touches: int(row.touches),
    passes: int(row.passes),
    secondary_assists: int(row.secondary_assists),
    free_throw_assists: int(row.free_throw_assists),
    rebound_chances_total: int(row.rebound_chances_total),
    rebound_chances_off: int(row.rebound_chances_off),
    rebound_chances_def: int(row.rebound_chances_def),
    contested_fga: int(row.contested_fga),
    uncontested_fga: int(row.uncontested_fga),
    deflections: int(row.deflections),
    screen_assists: int(row.screen_assists),
    points_paint: int(row.points_paint),
    points_fast_break: int(row.points_fast_break),
    points_second_chance: int(row.points_second_chance),
    points_off_turnovers: int(row.points_off_turnovers),
    distance: num(row.distance),
    speed: num(row.speed),
    raw,
    updated_at: new Date().toISOString(),
  };
}

export type GameContext = {
  id: number;
  season: number;
  game_date: string;
  home_team_id: number;
  visitor_team_id: number;
};

export function mapPlay(p: Obj, game: GameContext) {
  return {
    game_id: game.id,
    play_order: p.order,
    season: game.season,
    period: int(p.period),
    clock: p.clock ?? null,
    type: p.type ?? null,
    text: p.text ?? null,
    team_id: p.team?.id ?? null,
    participants: Array.isArray(p.participants) ? p.participants : null,
    scoring_play: p.scoring_play ?? null,
    shooting_play: p.shooting_play ?? null,
    score_value: int(p.score_value),
    home_score: int(p.home_score),
    away_score: int(p.away_score),
    coordinate_x: coord(p.coordinate_x),
    coordinate_y: coord(p.coordinate_y),
    wallclock: p.wallclock || null,
  };
}

export function isFieldGoalAttempt(p: Obj): boolean {
  return !!p.shooting_play && !/free throw/i.test(String(p.type ?? '')) && Array.isArray(p.participants) && p.participants.length > 0;
}

/** Field-goal attempt → nba_shots row. Assister only on makes whose text credits one. */
export function mapShot(p: Obj, game: GameContext) {
  const teamId: number | null = p.team?.id ?? null;
  if (teamId == null) return null;
  const text = String(p.text ?? '');
  const made = !!p.scoring_play;
  const isThree = /three point/i.test(text) || int(p.score_value) === 3;
  const x = coord(p.coordinate_x);
  const y = coord(p.coordinate_y);
  const hasXY = x != null && y != null;
  return {
    game_id: game.id,
    play_order: p.order,
    season: game.season,
    game_date: game.game_date,
    team_id: teamId,
    opponent_team_id: teamId === game.home_team_id ? game.visitor_team_id : game.home_team_id,
    shooter_id: p.participants[0],
    assister_id: made && /assist/i.test(text) && p.participants[1] != null ? p.participants[1] : null,
    period: int(p.period),
    clock: p.clock ?? null,
    shot_type: p.type ?? null,
    made,
    is_three: isThree,
    x,
    y,
    distance_ft: hasXY ? Math.round(nbaShotDistanceFt(x, y) * 10) / 10 : null,
    zone: hasXY ? nbaShotZone(x, y, isThree) : null,
  };
}

export function mapLineup(r: Obj) {
  return {
    game_id: r.game_id,
    player_id: r.player?.id,
    team_id: r.team?.id,
    starter: !!r.starter,
    position: r.position || null,
  };
}

export function mapInjury(r: Obj) {
  return {
    player_id: r.player?.id,
    team_id: r.player?.team_id ?? null,
    status: r.status ?? null,
    return_date: r.return_date ?? null,
    description: r.description ?? null,
    updated_at: new Date().toISOString(),
  };
}

export function mapStanding(r: Obj) {
  return {
    season: r.season,
    team_id: r.team?.id,
    wins: int(r.wins),
    losses: int(r.losses),
    conference_rank: int(r.conference_rank),
    division_rank: int(r.division_rank),
    conference_record: r.conference_record ?? null,
    division_record: r.division_record ?? null,
    home_record: r.home_record ?? null,
    road_record: r.road_record ?? null,
    updated_at: new Date().toISOString(),
  };
}
