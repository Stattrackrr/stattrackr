import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

/** Read cached injury list. Run scripts/fetch-footywire-injuries.js to refresh. */
function readCachedInjuries() {
  try {
    const filePath = path.join(process.cwd(), 'data', 'afl-injuries.json');
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw) as {
      generatedAt?: string;
      injuries?: Array<{ team: string; player: string; injury: string; returning: string }>;
    };
    if (!data?.injuries) return null;
    return data;
  } catch {
    return null;
  }
}

export async function GET() {
  const cached = readCachedInjuries();
  if (!cached) {
    return NextResponse.json(
      { error: 'Injury list not found. Run: npm run fetch:footywire-injuries' },
      { status: 404 }
    );
  }

  return NextResponse.json(cached);
}
