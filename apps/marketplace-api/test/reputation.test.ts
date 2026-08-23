import type { ProviderPublicDTO, ProviderRegisterRequest } from '@meshcompute/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMarketplaceApp, type MarketplaceContext } from '../src/app.js';
import { loadConfig, type MarketplaceConfig } from '../src/config.js';
import { openDatabase, type SqliteDatabase } from '../src/db/connection.js';
import { ProviderRepository } from '../src/db/core/provider-repository.js';

const config: MarketplaceConfig = {
  ...loadConfig({}),
  DATABASE_URL: ':memory:',
  LOG_LEVEL: 'silent',
};

const providerPayload: ProviderRegisterRequest = {
  name: 'Reputation-PC',
  qvacPublicKey: 'reputation-provider-key-000001',
  walletAddress: '0x00000000000000000000000000000000000000c1',
  modelKey: 'demo-llm',
  modelLabel: 'Llama-3.2-1B-Q4',
  hardwareLabel: 'RTX-4070',
  pricePer1kTokensAtomic: '2000',
};

describe('Reputation (M6)', () => {
  let app: FastifyInstance;
  let context: MarketplaceContext;
  let database: SqliteDatabase;

  beforeEach(async () => {
    database = openDatabase(':memory:');
    const built = await buildMarketplaceApp({
      config,
      database,
      logger: false,
      startOfflineMonitor: false,
    });
    app = built.app;
    context = built.context;
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  async function registerProvider(): Promise<{ id: string }> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/providers/register',
      payload: providerPayload,
    });
    return (response.json() as { provider: { id: string } }).provider;
  }

  async function createJob(providerId: string): Promise<{ jobId: string; executionToken: string }> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      payload: { providerId, modelKey: providerPayload.modelKey, promptHash: 'a'.repeat(64) },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { jobId: string; executionToken: string };
  }

  async function progress(
    job: { jobId: string; executionToken: string },
    payloads: Array<Record<string, unknown>>,
  ): Promise<void> {
    for (const payload of payloads) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/jobs/${job.jobId}/progress`,
        headers: { 'x-execution-token': job.executionToken },
        payload,
      });
      expect(response.statusCode).toBe(200);
    }
  }

  function getProvider(id: string): ProviderPublicDTO {
    return context.providerService.get(id);
  }

  it('adds +1 and jobs_completed once per PAID job, even with repeated settles (T-08)', async () => {
    const provider = await registerProvider();
    expect(getProvider(provider.id).reputation).toBe(95);

    const job = await createJob(provider.id);
    await progress(job, [
      { status: 'CONNECTING' },
      { status: 'RUNNING' },
      { status: 'VERIFYING', outputHash: 'b'.repeat(64) },
      { status: 'VERIFIED' }, // AUTO_SETTLE default: queda PAID y aplica +1
    ]);

    expect(getProvider(provider.id)).toMatchObject({ reputation: 96, jobsCompleted: 1, jobsFailed: 0 });

    // Settle manual repetido: idempotente tambien para reputacion.
    const settle = await app.inject({ method: 'POST', url: `/v1/jobs/${job.jobId}/settle` });
    expect(settle.statusCode).toBe(200);
    expect(getProvider(provider.id)).toMatchObject({ reputation: 96, jobsCompleted: 1 });
  });

  it('subtracts 5 on FAILED and 10 on VERIFICATION_FAILED, once per job', async () => {
    const provider = await registerProvider();

    const failed = await createJob(provider.id);
    await progress(failed, [{ status: 'CONNECTING' }, { status: 'FAILED' }]);
    expect(getProvider(provider.id)).toMatchObject({ reputation: 90, jobsFailed: 1 });

    const rejected = await createJob(provider.id);
    await progress(rejected, [
      { status: 'CONNECTING' },
      { status: 'RUNNING' },
      { status: 'VERIFYING', outputHash: 'c'.repeat(64) },
      { status: 'VERIFICATION_FAILED' },
    ]);
    expect(getProvider(provider.id)).toMatchObject({ reputation: 80, jobsFailed: 2, jobsCompleted: 0 });
  });

  it('clamps reputation to the 0..100 range', async () => {
    const provider = await registerProvider();
    const repository = new ProviderRepository(database);
    const now = new Date().toISOString();

    for (let i = 0; i < 15; i += 1) {
      repository.applyReputationEvent(provider.id, -10, 'FAILED', now);
    }
    expect(getProvider(provider.id).reputation).toBe(0);

    for (let i = 0; i < 150; i += 1) {
      repository.applyReputationEvent(provider.id, 1, 'COMPLETED', now);
    }
    expect(getProvider(provider.id).reputation).toBe(100);
  });
});
