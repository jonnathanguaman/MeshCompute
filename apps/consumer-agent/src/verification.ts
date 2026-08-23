/**
 * Verificacion local — M5, lado A. Doc 00 §14 / doc 01 §21-§23.
 *
 * Integrante A ejecuta la verificacion que necesita el contenido; a la API
 * central solo viajan hashes y el resultado (RF-V03). Las respuestas nunca
 * salen de esta maquina.
 */

import type { VerificationMode } from '@meshcompute/contracts';
import type { DelegatedSession } from '@meshcompute/qvac-adapter';
import { normalizeOutput, sha256 } from './hashing.js';

export interface VerificationOutcome {
  mode: VerificationMode;
  status: 'PASSED' | 'FAILED' | 'NOT_REQUESTED';
  verifierOutputHash?: string;
  /** Motivo del fallo, solo para la UI local. Nunca al control plane. */
  detail?: string;
}

export interface LocalSchemaInput {
  content: string;
  /** Regla adicional ya evaluada por el orchestrator (schema + grounding). */
  reliabilityPassed?: boolean;
}

/**
 * LOCAL_SCHEMA — MUST HAVE (doc 01 §21).
 *
 * 1. parse JSON;
 * 2. validar forma;
 * 3. validar la regla esperada.
 *
 * Para la tarea Track 2 la "regla esperada" es que el schema final y el
 * grounding hayan pasado: es la version util para el negocio de la misma idea.
 * Para la demo aritmetica clasica, `verifyExpectedAnswer` cubre el caso
 * `{"answer": 159654}`.
 */
export function verifyLocalSchema(input: LocalSchemaInput): VerificationOutcome {
  const { normalized, isJson } = normalizeOutput(input.content);

  if (!isJson) {
    return {
      mode: 'LOCAL_SCHEMA',
      status: 'FAILED',
      detail: 'output is not valid JSON',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    return { mode: 'LOCAL_SCHEMA', status: 'FAILED', detail: 'output is not valid JSON' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      mode: 'LOCAL_SCHEMA',
      status: 'FAILED',
      detail: 'output is not a JSON object',
    };
  }

  if (input.reliabilityPassed === false) {
    return {
      mode: 'LOCAL_SCHEMA',
      status: 'FAILED',
      detail: 'reliability checks (final schema / grounding) did not pass',
    };
  }

  return { mode: 'LOCAL_SCHEMA', status: 'PASSED' };
}

/**
 * Caso determinista clasico del doc 01 §21: `{"answer": <number>}`.
 * Se mantiene aparte porque es el ejemplo que valida la mecanica de
 * verificacion sin depender del Reliability Orchestrator.
 */
export function verifyExpectedAnswer(content: string, expected: number): VerificationOutcome {
  try {
    const { normalized } = normalizeOutput(content);
    const parsed: unknown = JSON.parse(normalized);
    const answer = (parsed as Record<string, unknown>)?.['answer'];

    if (typeof answer !== 'number') {
      return { mode: 'LOCAL_SCHEMA', status: 'FAILED', detail: '"answer" is not a number' };
    }
    if (answer !== expected) {
      return {
        mode: 'LOCAL_SCHEMA',
        status: 'FAILED',
        detail: `expected ${expected}, got ${answer}`,
      };
    }
    return { mode: 'LOCAL_SCHEMA', status: 'PASSED' };
  } catch {
    return { mode: 'LOCAL_SCHEMA', status: 'FAILED', detail: 'output is not valid JSON' };
  }
}

export interface RedundantVerificationInput {
  prompt: string;
  primaryOutputHash: string;
  verifierSession: DelegatedSession;
  /** Semilla fija para maximizar el determinismo (doc 01 §23). */
  seed?: number;
}

/**
 * REDUNDANT_DETERMINISTIC — SHOULD HAVE (doc 01 §22).
 *
 * El mismo prompt a un segundo provider; se normaliza, se hashea y se
 * comparan los hashes. La comparacion ocurre AQUI, en local: la API central
 * recibe solo `{verificationStatus, outputHash, verifierOutputHash}`.
 *
 * Determinismo (doc 01 §23): mismo modelo, temperatura 0, seed fijo y una
 * tarea que no sea una pregunta abierta. `temp` y `seed` existen de verdad en
 * `generationParams` del SDK (findings §3), asi que esto no es aspiracional.
 */
export async function verifyRedundant(
  input: RedundantVerificationInput,
): Promise<VerificationOutcome> {
  try {
    const outcome = await input.verifierSession.complete({
      history: [{ role: 'user', content: input.prompt }],
      generation: {
        temperature: 0,
        disableReasoning: true,
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
      },
    });

    const { normalized } = normalizeOutput(outcome.content);
    const verifierOutputHash = sha256(normalized);

    return {
      mode: 'REDUNDANT_DETERMINISTIC',
      status: verifierOutputHash === input.primaryOutputHash ? 'PASSED' : 'FAILED',
      verifierOutputHash,
      ...(verifierOutputHash === input.primaryOutputHash
        ? {}
        : { detail: 'verifier output hash differs from primary output hash' }),
    };
  } catch (error) {
    return {
      mode: 'REDUNDANT_DETERMINISTIC',
      status: 'FAILED',
      detail: `verifier provider failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function notRequested(): VerificationOutcome {
  return { mode: 'NONE', status: 'NOT_REQUESTED' };
}
