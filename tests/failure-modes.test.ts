/**
 * Modos de fallo del Consumer Agent. Doc 01 §26 / doc 00 §35.
 *
 * T-05 es el mas importante de todos: con `fallbackToLocal=false`, apagar el
 * provider DEBE producir un error. Si la inferencia se ejecutase en local,
 * la demo estaria mintiendo sobre lo unico que el producto tiene que probar.
 */

import { createLogger } from '@meshcompute/config';
import type { LocalInferenceRequest } from '@meshcompute/contracts';
import {
  MOCK_PROVIDER_PUBLIC_KEY,
  MockQvacConsumer,
  QvacAdapterError,
} from '@meshcompute/qvac-adapter';
import { describe, expect, it, vi } from 'vitest';
import type { ConsumerConfig } from '../apps/consumer-agent/src/config.js';
import { ConsumerError } from '../apps/consumer-agent/src/errors.js';
import {
  FIXTURE_JOB_ID,
  FIXTURE_PROVIDER_ID,
  fixtureJobs,
  fixtureProviders,
} from '../apps/consumer-agent/src/fixtures/demo-fixtures.js';
import { InferenceService } from '../apps/consumer-agent/src/inference-service.js';
import { DisabledConsumerMarketplaceClient } from '../apps/consumer-agent/src/marketplace-client.js';

const logger = createLogger('test', 'error');

const config = {
  CONSUMER_PORT: 0,
  PORT: 0,
  port: 5050,
  MARKETPLACE_API_URL: 'http://localhost:4000',
  MARKETPLACE_DISABLED: true,
  WEB_ORIGIN: 'http://localhost:3000',
  QVAC_FIRST_CONNECT_TIMEOUT_MS: 5_000,
  QVAC_FALLBACK_TO_LOCAL: false,
  CONSUMER_MODEL_KEY: 'tooluse-llm',
  RELIABILITY_ENABLED: true,
  MAX_TOOL_TURNS: 4,
  MAX_TOOL_RETRIES: 1,
  MAX_FINAL_SCHEMA_RETRIES: 1,
  TOOL_TIMEOUT_MS: 1_000,
  QVAC_ADAPTER: 'mock',
  LOG_LEVEL: 'error',
} as unknown as ConsumerConfig;

function request(overrides: Partial<LocalInferenceRequest> = {}): LocalInferenceRequest {
  return {
    jobId: FIXTURE_JOB_ID,
    executionToken: 'token',
    provider: {
      id: FIXTURE_PROVIDER_ID,
      qvacPublicKey: MOCK_PROVIDER_PUBLIC_KEY,
      modelKey: 'tooluse-llm',
    },
    prompt: 'Analyze this job.',
    verificationMode: 'LOCAL_SCHEMA',
    ...overrides,
  };
}

function makeService(qvac: MockQvacConsumer): InferenceService {
  const marketplace = new DisabledConsumerMarketplaceClient(logger, {
    providers: fixtureProviders(),
    jobs: fixtureJobs(),
  });
  return new InferenceService({ config, logger, qvac, marketplace });
}

describe('T-05: sin fallback local', () => {
  it('un provider apagado produce PROVIDER_UNREACHABLE, no un resultado local', async () => {
    const qvac = new MockQvacConsumer({
      ids: { jobId: FIXTURE_JOB_ID, providerId: FIXTURE_PROVIDER_ID },
      unreachable: true,
    });
    const service = makeService(qvac);

    await expect(service.run(request())).rejects.toMatchObject({
      code: 'PROVIDER_UNREACHABLE',
    });
  });

  it('la config de la demo mantiene fallbackToLocal en false', () => {
    // Si esto cambiara, T-05 dejaria de probar nada.
    expect(config.QVAC_FALLBACK_TO_LOCAL).toBe(false);
  });
});

describe('validacion de la public key', () => {
  it('rechaza una key que no sea 64 hex antes de intentar conectar', async () => {
    const qvac = new MockQvacConsumer({
      ids: { jobId: FIXTURE_JOB_ID, providerId: FIXTURE_PROVIDER_ID },
    });
    const service = makeService(qvac);

    await expect(
      service.run(
        request({
          provider: {
            id: FIXTURE_PROVIDER_ID,
            qvacPublicKey: 'not-a-valid-key',
            modelKey: 'tooluse-llm',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

describe('CONSUMER_AGENT_BUSY', () => {
  it('rechaza una segunda inferencia mientras hay una en curso', async () => {
    const qvac = new MockQvacConsumer({
      ids: { jobId: FIXTURE_JOB_ID, providerId: FIXTURE_PROVIDER_ID },
    });
    const service = makeService(qvac);

    const first = service.run(request());
    // La segunda entra mientras la primera sigue viva.
    await expect(service.run(request())).rejects.toMatchObject({
      code: 'CONSUMER_AGENT_BUSY',
    });
    await first;
    expect(service.isBusy()).toBe(false);
  });
});

describe('resiliencia del marketplace (doc 01 §26)', () => {
  it('la inferencia termina aunque el reporte de progreso falle', async () => {
    const qvac = new MockQvacConsumer({
      ids: { jobId: FIXTURE_JOB_ID, providerId: FIXTURE_PROVIDER_ID },
    });
    const marketplace = new DisabledConsumerMarketplaceClient(logger, {
      providers: fixtureProviders(),
      jobs: fixtureJobs(),
    });
    // El control plane se cae a mitad: reportar estado falla siempre.
    vi.spyOn(marketplace, 'patchProgress').mockRejectedValue(new Error('API down'));

    const service = new InferenceService({ config, logger, qvac, marketplace });
    const response = await service.run(request());

    // Un fallo al reportar NO puede tumbar un job que si se ejecuto.
    expect(response.content).toContain('expectedAmountAtomic');
    expect(response.outputHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('mapeo de errores del adapter', () => {
  it('cada codigo del adapter tiene su ConsumerError y su HTTP', () => {
    const cases: Array<[string, number]> = [
      ['PROVIDER_UNREACHABLE', 502],
      ['INFERENCE_TIMEOUT', 504],
      ['VERIFICATION_FAILED', 422],
      ['INVALID_REQUEST', 400],
      ['CONSUMER_AGENT_BUSY', 409],
      ['QVAC_UNAVAILABLE', 503],
    ];
    for (const [code, status] of cases) {
      const error = new ConsumerError(code as never);
      expect(error.httpStatus).toBe(status);
      expect(error.toDTO().code).toBe(code);
      expect(error.toDTO().message.length).toBeGreaterThan(0);
    }
  });

  it('QvacAdapterError expone un codigo estable', () => {
    const error = new QvacAdapterError('PROVIDER_UNREACHABLE', 'peer gone');
    expect(error.code).toBe('PROVIDER_UNREACHABLE');
    expect(error.name).toBe('QvacAdapterError');
  });
});
