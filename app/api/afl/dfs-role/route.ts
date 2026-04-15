import { NextRequest, NextResponse } from 'next/server';
import { resolveDfsRoleDisplayLabel } from '@/lib/aflDfsRoleLabels';
import { findDfsRolePlayer, loadDfsRoleMapBundle } from '@/lib/aflDfsRoleMap';

export async function GET(request: NextRequest) {
  try {
    const player = String(request.nextUrl.searchParams.get('player') || '').trim();
    if (!player) {
      return NextResponse.json({ success: false, error: 'Missing player query param.' }, { status: 400 });
    }

    const { players, season, generatedAt } = await loadDfsRoleMapBundle();
    const match = findDfsRolePlayer(players, player);

    const dvpParam = String(request.nextUrl.searchParams.get('dvp') || '')
      .trim()
      .toUpperCase();
    const fantasyDvp =
      dvpParam === 'DEF' || dvpParam === 'MID' || dvpParam === 'FWD' || dvpParam === 'RUC' ? dvpParam : null;
    const roleGroup =
      match?.roleGroup && String(match.roleGroup).trim() ? String(match.roleGroup).trim() : null;
    const shortLabel = resolveDfsRoleDisplayLabel(roleGroup, fantasyDvp);

    return NextResponse.json({
      success: true,
      player,
      found: !!match && !!roleGroup,
      roleGroup,
      roleBucket: match?.roleBucket ?? null,
      shortLabel,
      season,
      generatedAt,
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
