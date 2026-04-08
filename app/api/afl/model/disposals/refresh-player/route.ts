import { NextRequest, NextResponse } from 'next/server';
import { getAflDisposalsProjection } from '@/lib/aflDisposalsModel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((
      1.061405429 * t -
      1.453152027
    ) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax));
  return sign * y;
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export async function POST(request: NextRequest) {
  let body: {
    playerName?: string;
    homeTeam?: string;
    awayTeam?: string;
    line?: number;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const playerName = String(body.playerName ?? '').trim();
  const homeTeam = String(body.homeTeam ?? '').trim();
  const awayTeam = String(body.awayTeam ?? '').trim();
  const line = typeof body.line === 'number' && Number.isFinite(body.line) ? body.line : null;

  if (!playerName || !homeTeam || !awayTeam || line == null) {
    return NextResponse.json({ success: false, error: 'Missing playerName/homeTeam/awayTeam/line' }, { status: 400 });
  }

  try {
    const baseProjection = getAflDisposalsProjection({ playerName, homeTeam, awayTeam, line });
    if (!baseProjection) {
      return NextResponse.json({
        success: false,
        error: 'No base projection found for player/game',
      }, { status: 404 });
    }

    const baseLine = typeof baseProjection.modelLine === 'number' && Number.isFinite(baseProjection.modelLine)
      ? baseProjection.modelLine
      : null;
    const isSameLineAsScored = baseLine != null && Math.abs(baseLine - line) <= 1e-9;

    // If line hasn't changed, keep the original scored probabilities/edges exactly.
    // This avoids drift from recomputing with a simplified distribution formula.
    if (isSameLineAsScored) {
      return NextResponse.json({
        success: true,
        playerName,
        homeTeam,
        awayTeam,
        projection: {
          ...baseProjection,
          modelLine: line,
        },
        message: 'Model already aligned to requested line',
      });
    }

    // Reproject probabilities at the requested line using current expected/sigma.
    const sigma = Math.max(1e-6, Number(baseProjection.sigma || 0));
    const z = (line - baseProjection.expectedDisposals) / sigma;
    const pOver = Math.max(0.001, Math.min(0.999, 1 - normalCdf(z)));
    const pUnder = Math.max(0.001, Math.min(0.999, 1 - pOver));
    const marketPOver =
      typeof baseProjection.marketPOver === 'number' && Number.isFinite(baseProjection.marketPOver)
        ? baseProjection.marketPOver
        : null;
    const edgeVsMarket = marketPOver != null ? pOver - marketPOver : null;
    const edgeVsMarketUnder = marketPOver != null ? pUnder - (1 - marketPOver) : null;
    const recommendedSide: 'OVER' | 'UNDER' | null =
      edgeVsMarket == null
        ? null
        : edgeVsMarket > 0
          ? 'OVER'
          : edgeVsMarket < 0
            ? 'UNDER'
            : null;
    const recommendedEdge =
      edgeVsMarket == null
        ? null
        : recommendedSide === 'OVER'
          ? edgeVsMarket
          : recommendedSide === 'UNDER'
            ? (edgeVsMarketUnder ?? -edgeVsMarket)
            : 0;
    const recommendedProb =
      recommendedSide === 'OVER' ? pOver : recommendedSide === 'UNDER' ? pUnder : null;
    const refreshedProjection = {
      ...baseProjection,
      modelLine: line,
      pOver,
      pUnder,
      edgeVsMarket,
      edgeVsMarketUnder,
      recommendedSide,
      recommendedEdge,
      recommendedProb,
    };
    return NextResponse.json({
      success: true,
      playerName,
      homeTeam,
      awayTeam,
      projection: refreshedProjection,
      message: 'Model refreshed for player at requested line',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
