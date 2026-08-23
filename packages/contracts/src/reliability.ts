/**
 * Contratos locales de reliability.
 *
 * Doc 00 §8: estos tipos pertenecen a la frontera Web <-> Consumer Agent y
 * NO a la persistencia central.
 *
 * PRIVACIDAD (doc 00 §8 / RNF-14): `trace` no contiene prompt completo ni raw
 * tool results. Solo nombres de tools, estados, tiempos, codigos de error y
 * metadatos seguros para la demo.
 */

export type ReliabilityFinalStatus =
  | 'PASSED'
  | 'REFUSED'
  | 'FAILED';

export interface ToolTraceItem {
  turn: number;
  toolName: string;
  argsValid: boolean;
  executionStatus: 'SUCCESS' | 'ERROR' | 'REJECTED';
  durationMs: number;
  retryCount: number;
  errorCode?: string;
}

export interface ReliabilitySummary {
  status: ReliabilityFinalStatus;
  requiredTools?: number;
  successfulTools: number;
  failedTools: number;
  retries: number;
  schemaPassed: boolean;
  groundingPassed: boolean;
  refusalReason?: string;
  trace: ToolTraceItem[];
}

/**
 * Failure taxonomy Track 2. Doc 00 §11A / doc 01 §18B.
 * Los resultados del benchmark conservan al menos conteo por failureCode.
 */
export const FAILURE_CODES = {
  F1: 'WRONG_TOOL',
  F2: 'INVALID_ARGS',
  F3: 'IGNORED_TOOL_RESULT',
  F4: 'HALLUCINATED_RESULT',
  F5: 'TOOL_LOOP',
  F6: 'MAX_TURNS',
  F7: 'FINAL_SCHEMA_INVALID',
  F8: 'PROVIDER_TIMEOUT',
  F9: 'TOOL_SCOPE_VIOLATION',
} as const;

export type FailureCodeId = keyof typeof FAILURE_CODES;
export type FailureCodeName = (typeof FAILURE_CODES)[FailureCodeId];

export const FAILURE_CODE_IDS = Object.keys(FAILURE_CODES) as FailureCodeId[];

/** Nombre -> id, para agrupar conteos en el benchmark. */
export const FAILURE_NAME_TO_ID: Record<FailureCodeName, FailureCodeId> =
  Object.fromEntries(
    Object.entries(FAILURE_CODES).map(([id, name]) => [name, id]),
  ) as Record<FailureCodeName, FailureCodeId>;
