/**
 * Enumeraciones compartidas del control plane.
 *
 * Doc 00 §8. CONGELADO: cualquier cambio aqui rompe a los tres integrantes.
 * Si algo tiene que cambiar, se comunica primero (doc 00 §4).
 */

export type ProviderStatus =
  | 'ONLINE'
  | 'OFFLINE'
  | 'BUSY';

export type JobStatus =
  | 'CREATED'
  | 'ASSIGNED'
  | 'CONNECTING'
  | 'RUNNING'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'VERIFICATION_FAILED'
  | 'PAYMENT_PENDING'
  | 'PAID'
  | 'PAYMENT_FAILED'
  | 'FAILED'
  | 'CANCELLED';

export type VerificationStatus =
  | 'NOT_REQUESTED'
  | 'PENDING'
  | 'PASSED'
  | 'FAILED';

export type PaymentStatus =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'PAID'
  | 'FAILED';

export const PAYMENT_MODES = ['SIMULATED', 'WDK_TESTNET'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export type PricingMode = 'PER_JOB';

export const PROVIDER_STATUSES = ['ONLINE', 'OFFLINE', 'BUSY'] as const;

export const JOB_STATUSES = [
  'CREATED',
  'ASSIGNED',
  'CONNECTING',
  'RUNNING',
  'VERIFYING',
  'VERIFIED',
  'VERIFICATION_FAILED',
  'PAYMENT_PENDING',
  'PAID',
  'PAYMENT_FAILED',
  'FAILED',
  'CANCELLED',
] as const;

export const VERIFICATION_STATUSES = [
  'NOT_REQUESTED',
  'PENDING',
  'PASSED',
  'FAILED',
] as const;

export const PAYMENT_STATUSES = [
  'NOT_STARTED',
  'PENDING',
  'PAID',
  'FAILED',
] as const;

/**
 * Unicos estados que el Consumer Agent puede emitir hacia la API central.
 * Doc 01 §25: "No inventes nuevos estados."
 */
export const CONSUMER_EMITTABLE_STATUSES = [
  'CONNECTING',
  'RUNNING',
  'VERIFYING',
  'VERIFIED',
  'VERIFICATION_FAILED',
  'FAILED',
] as const satisfies readonly JobStatus[];

export type ConsumerEmittableStatus = (typeof CONSUMER_EMITTABLE_STATUSES)[number];
