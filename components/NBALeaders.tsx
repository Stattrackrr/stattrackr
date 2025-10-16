'use client';

import React from 'react';

interface StatLeader {
  player: string;
  team: string;
  value: number;
}

export default function NBALeaders() {
  const leaders = {
    points: [
      { player: 'Luka Dončić', team: 'DAL', value: 32.8 },
      { player: 'Joel Embiid', team: 'PHI', value: 31.2 },
      { player: 'Damian Lillard', team: 'MIL', value: 30.1 }
    ],
    rebounds: [
      { player: 'Domantas Sabonis', team: 'SAC', value: 12.4 },
      { player: 'Nikola Jokić', team: 'DEN', value: 11.8 },
      { player: 'Joel Embiid', team: 'PHI', value: 11.2 }
    ],
    assists: [
      { player: 'Tyrese Haliburton', team: 'IND', value: 12.1 },
      { player: 'Trae Young', team: 'ATL', value: 11.4 },
      { player: 'Nikola Jokić', team: 'DEN', value: 10.2 }
    ]
  };

  const StatCategory = ({ title, stats }: { title: string; stats: StatLeader[] }) => (
    <div className="space-y-2">
      <h3 className="font-semibold text-sm uppercase tracking-wide">{title}</h3>
      {stats.map((stat, index) => (
        <div key={index} className="flex justify-between items-center">
          <div className="flex-1">
            <span className="text-sm font-medium">{stat.player}</span>
            <span className="text-xs text-gray-500 ml-2">{stat.team}</span>
          </div>
          <span className="text-sm font-mono">{stat.value}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">League Leaders</h2>
      <div className="grid gap-6 md:grid-cols-3">
        <StatCategory title="Points" stats={leaders.points} />
        <StatCategory title="Rebounds" stats={leaders.rebounds} />
        <StatCategory title="Assists" stats={leaders.assists} />
      </div>
    </div>
  );
}