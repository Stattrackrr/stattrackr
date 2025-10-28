import { NextRequest, NextResponse } from 'next/server';
import cache, { CACHE_TTL, getCacheKey } from '@/lib/cache';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  
  // Get the endpoint from query params
  const endpoint = searchParams.get('endpoint');
  if (!endpoint) {
    return NextResponse.json({ error: 'Endpoint is required' }, { status: 400 });
  }

  // Remove the endpoint param and forward the rest
  const forwardParams = new URLSearchParams();
  searchParams.forEach((value, key) => {
    if (key !== 'endpoint') {
      forwardParams.append(key, value);
    }
  });

  // Generate cache key for this request
  const cacheKey = `bdl:${endpoint}:${forwardParams.toString()}`;
  
  // Check cache first
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    console.log(`🚀 Cache HIT for Ball Don't Lie: ${endpoint}`);
    return NextResponse.json(cachedData);
  }

  console.log(`🌐 Fresh Ball Don't Lie API call: ${endpoint} with params:`, forwardParams.toString());
  
  try {
    // Construct the Ball Don't Lie API URL
    const baseUrl = 'https://www.balldontlie.io/api/v1';
    const url = `${baseUrl}${endpoint}?${forwardParams.toString()}`;
    console.log('Full API URL:', url);
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'StatTrackr/1.0',
        'Authorization': 'Bearer 9823adcf-57dc-4036-906d-aeb9f0003cfd',
      },
    });

    console.log('Ball Don\'t Lie API Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Ball Don\'t Lie API Error:', errorText);
      return NextResponse.json({
        error: `Ball Don't Lie API error! status: ${response.status}`,
        message: errorText
      }, { status: response.status });
    }

    const data = await response.json();
    console.log('Ball Don\'t Lie API Response:', JSON.stringify(data, null, 2));
    
    // Cache successful response - use appropriate TTL based on endpoint
    let ttl = CACHE_TTL.PLAYER_STATS; // Default to player stats TTL
    if (endpoint.includes('/players')) {
      ttl = CACHE_TTL.PLAYER_SEARCH; // Player search changes less frequently
    } else if (endpoint.includes('/stats')) {
      ttl = CACHE_TTL.PLAYER_STATS; // Game stats
    } else if (endpoint.includes('/season_averages')) {
      ttl = CACHE_TTL.PLAYER_STATS; // Season averages
    }
    
    cache.set(cacheKey, data, ttl);
    console.log(`✅ Ball Don't Lie response cached for ${ttl} minutes`);
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in Ball Don\'t Lie API proxy:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to fetch from Ball Don\'t Lie API',
        details: 'Check server logs for more information'
      },
      { status: 500 }
    );
  }
}