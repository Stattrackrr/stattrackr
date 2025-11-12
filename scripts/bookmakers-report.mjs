const API_KEY = process.env.ODDS_API_KEY;

if (!API_KEY) {
  console.error('ODDS_API_KEY is not set.');
  process.exit(1);
}

const regions = process.env.ODDS_REGIONS || 'us';
const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds?apiKey=${API_KEY}&regions=${regions}&markets=h2h`;

const res = await fetch(url);
if (!res.ok) {
  console.error(`Request failed: ${res.status}`);
  console.error(await res.text());
  process.exit(1);
}

const data = await res.json();
const byBook = new Map();

for (const game of data || []) {
  for (const bookmaker of game.bookmakers || []) {
    const info = byBook.get(bookmaker.key) ?? { title: bookmaker.title, count: 0 };
    info.count += 1;
    byBook.set(bookmaker.key, info);
  }
}

console.log(`Regions queried: ${regions}`);
console.log('Bookmakers observed:');
for (const [key, info] of Array.from(byBook.entries()).sort()) {
  console.log(`${key.padEnd(20)} ${info.title} (games: ${info.count})`);
}

