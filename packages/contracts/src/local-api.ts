/**
 * Contrato de la API local del Consumer Agent.
 *
 * Doc 00 §11 y §29. Esta frontera SI transporta el prompt: vive integramente
 * en loopback (127.0.0.1:5050) entre el browser del usuario y su propio
 * Consumer Agent. Nunca sale de la maquina hacia la API central.
 */

import type { ReliabilitySummary } from './reliability.js';

export type VerificationMode =
  | 'LOCAL_SCHEMA'
  | 'REDUNDANT_DETERMINISTIC'
  | 'NONE';

export const VERIFICATION_MODES = [
  'LOCAL_SCHEMA',
  'REDUNDANT_DETERMINISTIC',
  'NONE',
] as const;

export interface LocalInferenceRequest {
  jobId: string;
  executionToken: string;

  provider: {
    id: string;
    qvacPublicKey: string;
    modelKey: string;
  };

  verifier?: {
    id: string;
    qvacPublicKey: string;
  };

  prompt: string;

  verificationMode: VerificationMode;
}

export interface LocalInferenceResponse {
  jobId: string;
  content: string;

  outputHash: string;

  stats: {
    inputTokens?: number;
    outputTokens?: number;
    durationMs: number;
  };

  verification: {
    mode: string;
    status: 'PASSED' | 'FAILED' | 'NOT_REQUESTED';
    verifierOutputHash?: string;
  };

  reliability: ReliabilitySummary;
}

export interface LocalHealthResponse {
  status: 'ok';
  service: 'consumer-agent';
  qvacReady: boolean;
}

/**
 * Codigos de error que el Consumer Agent devuelve a la UI. Doc 01 §26.
 * Se entregan a C como parte del handoff (doc 01 §39).
 */
export const CONSUMER_ERROR_CODES = {
  PROVIDER_UNREACHABLE: 'Could not connect to the selected provider.',
  INFERENCE_TIMEOUT: 'The provider did not answer in time.',
  VERIFICATION_FAILED: 'The result did not pass local verification.',
  INVALID_REQUEST: 'The request payload is not valid.',
  CONSUMER_AGENT_BUSY: 'The local agent is already running an inference.',
  QVAC_UNAVAILABLE: 'The local QVAC runtime is not available.',
} as const;

export type ConsumerErrorCode = keyof typeof CONSUMER_ERROR_CODES;
