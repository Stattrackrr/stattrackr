import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

type DfsRolePlayer = {
  name?: string;
  normalizedName?: string;
  roleGroup?: string;
  roleBucket?: string | null;
};

type DfsRoleFile = {
  season?: number;
  generatedAt?: string;
  players?: DfsRolePlayer[];
};

function normalizeName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function GET(request: NextRequest) {
  try {
    const player = String(request.nextUrl.searchParams.get('player') || '').trim();
    if (!player) {
      return NextResponse.json({ success: false, error: 'Missing player query param.' }, { status: 400 });
    }

    const filePath = path.join(process.cwd(), 'data', 'afl-dfs-role-map-latest.json');
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw) as DfsRoleFile;
    const players = Array.isArray(data.players) ? data.players : [];

    const target = normalizeName(player);
    let match = players.find((p) => normalizeName(p.normalizedName || p.name || '') === target) || null;
    if (!match) {
      match = players.find((p) => {
        const n = normalizeName(p.normalizedName || p.name || '');
        return n.includes(target) || target.includes(n);
      }) || null;
    }

    return NextResponse.json({
      success: true,
      player,
      found: !!match,
      roleGroup: match?.roleGroup || null,
      roleBucket: match?.roleBucket || null,
      season: data.season ?? null,
      generatedAt: data.generatedAt ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to read DFS role map.',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

