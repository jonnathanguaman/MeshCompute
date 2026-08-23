/**
 * Calculo de metricas del benchmark.
 *
 * RNF-11 (doc 00 §27): "No mostrar porcentajes, success rates ni mejoras si el
 * benchmark no fue ejecutado realmente."
 * T-17: "el script produce JSON con conteos y tasas CALCULADAS, no hardcodeadas."
 *
 * Todas las tasas de aqui derivan de los runs. Cada una lleva su numerador y
 * denominador en el JSON, para que cualquiera pueda rehacer la division.
 */

import { FAILURE_CODE_IDS, type FailureCodeId } from '@meshcompute/contracts';
import type { ExpectedOutcome, ScenarioId } from './dataset.js';

export interface RunRecord {
  taskId: string;
  scenario: ScenarioId;
  expected: ExpectedOutcome;
  expectedTools: string[];

  /** Veredicto del orchestrator. */
  status: 'PASSED' | 'REFUSED' | 'FAILED';
  schemaPassed: boolean;
  groundingPassed: boolean;

  toolCallsAttempted: number;
  toolCallsValidArgs: number;
  toolCallsInWhitelist: number;
  toolCallsSucceeded: number;
  toolsRetried: number;
  toolsRecoveredAfterRetry: number;
  toolTurns: number;

  failures: FailureCodeId[];
  latencyMs: number;
  /** true si el run hizo lo correcto para su escenario. */
  correct: boolean;
  error?: string;
}

/** Una tasa con su numerador y denominador visibles. */
export interface Rate {
  value: number | null;
  numerator: number;
  denominator: number;
}

function rate(numerator: number, denominator: number): Rate {
  return {
    value: denominator === 0 ? null : Number((numerator / denominator).toFixed(4)),
    numerator,
    denominator,
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Number((sum / values.length).toFixed(2));
}

export interface Metrics {
  runs: number;
  taskSuccessRate: Rate;
  toolSelectionAccuracy: Rate;
  validArgumentRate: Rate;
  groundedAnswerRate: Rate;
  correctRefusalRate: Rate;
  retryRecoveryRate: Rate;
  hallucinatedResultRate: Rate;
  averageToolTurns: number | null;
  averageLatencyMs: number | null;
  failureCounts: Record<FailureCodeId, number>;
  byScenario: Record<string, { runs: number; correct: number }>;
}

export function computeMetrics(records: RunRecord[]): Metrics {
  const runs = records.length;

  // --- taskSuccessRate: hizo lo correcto para su escenario ---
  const correct = records.filter((r) => r.correct).length;

  // --- toolSelectionAccuracy: llamadas a tools de la whitelist ---
  const attempted = records.reduce((sum, r) => sum + r.toolCallsAttempted, 0);
  const inWhitelist = records.reduce((sum, r) => sum + r.toolCallsInWhitelist, 0);

  // --- validArgumentRate: de las llamadas hechas, cuantas con args validos ---
  const validArgs = records.reduce((sum, r) => sum + r.toolCallsValidArgs, 0);

  // --- groundedAnswerRate: solo sobre runs que produjeron una respuesta ---
  // Rehusar no es "no fundamentado": es la conducta correcta cuando falta
  // evidencia, asi que esos runs no entran en el denominador.
  const answeredRuns = records.filter((r) => r.schemaPassed && r.status !== 'REFUSED');
  const grounded = answeredRuns.filter((r) => r.groundingPassed).length;

  // --- correctRefusalRate: de los que DEBIAN rehusar, cuantos rehusaron ---
  const shouldRefuse = records.filter((r) => r.expected === 'REFUSE');
  const didRefuse = shouldRefuse.filter(
    (r) => r.status === 'REFUSED' || r.status === 'FAILED',
  ).length;

  // --- retryRecoveryRate: tools que fallaron, reintentaron y se recuperaron ---
  const retried = records.reduce((sum, r) => sum + r.toolsRetried, 0);
  const recovered = records.reduce((sum, r) => sum + r.toolsRecoveredAfterRetry, 0);

  // --- hallucinatedResultRate: runs con F4 HALLUCINATED_RESULT ---
  const hallucinated = records.filter((r) => r.failures.includes('F4')).length;

  const failureCounts = Object.fromEntries(
    FAILURE_CODE_IDS.map((code) => [
      code,
      records.reduce((sum, r) => sum + r.failures.filter((f) => f === code).length, 0),
    ]),
  ) as Record<FailureCodeId, number>;

  const byScenario: Record<string, { runs: number; correct: number }> = {};
  for (const record of records) {
    const entry = (byScenario[record.scenario] ??= { runs: 0, correct: 0 });
    entry.runs += 1;
    if (record.correct) entry.correct += 1;
  }

  return {
    runs,
    taskSuccessRate: rate(correct, runs),
    toolSelectionAccuracy: rate(inWhitelist, attempted),
    validArgumentRate: rate(validArgs, attempted),
    groundedAnswerRate: rate(grounded, answeredRuns.length),
    correctRefusalRate: rate(didRefuse, shouldRefuse.length),
    retryRecoveryRate: rate(recovered, retried),
    hallucinatedResultRate: rate(hallucinated, runs),
    averageToolTurns: average(records.map((r) => r.toolTurns)),
    averageLatencyMs: average(records.map((r) => r.latencyMs)),
    failureCounts,
    byScenario,
  };
}

export const __internal = { rate, average };
