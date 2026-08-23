/**
 * Grounding check determinista.
 *
 * Doc 00 §11A / doc 01 §18A: "Nunca aceptar que el LLM simplemente diga que
 * una tool devolvio algo."
 *
 * RNF-12: el LLM no se auto-califica. Todo lo de aqui son comparaciones
 * mecanicas contra `actualToolResults`, el mapa que el orchestrator llena con
 * lo que las tools devolvieron DE VERDAD.
 */

import { computeExpectedCostAtomic } from './cost.js';
import type { FinalAnswer } from './final-schema.js';

export interface GroundingIssue {
  field: string;
  expected: string;
  claimed: string;
  /** Codigo de la taxonomia de fallos (doc 00 §11A). */
  failureCode: 'F3' | 'F4';
  reason: string;
}

export interface GroundingResult {
  passed: boolean;
  issues: GroundingIssue[];
}

/** Resultados reales de las tools, por nombre. La unica fuente de verdad. */
export type ActualToolResults = Map<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Compara la respuesta final contra los resultados reales.
 *
 * Toda divergencia es GROUNDING_MISMATCH: el job NO se marca VERIFIED por ese
 * resultado (doc 00 §11A).
 */
export function checkGrounding(
  answer: FinalAnswer,
  actual: ActualToolResults,
  executedSuccessfully: Set<string>,
): GroundingResult {
  const issues: GroundingIssue[] = [];

  // --- providerStatus contra get_provider_status ---
  const providerResult = asRecord(actual.get('get_provider_status'));
  if (providerResult) {
    const realStatus = providerResult['status'];
    if (typeof realStatus === 'string' && realStatus !== answer.providerStatus) {
      issues.push({
        field: 'providerStatus',
        expected: realStatus,
        claimed: answer.providerStatus,
        failureCode: 'F3',
        reason: 'final answer contradicts the provider status returned by the tool',
      });
    }
  } else if (executedSuccessfully.size > 0) {
    // Afirma un estado sin haber consultado nunca al provider.
    issues.push({
      field: 'providerStatus',
      expected: '(tool never returned a status)',
      claimed: answer.providerStatus,
      failureCode: 'F4',
      reason: 'provider status asserted without a successful get_provider_status result',
    });
  }

  // --- expectedAmountAtomic contra calculate_expected_cost ---
  const costResult = asRecord(actual.get('calculate_expected_cost'));
  const jobResult = asRecord(actual.get('get_job_metadata'));

  let expectedAmount: string | undefined;
  if (costResult && typeof costResult['expectedAmountAtomic'] === 'string') {
    expectedAmount = costResult['expectedAmountAtomic'];
  } else if (jobResult && providerResult) {
    // El modelo pudo saltarse la calculadora. Se recalcula localmente con la
    // MISMA funcion pura que usa la tool, para no premiar el atajo.
    const inputTokens = jobResult['inputTokens'];
    const outputTokens = jobResult['outputTokens'];
    const price = providerResult['pricePer1kTokensAtomic'];
    if (
      typeof inputTokens === 'number' &&
      typeof outputTokens === 'number' &&
      typeof price === 'string'
    ) {
      try {
        expectedAmount = computeExpectedCostAtomic({
          inputTokens,
          outputTokens,
          pricePer1kTokensAtomic: price,
        });
      } catch {
        expectedAmount = undefined;
      }
    }
  }

  if (expectedAmount !== undefined) {
    if (answer.expectedAmountAtomic !== expectedAmount) {
      issues.push({
        field: 'expectedAmountAtomic',
        expected: expectedAmount,
        claimed: answer.expectedAmountAtomic,
        failureCode: 'F4',
        reason: 'final amount does not match the deterministic tool computation',
      });
    }

    // --- quoteConsistent se recalcula, no se acepta ---
    const quoted = jobResult?.['quotedAmountAtomic'];
    if (typeof quoted === 'string') {
      const realConsistent = expectedAmount === quoted;
      if (answer.quoteConsistent !== realConsistent) {
        issues.push({
          field: 'quoteConsistent',
          expected: String(realConsistent),
          claimed: String(answer.quoteConsistent),
          failureCode: 'F3',
          reason: 'quote consistency contradicts the recorded quote',
        });
      }
    }
  } else if (executedSuccessfully.size > 0) {
    issues.push({
      field: 'expectedAmountAtomic',
      expected: '(no tool produced a cost)',
      claimed: answer.expectedAmountAtomic,
      failureCode: 'F4',
      reason: 'cost asserted without any successful cost computation',
    });
  }

  // --- evidence debe corresponder a tools realmente ejecutadas con exito ---
  for (const claimed of answer.evidence) {
    if (!executedSuccessfully.has(claimed)) {
      issues.push({
        field: 'evidence',
        expected: [...executedSuccessfully].join(',') || '(none)',
        claimed,
        failureCode: 'F4',
        reason: 'evidence cites a tool that did not execute successfully',
      });
    }
  }

  return { passed: issues.length === 0, issues };
}
