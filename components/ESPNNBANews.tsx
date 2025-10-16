'use client';

import React, { useState, useEffect } from 'react';

interface NewsItem {
  id: string;
  headline: string;
  description: string;
  published: string;
  link: string;
}

export default function ESPNNBANews() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Mock NBA news data
    setLoading(false);
    setNews([
      {
        id: '1',
        headline: 'Lakers defeat Warriors in overtime thriller',
        description: 'LeBron James leads comeback victory with 35 points',
        published: '2024-01-15T20:30:00Z',
        link: '#'
      },
      {
        id: '2',
        headline: 'Celtics maintain perfect home record',
        description: 'Jayson Tatum scores 40 in dominant win over Heat',
        published: '2024-01-15T19:15:00Z',
        link: '#'
      }
    ]);
  }, []);

  if (loading) {
    return <div className="text-center py-4">Loading news...</div>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Latest NBA News</h2>
      {news.map((item) => (
        <div key={item.id} className="border-b pb-3">
          <h3 className="font-medium">{item.headline}</h3>
          <p className="text-sm text-gray-600 mt-1">{item.description}</p>
          <span className="text-xs text-gray-400">
            {new Date(item.published).toLocaleDateString()}
          </span>
        </div>
      ))}
    </div>
  );
}