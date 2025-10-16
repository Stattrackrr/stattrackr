'use client';

import React from 'react';

interface GameOdds {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeOdds: number;
  awayOdds: number;
  overUnder: number;
  gameTime: string;
}

export default function OddsDisplay() {
  const games: GameOdds[] = [
    {
      id: '1',
      homeTeam: 'Lakers',
      awayTeam: 'Warriors',
      homeOdds: -110,
      awayOdds: -110,
      overUnder: 225.5,
      gameTime: '2024-01-15T22:00:00Z'
    },
    {
      id: '2',
      homeTeam: 'Celtics',
      awayTeam: 'Heat',
      homeOdds: -150,
      awayOdds: +130,
      overUnder: 218.5,
      gameTime: '2024-01-15T20:30:00Z'
    }
  ];

  const formatOdds = (odds: number): string => {
    return odds > 0 ? `+${odds}` : odds.toString();
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Today&apos;s Games</h2>
      {games.map((game) => (
        <div key={game.id} className="border rounded-lg p-4 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">
              {new Date(game.gameTime).toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}
            </span>
          </div>
          
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="text-center">
              <div className="font-medium">{game.awayTeam}</div>
              <div className="text-xs text-gray-500">{formatOdds(game.awayOdds)}</div>
            </div>
            
            <div className="text-center text-xs text-gray-500">
              @
            </div>
            
            <div className="text-center">
              <div className="font-medium">{game.homeTeam}</div>
              <div className="text-xs text-gray-500">{formatOdds(game.homeOdds)}</div>
            </div>
          </div>
          
          <div className="text-center text-xs text-gray-500 pt-2 border-t">
            O/U: {game.overUnder}
          </div>
        </div>
      ))}
    </div>
  );
}