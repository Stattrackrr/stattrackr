'use client';

import { useState } from 'react';

export default function TestBDLAPI() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);


  const testDirectBDL = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Test direct BDL API call through our proxy
      const response = await fetch('/api/test-bdl-direct');
      const data = await response.json();
      
      setResult({
        status: response.status,
        statusText: response.statusText,
        data: data,
      });
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const testSeasonAverages = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Test team season averages endpoint
      const response = await fetch('/api/test-bdl-direct?test=season_averages');
      const data = await response.json();
      
      setResult({
        status: response.status,
        statusText: response.statusText,
        data: data,
      });
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const testAdvancedStats = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Test advanced stats V2 to see estimated_usage_percentage
      const response = await fetch('/api/test-bdl-direct?test=advanced_stats');
      const data = await response.json();
      
      setResult({
        status: response.status,
        statusText: response.statusText,
        data: data,
      });
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">BallDon'tLie API Key Test</h1>
        
        <div className="space-y-4 mb-6">
          <button
            onClick={testDirectBDL}
            disabled={loading}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded-lg font-semibold ml-4"
          >
            {loading ? 'Testing...' : 'Test Direct BDL API'}
          </button>
          
          <button
            onClick={testSeasonAverages}
            disabled={loading}
            className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 rounded-lg font-semibold ml-4"
          >
            {loading ? 'Testing...' : 'Test Season Averages'}
          </button>
          
          <button
            onClick={testAdvancedStats}
            disabled={loading}
            className="px-6 py-3 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 rounded-lg font-semibold ml-4"
          >
            {loading ? 'Testing...' : 'Test Advanced Stats (Usage %)'}
          </button>
        </div>

        {error && (
          <div className="bg-red-900 border border-red-700 rounded-lg p-4 mb-4">
            <h2 className="font-bold text-lg mb-2">Error</h2>
            <pre className="text-sm overflow-auto">{error}</pre>
          </div>
        )}

        {result && (
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
            <h2 className="font-bold text-lg mb-2">Result</h2>
            <div className="mb-2">
              <span className="font-semibold">Status: </span>
              <span className={result.status === 200 ? 'text-green-400' : 'text-red-400'}>
                {result.status} {result.statusText}
              </span>
            </div>
            {result.hasApiKey && (
              <div className="mb-2">
                <span className="font-semibold">API Key Present: </span>
                <span className="text-green-400">{String(result.hasApiKey)}</span>
              </div>
            )}
            <details className="mt-4">
              <summary className="cursor-pointer font-semibold text-blue-400 hover:text-blue-300">
                View Full Response
              </summary>
              <pre className="mt-2 text-xs bg-gray-900 p-4 rounded overflow-auto max-h-96">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </div>
        )}

        <div className="mt-8 bg-gray-800 border border-gray-700 rounded-lg p-4">
          <h2 className="font-bold text-lg mb-2">Instructions</h2>
          <ul className="list-disc list-inside space-y-1 text-sm">
            <li>Click "Test Direct BDL API" to test a direct BDL API call</li>
            <li>Click "Test Season Averages" to see what the team season averages endpoint returns</li>
            <li>Check the status code - 200 means success, 401 means unauthorized (API key issue)</li>
            <li>If you see "unauthorized", the API key might be incorrect or not being sent properly</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
