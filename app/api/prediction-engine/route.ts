export const dynamic = 'force-dynamic';

/**
 * NBA Prediction Engine API
 * Uses runPredictionForProp - all 48+ models including full matchup and ensemble
 */

import { NextRequest, NextResponse } from 'next/server';
import { runPredictionForProp } from '@/lib/prediction-engine/runPrediction';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const playerIdParam = searchParams.get('player_id');
    const statType = (searchParams.get('stat_type') || 'pts').toUpperCase();
    const gameDate = searchParams.get('game_date');
    const opponent = searchParams.get('opponent') || '';
    const lineParam = searchParams.get('line');

    if (!playerIdParam) {
      return NextResponse.json({
        success: false,
        error: 'Missing required parameter: player_id',
      }, { status: 400 });
    }

    const playerId = parseInt(playerIdParam, 10);
    if (isNaN(playerId)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid player_id',
      }, { status: 400 });
    }

    console.log(`[Prediction Engine] Generating prediction for player ${playerId}, stat: ${statType}`);

    const prop = {
      playerId,
      playerName: '',
      team: 'UNK',
      opponent,
      statType: statType === 'THREES' ? 'THREES' : statType,
      line: lineParam ? parseFloat(lineParam) : 0,
      overOdds: -110,
      underOdds: -110,
      gameDate: gameDate || new Date().toISOString().split('T')[0],
      bookmaker: 'Default',
    };

    const result = await runPredictionForProp(prop);

    if (!result.success || !result.result) {
      return NextResponse.json({
        success: false,
        error: result.error || 'Prediction failed',
        data: [],
      }, { status: result.error?.includes('not found') ? 404 : 500 });
    }

    console.log(`[Prediction Engine] Complete:`, {
      player: result.result.playerName,
      stat: result.result.statType,
      prediction: result.result.prediction.toFixed(1),
      modelsUsed: result.result.modelPredictions.length,
    });

    return NextResponse.json({
      success: true,
      data: [result.result],
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[Prediction Engine] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to generate prediction',
      data: [],
    }, { status: 500 });
  }
}
