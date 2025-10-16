import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Ball Don't Lie API endpoint for player stats
    const response = await fetch(
      `https://api.balldontlie.io/v1/stats?player_ids[]=${id}&seasons[]=2024&per_page=100`,
      {
        headers: {
          'Authorization': process.env.BALL_DONT_LIE_API_KEY || '',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch player stats: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching player stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch player stats' },
      { status: 500 }
    );
  }
}