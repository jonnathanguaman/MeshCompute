import { createLogger } from '@meshcompute/config';
import type { JobCreateResponse, JobMetadataDTO, ProviderRegisterRequest } from '@meshcompute/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpConsumerMarketplaceClient } from '../apps/consumer-agent/src/marketplace-client.js';
import { buildMarketplaceApp } from '../apps/marketplace-api/src/app.js';
import { loadConfig } from '../apps/marketplace-api/src/config.js';
import { HttpMarketplaceClient } from '../apps/provider-agent/src/marketplace-client.js';

describe('integrated control plane', () => {
  const logger = createLogger('integration-test', 'error');
  let closeApp: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await closeApp?.();
    closeApp = undefined;
  });

  it('connects provider registration, UI job creation, consumer progress and settlement', async () => {
    const config = {
      ...loadConfig({ PAYMENT_MODE: 'SIMULATED' }),
      HOST: '127.0.0.1',
      PORT: 0,
      DATABASE_URL: ':memory:',
      LOG_LEVEL: 'silent' as const,
    };
    const { app } = await buildMarketplaceApp({
      config,
      logger: false,
      startOfflineMonitor: false,
    });
    closeApp = () => app.close();
    const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });

    const providerInput: ProviderRegisterRequest = {
      name: 'Remote QVAC PC',
      qvacPublicKey: 'a'.repeat(64),
      walletAddress: '0x0000000000000000000000000000000000000001',
      modelKey: 'demo-llm',
      modelLabel: 'Llama-3.2-1B-Instruct-Q4_0',
      hardwareLabel: 'Remote test machine',
      pricePer1kTokensAtomic: '2000',
    };
    const providerClient = new HttpMarketplaceClient(baseUrl, logger);
    const registration = await providerClient.register(providerInput);

    const consumerClient = new HttpConsumerMarketplaceClient(baseUrl, logger);
    const provider = await consumerClient.getProvider(registration.providerId);
    expect(provider).toMatchObject({
      id: registration.providerId,
      qvacPublicKey: providerInput.qvacPublicKey,
      pricingMode: 'PER_JOB',
    });

    const createdResponse = await fetch(`${baseUrl}/v1/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: registration.providerId,
        modelKey: providerInput.modelKey,
        promptHash: 'b'.repeat(64),
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as JobCreateResponse;

    await consumerClient.patchProgress(created.jobId, created.executionToken, {
      status: 'CONNECTING',
    });
    await consumerClient.patchProgress(created.jobId, created.executionToken, {
      status: 'RUNNING',
    });
    await consumerClient.patchProgress(created.jobId, created.executionToken, {
      status: 'VERIFYING',
      outputHash: 'c'.repeat(64),
      inputTokens: 24,
      outputTokens: 12,
      durationMs: 250,
    });
    await consumerClient.patchProgress(created.jobId, created.executionToken, {
      status: 'VERIFIED',
      verificationStatus: 'PASSED',
    });

    // AUTO_SETTLE (default): al reportar VERIFIED, la API liquida sola.
    const settledJob = await consumerClient.getJob(created.jobId);
    if (!settledJob) throw new Error('job not found after auto settlement');
    expect(settledJob).toMatchObject({
      status: 'PAID',
      outputHash: 'c'.repeat(64),
      paymentStatus: 'PAID',
      paymentMode: 'SIMULATED',
      settledAmountAtomic: created.quotedAmountAtomic,
    });
    expect(settledJob.paymentTxHash).toMatch(/^sim_/);

    // El endpoint manual sigue siendo idempotente sobre un job ya pagado.
    const settlementResponse = await fetch(`${baseUrl}/v1/jobs/${created.jobId}/settle`, {
      method: 'POST',
    });
    expect(settlementResponse.status).toBe(200);
    const settled = (await settlementResponse.json()) as { job: JobMetadataDTO };
    expect(settled.job.paymentTxHash).toBe(settledJob.paymentTxHash);
  });
});
