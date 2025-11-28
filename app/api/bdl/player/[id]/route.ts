import { NextRequest, NextResponse } from 'next/server';

const BDL_BASE = "https://api.balldontlie.io/v1";
const API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY;

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (API_KEY) h["Authorization"] = API_KEY.startsWith('Bearer ') ? API_KEY : `Bearer ${API_KEY}`;
  return h;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const url = new URL(`${BDL_BASE}/players/${id}`);
    const res = await fetch(url, { 
      headers: authHeaders(), 
      cache: "no-store" 
    });
    
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `BDL ${res.status}: ${text || res.statusText}`, data: null },
        { status: res.status }
      );
    }
    
    const json = await res.json();
    return NextResponse.json({ data: json });
  } catch (error: any) {
    console.error('Error fetching BDL player data:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch player data', data: null },
      { status: 500 }
    );
  }
}

