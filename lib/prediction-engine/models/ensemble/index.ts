/**
 * Ensemble Models (3 models)
 * Combine all individual models into final predictions
 */

import type { ModelPrediction, EnsemblePrediction, ModelWeights } from '../../types';

/**
 * Model 46: Weighted Ensemble
 * Combine all models with their weights
 */
export function weightedEnsembleModel(
  predictions: ModelPrediction[]
): EnsemblePrediction {
  if (predictions.length === 0) {
    return {
      weightedAverage: 0,
      median: 0,
      mode: 0,
      standardDeviation: 0,
      agreement: 0,
      confidence: 0,
    };
  }
  
  // Calculate weighted average
  const totalWeight = predictions.reduce((sum, p) => sum + p.weight, 0);
  const weightedSum = predictions.reduce((sum, p) => sum + (p.prediction * p.weight), 0);
  const weightedAverage = totalWeight > 0 ? weightedSum / totalWeight : 0;
  
  // Calculate median
  const sortedPredictions = [...predictions].sort((a, b) => a.prediction - b.prediction);
  const mid = Math.floor(sortedPredictions.length / 2);
  const median = sortedPredictions.length % 2 === 0
    ? (sortedPredictions[mid - 1].prediction + sortedPredictions[mid].prediction) / 2
    : sortedPredictions[mid].prediction;
  
  // Calculate mode (most common prediction, rounded to nearest 0.5)
  const roundedPredictions = predictions.map(p => Math.round(p.prediction * 2) / 2);
  const frequency: Record<number, number> = {};
  roundedPredictions.forEach(p => {
    frequency[p] = (frequency[p] || 0) + 1;
  });
  const mode = Number(Object.keys(frequency).reduce((a, b) => 
    frequency[Number(a)] > frequency[Number(b)] ? a : b
  ));
  
  // Calculate standard deviation
  const mean = predictions.reduce((sum, p) => sum + p.prediction, 0) / predictions.length;
  const squaredDiffs = predictions.map(p => Math.pow(p.prediction - mean, 2));
  const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / predictions.length;
  const standardDeviation = Math.sqrt(variance);
  
  // Calculate agreement (inverse of coefficient of variation)
  const coefficientOfVariation = mean > 0 ? standardDeviation / mean : 0;
  const agreement = Math.max(0, Math.min(1, 1 - coefficientOfVariation));
  
  // Calculate overall confidence (weighted average of individual confidences)
  const weightedConfidenceSum = predictions.reduce((sum, p) => sum + (p.confidence * p.weight), 0);
  const baseConfidence = totalWeight > 0 ? weightedConfidenceSum / totalWeight : 0;
  
  // Boost: models agree = higher confidence. Add agreement boost so 65% base can reach 73%+
  const agreementBoost = agreement > 0.5 ? 0.06 + (agreement - 0.5) * 0.12 : 0;
  const confidence = Math.min(0.95, baseConfidence * (0.85 + agreement * 0.15) + agreementBoost);
  
  return {
    weightedAverage,
    median,
    mode,
    standardDeviation,
    agreement,
    confidence: Math.min(0.95, confidence),
  };
}

/**
 * Model 47: Model Agreement Score
 * How many models agree?
 */
export function modelAgreementScore(
  predictions: ModelPrediction[],
  threshold: number = 2.0
): { agreement: number; agreementLevel: string; confidence: number } {
  if (predictions.length === 0) {
    return {
      agreement: 0,
      agreementLevel: 'NONE',
      confidence: 0,
    };
  }
  
  // Calculate standard deviation
  const mean = predictions.reduce((sum, p) => sum + p.prediction, 0) / predictions.length;
  const squaredDiffs = predictions.map(p => Math.pow(p.prediction - mean, 2));
  const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / predictions.length;
  const stdDev = Math.sqrt(variance);
  
  // Agreement score (0-1, higher = more agreement)
  const agreement = Math.max(0, Math.min(1, 1 - (stdDev / threshold)));
  
  // Categorize agreement level
  let agreementLevel = 'NONE';
  if (agreement > 0.85) {
    agreementLevel = 'VERY HIGH';
  } else if (agreement > 0.70) {
    agreementLevel = 'HIGH';
  } else if (agreement > 0.50) {
    agreementLevel = 'MODERATE';
  } else if (agreement > 0.30) {
    agreementLevel = 'LOW';
  }
  
  // Confidence based on agreement
  const confidence = Math.min(0.95, 0.5 + (agreement * 0.5));
  
  return {
    agreement,
    agreementLevel,
    confidence,
  };
}

/**
 * Model 48: Dynamic Weight Adjustment
 * Adjust model weights based on recent performance
 */
export async function dynamicWeightAdjustment(
  baseWeights: ModelWeights,
  lookbackDays: number = 30
): Promise<ModelWeights> {
  try {
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();
    
    // Get model performance from last N days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
    
    const { data: performance, error } = await supabase
      .from('model_performance')
      .select('*')
      .gte('date', cutoffDate.toISOString().split('T')[0])
      .order('date', { ascending: false });
    
    if (error || !performance || performance.length === 0) {
      // No performance data, return base weights
      return baseWeights;
    }
    
    // Aggregate performance by model
    const modelStats: Record<string, { accuracy: number; count: number }> = {};
    
    performance.forEach(record => {
      if (!modelStats[record.model_name]) {
        modelStats[record.model_name] = { accuracy: 0, count: 0 };
      }
      modelStats[record.model_name].accuracy += record.accuracy || 0;
      modelStats[record.model_name].count += 1;
    });
    
    // Calculate average accuracy for each model
    const avgAccuracy: Record<string, number> = {};
    Object.keys(modelStats).forEach(modelName => {
      avgAccuracy[modelName] = modelStats[modelName].accuracy / modelStats[modelName].count;
    });
    
    // Calculate overall average accuracy
    const overallAvg = Object.values(avgAccuracy).reduce((sum, acc) => sum + acc, 0) / Object.keys(avgAccuracy).length;
    
    // Adjust weights based on performance
    const adjustedWeights: ModelWeights = { ...baseWeights };
    
    Object.keys(baseWeights).forEach(modelName => {
      const modelAccuracy = avgAccuracy[modelName];
      
      if (modelAccuracy !== undefined) {
        // Increase weight if accuracy > average, decrease if < average
        const performanceRatio = modelAccuracy / overallAvg;
        
        // Cap adjustments at +/- 20%
        const adjustment = Math.max(0.80, Math.min(1.20, performanceRatio));
        
        adjustedWeights[modelName] = baseWeights[modelName] * adjustment;
      }
    });
    
    // Normalize weights to sum to 1.0
    const totalWeight = Object.values(adjustedWeights).reduce((sum, w) => sum + w, 0);
    Object.keys(adjustedWeights).forEach(modelName => {
      adjustedWeights[modelName] /= totalWeight;
    });
    
    return adjustedWeights;
  } catch (error) {
    console.error('[Ensemble] Error in dynamic weight adjustment:', error);
    return baseWeights;
  }
}

/**
 * Generate final prediction from ensemble
 */
export function generateFinalPrediction(
  ensemble: EnsemblePrediction,
  line: number
): {
  prediction: number;
  confidence: number;
  edge: number;
  edgePercent: number;
  recommendation: 'STRONG BET' | 'MODERATE BET' | 'LEAN' | 'PASS';
} {
  // Use weighted average as final prediction
  const prediction = ensemble.weightedAverage;
  const confidence = ensemble.confidence;
  const edge = prediction - line;
  const edgePercent = line > 0 ? (edge / line) * 100 : 0;
  
  // Determine recommendation based on edge and confidence
  let recommendation: 'STRONG BET' | 'MODERATE BET' | 'LEAN' | 'PASS' = 'PASS';
  
  const absEdge = Math.abs(edge);
  const absEdgePercent = Math.abs(edgePercent);
  
  if (absEdge >= 3 && confidence >= 0.75) {
    recommendation = 'STRONG BET';
  } else if (absEdge >= 2 && confidence >= 0.65) {
    recommendation = 'MODERATE BET';
  } else if (absEdge >= 1 && confidence >= 0.55) {
    recommendation = 'LEAN';
  } else if (absEdge >= 0.5 && confidence >= 0.5) {
    recommendation = 'LEAN';
  }
  
  // Also consider edge percentage (especially for low lines)
  if (absEdgePercent >= 15 && confidence >= 0.75) {
    recommendation = 'STRONG BET';
  } else if (absEdgePercent >= 10 && confidence >= 0.65 && recommendation === 'PASS') {
    recommendation = 'MODERATE BET';
  } else if (absEdgePercent >= 5 && confidence >= 0.5 && recommendation === 'PASS') {
    recommendation = 'LEAN';
  }
  
  return {
    prediction,
    confidence,
    edge,
    edgePercent,
    recommendation,
  };
}

/**
 * Calculate expected value for a bet
 */
export function calculateExpectedValue(
  prediction: number,
  line: number,
  overOdds: number,
  underOdds: number,
  stdDev: number
): { ev: number; direction: 'over' | 'under'; probOver: number } {
  // Estimate probability of going over (simplified normal distribution)
  const zScore = (line - prediction) / stdDev;
  const probOver = 1 - normalCDF(zScore);
  const probUnder = 1 - probOver;
  
  // Convert American odds to decimal
  const overDecimal = overOdds > 0 ? (overOdds / 100) + 1 : (100 / Math.abs(overOdds)) + 1;
  const underDecimal = underOdds > 0 ? (underOdds / 100) + 1 : (100 / Math.abs(underOdds)) + 1;
  
  // Calculate EV for each bet
  const evOver = (probOver * overDecimal) - 1;
  const evUnder = (probUnder * underDecimal) - 1;
  
  // Return the better bet
  if (evOver > evUnder) {
    return { ev: evOver, direction: 'over', probOver };
  } else {
    return { ev: evUnder, direction: 'under', probOver };
  }
}

// Simplified normal CDF approximation
function normalCDF(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - prob : prob;
}
