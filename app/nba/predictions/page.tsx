'use client';

/**
 * NBA Predictions Page
 * Displays AI-powered predictions from the 48-model prediction engine
 */

import { useState, useEffect } from 'react';

interface ModelPrediction {
  modelName: string;
  category: string;
  prediction: number;
  confidence: number;
  weight: number;
  reasoning?: string;
}

interface PredictionResult {
  playerId: number;
  playerName: string;
  team: string;
  opponent: string;
  gameDate: string;
  statType: string;
  prediction: number;
  confidence: number;
  line: number;
  edge: number;
  edgePercent: number;
  recommendation: 'STRONG BET' | 'MODERATE BET' | 'LEAN' | 'PASS';
  expectedValue: number;
  modelPredictions: ModelPrediction[];
  modelAgreement: number;
  createdAt: string;
  expiresAt: string;
}

interface DailyPick {
  type: 'player';
  prop: { playerName: string; team: string; opponent: string; statType: string; line: number; bookmakerCount?: number };
  result: PredictionResult;
  readScore: number;
  direction: 'OVER' | 'UNDER';
  scanned: number;
  successful: number;
}

export default function PredictionsPage() {
  const [predictions, setPredictions] = useState<PredictionResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPrediction, setSelectedPrediction] = useState<PredictionResult | null>(null);

  const [dailyPick, setDailyPick] = useState<DailyPick | null>(null);
  const [dailyPickLoading, setDailyPickLoading] = useState(false);
  const [dailyPickError, setDailyPickError] = useState<string | null>(null);

  // Test data for manual lookup
  const [playerId, setPlayerId] = useState('237'); // LeBron James
  const [statType, setStatType] = useState('pts');
  const [opponent, setOpponent] = useState('');
  const [line, setLine] = useState('');
  
  const fetchDailyPick = async () => {
    setDailyPickLoading(true);
    setDailyPickError(null);
    setDailyPick(null);
    try {
      const response = await fetch('/api/prediction-engine/daily-pick');
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch daily pick');
      }
      setDailyPick(data.dailyPick);
      if (data.dailyPick?.result) {
        setSelectedPrediction(data.dailyPick.result);
        setPlayerId(String(data.dailyPick.result.playerId || data.dailyPick.prop.playerId));
        const st = (data.dailyPick.prop.statType || 'PTS').toUpperCase();
        setStatType(st === 'THREES' ? 'fg3m' : st.toLowerCase());
        setOpponent(data.dailyPick.prop.opponent || '');
        setLine(String(data.dailyPick.prop.line ?? ''));
      }
    } catch (err: any) {
      setDailyPickError(err.message);
    } finally {
      setDailyPickLoading(false);
    }
  };

  const fetchPrediction = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({ player_id: playerId, stat_type: statType });
      if (opponent) params.set('opponent', opponent);
      if (line) params.set('line', line);
      const response = await fetch(`/api/prediction-engine?${params}`);
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch prediction');
      }
      
      setPredictions(data.data);
      if (data.data.length > 0) {
        setSelectedPrediction(data.data[0]);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  const getRecommendationColor = (rec: string) => {
    switch (rec) {
      case 'STRONG BET':
        return 'bg-green-500 text-white';
      case 'MODERATE BET':
        return 'bg-blue-500 text-white';
      case 'LEAN':
        return 'bg-yellow-500 text-black';
      default:
        return 'bg-gray-500 text-white';
    }
  };
  
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-600';
    if (confidence >= 0.65) return 'text-blue-600';
    if (confidence >= 0.5) return 'text-yellow-600';
    return 'text-gray-600';
  };
  
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            NBA Prediction Engine
          </h1>
          <p className="text-gray-600">
            AI-powered predictions using 48 advanced models — 1 best pick per day
          </p>
        </div>

        {/* Daily Pick - Primary Feature */}
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-200 rounded-xl p-6 mb-8">
          <h2 className="text-xl font-bold text-amber-900 mb-2">🏆 Today&apos;s Best Read</h2>
          <p className="text-amber-800 text-sm mb-4">
            Scans all player props from today&apos;s games and returns the single prop with the strongest signal.
          </p>
          <button
            onClick={fetchDailyPick}
            disabled={dailyPickLoading}
            className="px-6 py-3 bg-amber-600 text-white font-semibold rounded-lg hover:bg-amber-700 disabled:bg-amber-400 disabled:cursor-not-allowed transition-colors"
          >
            {dailyPickLoading ? 'Scanning props...' : 'Find Best Pick'}
          </button>
          {dailyPickError && (
            <p className="mt-3 text-red-600 text-sm">{dailyPickError}</p>
          )}
          {dailyPick && (
            <div className="mt-6 p-4 bg-white rounded-lg border border-amber-200">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-2xl font-bold text-gray-900">
                    {dailyPick.prop.playerName} — {dailyPick.prop.statType} {dailyPick.direction}{' '}
                    <span className="text-amber-700">Line {dailyPick.prop.line}</span>
                  </p>
                  <p className="text-gray-600">
                    {dailyPick.prop.team} vs {dailyPick.prop.opponent}
                    {dailyPick.prop.bookmakerCount != null && dailyPick.prop.bookmakerCount >= 2 && (
                      <span className="ml-2 text-xs text-green-600">({dailyPick.prop.bookmakerCount} books)</span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-500">
                    Scanned {dailyPick.scanned} props • {dailyPick.successful} with predictions
                  </p>
                  <p className="text-lg font-bold text-green-600">
                    Edge: {dailyPick.result?.edge > 0 ? '+' : ''}{dailyPick.result?.edge?.toFixed(1)} • {Math.round((dailyPick.result?.confidence ?? 0) * 100)}% confidence
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
        
        {/* Input Form - Manual lookup */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Manual Lookup</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Player ID
              </label>
              <input
                type="text"
                value={playerId}
                onChange={(e) => setPlayerId(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter player ID"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Stat Type
              </label>
              <select
                value={statType}
                onChange={(e) => setStatType(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="pts">Points</option>
                <option value="reb">Rebounds</option>
                <option value="ast">Assists</option>
                <option value="stl">Steals</option>
                <option value="blk">Blocks</option>
                <option value="fg3m">3-Pointers Made</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Opponent (e.g. ORL)
              </label>
              <input
                type="text"
                value={opponent}
                onChange={(e) => setOpponent(e.target.value.toUpperCase())}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="ORL, BOS, LAL..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Line (optional)
              </label>
              <input
                type="text"
                value={line}
                onChange={(e) => setLine(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="7.5"
              />
            </div>
            
            <div className="flex items-end">
              <button
                onClick={fetchPrediction}
                disabled={loading}
                className="w-full px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Generating...' : 'Generate Prediction'}
              </button>
            </div>
          </div>
          
          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-800">{error}</p>
            </div>
          )}
        </div>
        
        {/* Prediction Results */}
        {selectedPrediction && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Main Prediction Card */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">
                      {selectedPrediction.playerName}
                    </h2>
                    <p className="text-gray-600">
                      {selectedPrediction.team} vs {selectedPrediction.opponent}
                    </p>
                  </div>
                  <span className={`px-4 py-2 rounded-full font-semibold ${getRecommendationColor(selectedPrediction.recommendation)}`}>
                    {selectedPrediction.recommendation}
                  </span>
                </div>
                
                {/* Prediction Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Prediction</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {selectedPrediction.prediction.toFixed(1)}
                    </p>
                  </div>
                  
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Line</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {selectedPrediction.line.toFixed(1)}
                    </p>
                  </div>
                  
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Edge</p>
                    <p className={`text-2xl font-bold ${selectedPrediction.edge > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {selectedPrediction.edge > 0 ? '+' : ''}{selectedPrediction.edge.toFixed(1)}
                    </p>
                  </div>
                  
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Confidence</p>
                    <p className={`text-2xl font-bold ${getConfidenceColor(selectedPrediction.confidence)}`}>
                      {(selectedPrediction.confidence * 100).toFixed(0)}%
                    </p>
                  </div>
                </div>
                
                {/* Model Agreement */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700">Model Agreement</span>
                    <span className="text-sm font-semibold text-gray-900">
                      {(selectedPrediction.modelAgreement * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all"
                      style={{ width: `${selectedPrediction.modelAgreement * 100}%` }}
                    />
                  </div>
                </div>
                
                {/* Models Used */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Models Used ({selectedPrediction.modelPredictions.length})
                  </h3>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {selectedPrediction.modelPredictions.map((model, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">{model.modelName}</p>
                          {model.reasoning && (
                            <p className="text-sm text-gray-600">{model.reasoning}</p>
                          )}
                        </div>
                        <div className="text-right ml-4">
                          <p className="font-semibold text-gray-900">
                            {model.prediction.toFixed(1)}
                          </p>
                          <p className="text-xs text-gray-600">
                            {(model.confidence * 100).toFixed(0)}% conf
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Sidebar */}
            <div className="space-y-6">
              {/* Model Breakdown */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Model Categories
                </h3>
                <div className="space-y-3">
                  {['statistical', 'matchup', 'context', 'prop-specific', 'ensemble'].map((category) => {
                    const categoryModels = selectedPrediction.modelPredictions.filter(
                      m => m.category === category
                    );
                    return (
                      <div key={category} className="flex items-center justify-between">
                        <span className="text-sm text-gray-700 capitalize">{category}</span>
                        <span className="text-sm font-semibold text-gray-900">
                          {categoryModels.length} models
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              
              {/* Info Card */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-blue-900 mb-2">
                  How It Works
                </h3>
                <p className="text-sm text-blue-800">
                  Our prediction engine uses 48 different models across 5 categories:
                  statistical analysis, matchup evaluation, contextual factors, 
                  prop-specific patterns, and ensemble methods. Each model contributes 
                  to the final prediction based on its historical accuracy.
                </p>
              </div>
            </div>
          </div>
        )}
        
        {/* Empty State */}
        {!selectedPrediction && !loading && (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <div className="text-6xl mb-4">🏀</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              No Predictions Yet
            </h3>
            <p className="text-gray-600">
              Enter a player ID and stat type above to generate a prediction
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
