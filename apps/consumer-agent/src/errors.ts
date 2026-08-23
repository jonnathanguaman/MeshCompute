/**
 * Errores del Consumer Agent hacia la UI. Doc 01 §26.
 *
 * Se entregan a C como parte del handoff (doc 01 §39): la UI necesita poder
 * distinguir "el provider no responde" de "el resultado no verifico".
 */

import { CONSUMER_ERROR_CODES, type ApiErrorDTO, type ConsumerErrorCode } from '@meshcompute/contracts';

/** Codigo -> status HTTP. */
const HTTP_STATUS: Record<ConsumerErrorCode, number> = {
  PROVIDER_UNREACHABLE: 502,
  INFERENCE_TIMEOUT: 504,
  VERIFICATION_FAILED: 422,
  INVALID_REQUEST: 400,
  CONSUMER_AGENT_BUSY: 409,
  QVAC_UNAVAILABLE: 503,
};

export class ConsumerError extends Error {
  readonly code: ConsumerErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ConsumerErrorCode, details?: Record<string, unknown>) {
    super(CONSUMER_ERROR_CODES[code]);
    this.name = 'ConsumerError';
    this.code = code;
    this.details = details;
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }

  toDTO(): ApiErrorDTO {
    const dto: ApiErrorDTO = { code: this.code, message: this.message };
    if (this.details) dto.details = this.details;
    return dto;
  }
}
