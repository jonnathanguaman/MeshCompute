import type { JobMetadataDTO, ProviderRegisterRequest } from '@meshcompute/contracts';
import {
  PaymentAdapterError,
  type PaymentAdapter,
  type PaymentRequest,
  type PaymentResult,
} from '@meshcompute/payment-adapter';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMarketplaceApp, type MarketplaceContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type SqliteDatabase } from '../src/db/connection.js';

const config = {
  ...loadConfig({}),
  HOST: '127.0.0.1',
  DATABASE_URL: ':memory:',
  // Estos tests ejercitan el endpoint de settle manual de forma aislada.
  AUTO_SETTLE: false,
  LOG_LEVEL: 'silent' as const,
};

const providerPayload: ProviderRegisterRequest = {
  name: 'Testnet Provider',
  qvacPublicKey: 'qvac-testnet-provider-key-0001',
  walletAddress: '0x3333333333333333333333333333333333333333',
  modelKey: 'demo-llm',
  modelLabel: 'Testnet model',
  hardwareLabel: 'Testnet hardware',
  pricePer1kTokensAtomic: '2000',
};

const testnetResult: PaymentResult = {
  status: 'PAID',
  mode: 'WDK_TESTNET',
  txHash: `0x${'b'.repeat(64)}`,
  feeAtomic: '90000',
  senderAddress: '0x2222222222222222222222222222222222222222',
  chainId: 11_155_111,
};

function testnetAdapter(settle = vi.fn().mockResolvedValue(testnetResult)): PaymentAdapter & {
  settle: typeof settle;
} {
  return {
    mode: 'WDK_TESTNET',
    tokenAddress: '0x1111111111111111111111111111111111111111',
    settle,
    dispose: vi.fn(),
  };
}

describe('economic settlement routes', () => {
  let app: FastifyInstance;
  let context: MarketplaceContext;
  let database: SqliteDatabase;
  let adapter: ReturnType<typeof testnetAdapter>;

  beforeEach(async () => {
    database = openDatabase(':memory:');
    adapter = testnetAdapter();
    const built = await buildMarketplaceApp({
      config,
      database,
      paymentAdapter: adapter,
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

  async function verifiedJob(): Promise<{ jobId: string; executionToken: string }> {
    const registration = await app.inject({
      method: 'POST',
      url: '/v1/providers/register',
      payload: providerPayload,
    });
    const providerId = registration.json<{ provider: { id: string } }>().provider.id;
    const creation = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      payload: { providerId, modelKey: providerPayload.modelKey, promptHash: 'a'.repeat(64) },
    });
    const created = creation.json<{ jobId: string; executionToken: string }>();
    for (const status of ['CONNECTING', 'RUNNING', 'VERIFYING'] as const) {
      const progress = await app.inject({
        method: 'PATCH',
        url: `/v1/jobs/${created.jobId}/progress`,
        headers: { 'x-execution-token': created.executionToken },
        payload: { status },
      });
      expect(progress.statusCode).toBe(200);
    }
    const verified = await app.inject({
      method: 'PATCH',
      url: `/v1/jobs/${created.jobId}/progress`,
      headers: { 'x-execution-token': created.executionToken },
      payload: { status: 'VERIFIED', outputHash: 'c'.repeat(64), verificationStatus: 'PASSED' },
    });
    expect(verified.statusCode).toBe(200);
    return created;
  }

  it('settles a verified job on testnet and records an auditable attempt', async () => {
    const { jobId } = await verifiedJob();
    const response = await app.inject({ method: 'POST', url: `/v1/jobs/${jobId}/settle` });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ job: JobMetadataDTO }>().job).toMatchObject({
      id: jobId,
      status: 'PAID',
      paymentStatus: 'PAID',
      paymentMode: 'WDK_TESTNET',
      paymentTxHash: testnetResult.txHash,
      settledAmountAtomic: '2000',
    });
    expect(adapter.settle).toHaveBeenCalledWith({
      jobId,
      recipient: providerPayload.walletAddress,
      amountAtomic: '2000',
    });
    expect(context.paymentAttemptRepository.findByJobId(jobId)).toMatchObject({
      status: 'PAID',
      mode: 'WDK_TESTNET',
      txHash: testnetResult.txHash,
      feeAtomic: '90000',
      chainId: 11_155_111,
      tokenAddress: adapter.tokenAddress,
    });
  });

  it('is idempotent and never broadcasts the same job twice', async () => {
    const { jobId } = await verifiedJob();
    const first = await app.inject({ method: 'POST', url: `/v1/jobs/${jobId}/settle` });
    const second = await app.inject({ method: 'POST', url: `/v1/jobs/${jobId}/settle` });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json<{ job: JobMetadataDTO }>().job.paymentTxHash).toBe(testnetResult.txHash);
    expect(adapter.settle).toHaveBeenCalledOnce();
    expect(context.paymentAttemptRepository.countForJob(jobId)).toBe(1);
  });

  it('rejects an unverified job without creating a payment attempt', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/v1/providers/register',
      payload: providerPayload,
    });
    const providerId = registration.json<{ provider: { id: string } }>().provider.id;
    const creation = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      payload: { providerId, modelKey: providerPayload.modelKey, promptHash: 'a'.repeat(64) },
    });
    const jobId = creation.json<{ jobId: string }>().jobId;
    const response = await app.inject({ method: 'POST', url: `/v1/jobs/${jobId}/settle` });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'JOB_NOT_VERIFIED' });
    expect(adapter.settle).not.toHaveBeenCalled();
    expect(context.paymentAttemptRepository.countForJob(jobId)).toBe(0);
  });

  it('persists a safe failure code and moves the job to PAYMENT_FAILED', async () => {
    adapter.settle.mockRejectedValueOnce(
      new PaymentAdapterError(
        'INSUFFICIENT_GAS_BALANCE',
        'synthetic secret-bearing provider error',
      ),
    );
    const { jobId } = await verifiedJob();
    const response = await app.inject({ method: 'POST', url: `/v1/jobs/${jobId}/settle` });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      code: 'PAYMENT_FAILED',
      details: { reasonCode: 'INSUFFICIENT_GAS_BALANCE' },
    });
    expect(JSON.stringify(response.json())).not.toContain('secret-bearing');
    expect(context.jobService.get(jobId)).toMatchObject({
      status: 'PAYMENT_FAILED',
      paymentStatus: 'FAILED',
      paymentErrorCode: 'INSUFFICIENT_GAS_BALANCE',
    });
  });

  it('locks concurrent settlement before awaiting the wallet', async () => {
    let release: ((value: PaymentResult) => void) | undefined;
    const pending = new Promise<PaymentResult>((resolve) => {
      release = resolve;
    });
    adapter.settle.mockImplementationOnce(async (_input: PaymentRequest) => pending);
    const { jobId } = await verifiedJob();
    const firstPromise = app.inject({ method: 'POST', url: `/v1/jobs/${jobId}/settle` });
    await vi.waitFor(() => expect(adapter.settle).toHaveBeenCalledOnce());
    const second = await app.inject({ method: 'POST', url: `/v1/jobs/${jobId}/settle` });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: 'PAYMENT_IN_PROGRESS' });
    release?.(testnetResult);
    const first = await firstPromise;
    expect(first.statusCode).toBe(200);
    expect(adapter.settle).toHaveBeenCalledOnce();
  });

  it('reports marketplace statistics without floating point payment sums', async () => {
    const { jobId } = await verifiedJob();
    await app.inject({ method: 'POST', url: `/v1/jobs/${jobId}/settle` });
    const response = await app.inject({ method: 'GET', url: '/v1/stats' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      providersOnline: 1,
      jobsTotal: 1,
      jobsVerified: 1,
      successRate: 100,
      totalPaidAtomic: '2000',
    });
  });
});
