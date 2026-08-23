import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NextResponse } from 'next/server';
import type { BenchmarkModeResult, BenchmarkResult } from '@/lib/types';

interface ArtifactRate {
  value: number | null;
  numerator: number;
  denominator: number;
}

interface ArtifactModeMetrics {
  taskSuccessRate: ArtifactRate;
  validArgumentRate: ArtifactRate;
  groundedAnswerRate: ArtifactRate;
  correctRefusalRate: ArtifactRate;
  hallucinatedResultRate: ArtifactRate;
  averageLatencyMs: number;
  failureCounts: Record<string, number>;
}

interface BenchmarkArtifact {
  generatedAt: string;
  environment: {
    adapter: string;
    simulatedModel: boolean;
    modelKey: string;
    modelLabel?: string;
    quantization?: string;
    seed: number;
  };
  dataset: { totalTasks: number };
  modes: Partial<Record<'baseline' | 'hardened', ArtifactModeMetrics>>;
}

function pct(rate: ArtifactRate | undefined): number {
  if (!rate || rate.value === null) return 0;
  return Number((rate.value * 100).toFixed(1));
}

function toModeResult(metrics: ArtifactModeMetrics, runs: number): BenchmarkModeResult {
  return {
    runs,
    taskSuccessRate: pct(metrics.taskSuccessRate),
    validArgumentRate: pct(metrics.validArgumentRate),
    groundedAnswerRate: pct(metrics.groundedAnswerRate),
    correctRefusalRate: pct(metrics.correctRefusalRate),
    hallucinatedResultRate: pct(metrics.hallucinatedResultRate),
    averageLatencyMs: metrics.averageLatencyMs,
  };
}

export async function GET() {
  try {
    const artifact = JSON.parse(
      await readFile(resolve(process.cwd(), '../../artifacts/benchmark-results.json'), 'utf8'),
    ) as BenchmarkArtifact;

    const baseline = artifact.modes.baseline;
    const hardened = artifact.modes.hardened;
    // RNF-11 / UI-14: solo se presentan corridas reales con ambos modos.
    if (!artifact.environment.simulatedModel && baseline && hardened) {
      const failures: Record<string, number> = {};
      for (const mode of [baseline, hardened]) {
        for (const [code, count] of Object.entries(mode.failureCounts)) {
          if (count > 0) failures[code] = (failures[code] ?? 0) + count;
        }
      }
      const result: BenchmarkResult = {
        status: 'READY',
        mock: false,
        model: artifact.environment.modelLabel ?? artifact.environment.modelKey,
        quantization: artifact.environment.quantization ?? '—',
        datasetVersion: `${artifact.dataset.totalTasks} tasks · seed ${artifact.environment.seed}`,
        baseline: toModeResult(baseline, artifact.dataset.totalTasks),
        hardened: toModeResult(hardened, artifact.dataset.totalTasks),
        failures,
        generatedAt: artifact.generatedAt,
      };
      return NextResponse.json(result);
    }
  } catch {
    // Un artifact ausente o invalido se reporta honestamente como NOT_RUN.
  }
  return NextResponse.json({ status: 'NOT_RUN', mock: false });
}
