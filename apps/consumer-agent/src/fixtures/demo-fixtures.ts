/**
 * Fixtures deterministas para trabajar sin el Marketplace API.
 *
 * Doc 00 §31: "A debe tener fixtures deterministas para tool results
 * (provider, job, calculator) y poder desarrollar M2R sin esperar a B."
 *
 * Los numeros estan elegidos para que el ejemplo del doc 00 §11A salga exacto:
 *   (1200 + 340) tokens * 2000 / 1000 = 3080  -> no coincide con el quote
 * Se ajusta el precio para reproducir el 2310 del documento:
 *   (1200 + 340) * 1500 / 1000 = 2310
 * y el quote registrado es 2800, de modo que `quoteConsistent` es false y el
 * caso de grounding conflict del doc tiene sentido literal.
 */

import type { JobMetadataDTO, ProviderPublicDTO } from '@meshcompute/contracts';

export const FIXTURE_PROVIDER_ID = 'p_001';
export const FIXTURE_JOB_ID = 'job_123';

export const fixtureProvider: ProviderPublicDTO = {
  id: FIXTURE_PROVIDER_ID,
  name: 'Gaming-PC-01',
  qvacPublicKey: 'a'.repeat(64),
  walletAddress: '0x0000000000000000000000000000000000000001',
  modelKey: 'tooluse-llm',
  modelLabel: 'Qwen3-1.7B-Instruct-Q4',
  hardwareLabel: 'RTX-4070',
  pricePer1kTokensAtomic: '1500',
  pricingMode: 'PER_JOB',
  tokenSymbol: 'mUSDT',
  status: 'ONLINE',
  reputation: 95,
  jobsCompleted: 12,
  jobsFailed: 0,
  lastSeen: '2026-08-22T10:00:00.000Z',
};

export const fixtureJob: JobMetadataDTO = {
  id: FIXTURE_JOB_ID,
  providerId: FIXTURE_PROVIDER_ID,
  modelKey: 'tooluse-llm',
  promptHash: 'b'.repeat(64),
  inputTokens: 1200,
  outputTokens: 340,
  durationMs: 1820,
  // Deliberadamente distinto del coste real (2310) para que el escenario
  // "el quote registrado no es consistente" sea comprobable.
  quotedAmountAtomic: '2800',
  status: 'RUNNING',
  verificationStatus: 'PENDING',
  paymentStatus: 'NOT_STARTED',
  createdAt: '2026-08-22T10:00:00.000Z',
  updatedAt: '2026-08-22T10:00:00.000Z',
};

export function fixtureProviders(): Map<string, ProviderPublicDTO> {
  return new Map([[FIXTURE_PROVIDER_ID, fixtureProvider]]);
}

export function fixtureJobs(): Map<string, JobMetadataDTO> {
  return new Map([[FIXTURE_JOB_ID, fixtureJob]]);
}

/** Coste esperado con los fixtures: (1200+340)*1500/1000 = 2310. */
export const FIXTURE_EXPECTED_COST_ATOMIC = '2310';
