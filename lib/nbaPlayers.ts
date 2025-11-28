// NBA players utilities and data
export interface NBAPlayer {
  id: string;
  full: string;
  firstName: string;
  lastName: string;
  teamAbbr: string;
  position: string;
  jersey: number;
  heightFeet?: number;
  heightInches?: number;
  weight?: number;
  college?: string;
}

// Sample players data with correct Ball Don't Lie API IDs
export const SAMPLE_PLAYERS: NBAPlayer[] = [
  {
    id: '19',  // Ball Don't Lie API ID for Stephen Curry
    full: 'Stephen Curry',
    firstName: 'Stephen',
    lastName: 'Curry',
    teamAbbr: 'GSW',
    position: 'PG',
    jersey: 30,
    heightFeet: 6,
    heightInches: 2,
    weight: 185,
    college: 'Davidson'
  },
  {
    id: '237',  // Ball Don't Lie API ID for LeBron James
    full: 'LeBron James',
    firstName: 'LeBron',
    lastName: 'James',
    teamAbbr: 'LAL',
    position: 'SF',
    jersey: 23,
    heightFeet: 6,
    heightInches: 9,
    weight: 250,
    college: 'None'
  },
  {
    id: '140',  // Ball Don't Lie API ID for Kevin Durant
    full: 'Kevin Durant',
    firstName: 'Kevin',
    lastName: 'Durant',
    teamAbbr: 'HOU',
    position: 'SF',
    jersey: 35,
    heightFeet: 6,
    heightInches: 10,
    weight: 240,
    college: 'Texas'
  },
  {
    id: '15',  // Ball Don't Lie API ID for Giannis
    full: 'Giannis Antetokounmpo',
    firstName: 'Giannis',
    lastName: 'Antetokounmpo',
    teamAbbr: 'MIL',
    position: 'PF',
    jersey: 34,
    heightFeet: 6,
    heightInches: 11,
    weight: 242,
    college: 'None'
  },
  {
    id: '11',  // Ball Don't Lie API ID for Jayson Tatum
    full: 'Jayson Tatum',
    firstName: 'Jayson',
    lastName: 'Tatum',
    teamAbbr: 'BOS',
    position: 'SF',
    jersey: 0,
    heightFeet: 6,
    heightInches: 8,
    weight: 210,
    college: 'Duke'
  },
  {
    id: '154',  // Ball Don't Lie API ID for Damian Lillard
    full: 'Damian Lillard',
    firstName: 'Damian',
    lastName: 'Lillard',
    teamAbbr: 'MIL',
    position: 'PG',
    jersey: 0,
    heightFeet: 6,
    heightInches: 2,
    weight: 195,
    college: 'Weber State'
  },
  {
    id: '107',  // Ball Don't Lie API ID for Jaylen Brown
    full: 'Jaylen Brown',
    firstName: 'Jaylen',
    lastName: 'Brown',
    teamAbbr: 'BOS',
    position: 'SG',
    jersey: 7,
    heightFeet: 6,
    heightInches: 6,
    weight: 223,
    college: 'Georgia'
  },
  {
    id: '462',  // Ball Don't Lie API ID for Trae Young
    full: 'Trae Young',
    firstName: 'Trae',
    lastName: 'Young',
    teamAbbr: 'ATL',
    position: 'PG',
    jersey: 11,
    heightFeet: 6,
    heightInches: 1,
    weight: 164,
    college: 'Oklahoma'
  },
  {
    id: '246',  // Ball Don't Lie API ID for De'Aaron Fox
    full: 'De\'Aaron Fox',
    firstName: 'De\'Aaron',
    lastName: 'Fox',
    teamAbbr: 'SAC',
    position: 'PG',
    jersey: 5,
    heightFeet: 6,
    heightInches: 3,
    weight: 185,
    college: 'Kentucky'
  },
  {
    id: '132',  // Ball Don't Lie API ID for Luka Doncic
    full: 'Luka Doncic',
    firstName: 'Luka',
    lastName: 'Doncic',
    teamAbbr: 'DAL',
    position: 'PG',
    jersey: 77,
    heightFeet: 6,
    heightInches: 7,
    weight: 230,
    college: 'None'
  },
  {
    id: '285',  // Ball Don't Lie API ID for Nikola Jokic
    full: 'Nikola Jokic',
    firstName: 'Nikola',
    lastName: 'Jokic',
    teamAbbr: 'DEN',
    position: 'C',
    jersey: 15,
    heightFeet: 6,
    heightInches: 11,
    weight: 284,
    college: 'None'
  },
  {
    id: '52',  // Ball Don't Lie API ID for Anthony Edwards
    full: 'Anthony Edwards',
    firstName: 'Anthony',
    lastName: 'Edwards',
    teamAbbr: 'MIN',
    position: 'SG',
    jersey: 5,
    heightFeet: 6,
    heightInches: 4,
    weight: 225,
    college: 'Georgia'
  },
  {
    id: '270',  // Ball Don't Lie API ID for Ja Morant
    full: 'Ja Morant',
    firstName: 'Ja',
    lastName: 'Morant',
    teamAbbr: 'MEM',
    position: 'PG',
    jersey: 12,
    heightFeet: 6,
    heightInches: 3,
    weight: 174,
    college: 'Murray State'
  },
  {
    id: '213',  // Ball Don't Lie API ID for Tyrese Haliburton
    full: 'Tyrese Haliburton',
    firstName: 'Tyrese',
    lastName: 'Haliburton',
    teamAbbr: 'IND',
    position: 'PG',
    jersey: 0,
    heightFeet: 6,
    heightInches: 5,
    weight: 185,
    college: 'Iowa State'
  },
  {
    id: '192',  // Ball Don't Lie API ID for Shai Gilgeous-Alexander
    full: 'Shai Gilgeous-Alexander',
    firstName: 'Shai',
    lastName: 'Gilgeous-Alexander',
    teamAbbr: 'OKC',
    position: 'SG',
    jersey: 2,
    heightFeet: 6,
    heightInches: 6,
    weight: 180,
    college: 'Kentucky'
  },
  {
    id: '666',  // Ball Don't Lie API ID for Victor Wembanyama
    full: 'Victor Wembanyama',
    firstName: 'Victor',
    lastName: 'Wembanyama',
    teamAbbr: 'SAS',
    position: 'C',
    jersey: 1,
    heightFeet: 7,
    heightInches: 4,
    weight: 210,
    college: 'None'
  },
  {
    id: '1028028405',  // Ball Don't Lie API ID for Alexandre Sarr
    full: 'Alexandre Sarr',
    firstName: 'Alexandre',
    lastName: 'Sarr',
    teamAbbr: 'WAS',
    position: 'C',
    jersey: 25,
    heightFeet: 7,
    heightInches: 1,
    weight: 217,
    college: 'None'
  },
  {
    id: '666508',  // Ball Don't Lie API ID for Nicolas Claxton
    full: 'Nicolas Claxton',
    firstName: 'Nicolas',
    lastName: 'Claxton',
    teamAbbr: 'BKN',
    position: 'C',
    jersey: 33,
    heightFeet: 6,
    heightInches: 11,
    weight: 215,
    college: 'Georgia'
  }
];

export function searchPlayers(query: string, limit: number = 10): NBAPlayer[] {
  if (!query.trim()) return [];
  
  const filtered = SAMPLE_PLAYERS.filter(player => 
    player.full.toLowerCase().includes(query.toLowerCase()) ||
    player.firstName.toLowerCase().includes(query.toLowerCase()) ||
    player.lastName.toLowerCase().includes(query.toLowerCase())
  );
  
  return filtered.slice(0, limit);
}

export function getPlayerById(id: string): NBAPlayer | null {
  return SAMPLE_PLAYERS.find(player => player.id === id) || null;
}

export function formatHeight(feet?: number, inches?: number): string {
  if (!feet && !inches) return 'N/A';
  return `${feet || 0}'${inches || 0}"`;
}