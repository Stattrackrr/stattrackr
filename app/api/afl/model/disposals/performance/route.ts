import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EvalPayload = {
  generatedAt?: string;
  sampleCount?: number;
  decision?: {
    pass?: boolean;
    promoted?: boolean;
  };
  candidate?: {
    modelVersion?: string;
    sampleCount?: number;
    hitRate?: number;
    brierScore?: number;
    logLoss?: number;
    calibrationMethod?: string;
  };
  current?: {
    modelVersion?: string;
    sampleCount?: number;
    hitRate?: number;
    brierScore?: number;
    logLoss?: number;
    calibrationMethod?: string;
  };
  deltas?: {
    brierImprovement?: number;
    logLossChange?: number;
    hitRateDelta?: number;
  };
  reasonSummary?: {
    lossTypeCounts?: Array<{ type?: string; count?: number }>;
  };
};

function readLatestEvalPayload(): EvalPayload | null {
  const filePath = path.join(process.cwd(), 'data', 'afl-model', 'history', 'model-eval-latest.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as EvalPayload;
  } catch {
    return null;
  }
}

export async function GET() {
  const payload = readLatestEvalPayload();
  if (!payload) {
    return NextResponse.json({
      success: true,
      hasData: false,
      message: 'No model evaluation data yet.',
    });
  }

  const topLossTypes = Array.isArray(payload.reasonSummary?.lossTypeCounts)
    ? payload.reasonSummary?.lossTypeCounts?.slice(0, 5) ?? []
    : [];

  return NextResponse.json({
    success: true,
    hasData: true,
    generatedAt: payload.generatedAt ?? null,
    sampleCount: payload.sampleCount ?? 0,
    decision: payload.decision ?? { pass: false, promoted: false },
    candidate: payload.candidate ?? null,
    current: payload.current ?? null,
    deltas: payload.deltas ?? null,
    topLossTypes,
  });
}

