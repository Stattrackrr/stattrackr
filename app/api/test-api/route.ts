import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  try {
    // First, let's try to fetch some basic data from Ball Don't Lie API
    console.log('Testing Ball Don\'t Lie API connection...');
    
    const response = await fetch('https://www.balldontlie.io/api/v1/players?per_page=5', {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'StatTrackr/1.0',
      },
    });

    console.log('Test API Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Test API Error:', errorText);
      return NextResponse.json({
        success: false,
        status: response.status,
        error: errorText
      });
    }

    const data = await response.json();
    console.log('Test API Success:', data);
    
    return NextResponse.json({
      success: true,
      message: 'Ball Don\'t Lie API is accessible',
      sample_data: data
    });
  } catch (error) {
    console.error('Test API Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}