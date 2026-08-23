import type { ProviderRegisterRequest } from '@meshcompute/contracts';
import type { FastifyInstance } from 'fastify';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildMarketplaceApp,
  SENSITIVE_LOG_PATHS,
  type MarketplaceContext,
} from '../src/app.js';
import { loadConfig, type MarketplaceConfig } from '../src/config.js';
import { openDatabase, runMigrations, type SqliteDatabase } from '../src/db/connection.js';
import { JobRepository } from '../src/db/core/job-repository.js';

const config: MarketplaceConfig = {
  ...loadConfig({}),
  PORT: 4000,
  HOST: '127.0.0.1',
  WEB_URL: 'http://localhost:3000',
  DATABASE_URL: ':memory:',
  PROVIDER_OFFLINE_AFTER_MS: 30_000,
  PROVIDER_SWEEP_INTERVAL_MS: 5_000,
  PRICING_TIMEOUT_MS: 3_000,
  // Estos tests validan el flujo de settlement manual paso a paso.
  AUTO_SETTLE: false,
  LOG_LEVEL: 'silent',
};

const providerPayload: ProviderRegisterRequest = {
  name: 'Gaming-PC-01',
  qvacPublicKey: 'qvac-public-key-provider-0001',
  walletAddress: '0x00000000000000000000000000000000000000b1',
  modelKey: 'demo-llm',
  modelLabel: 'Llama-3.2-1B-Q4',
  hardwareLabel: 'RTX-4070',
  pricePer1kTokensAtomic: '2000',
  pricingMode: 'PER_JOB',
};

interface ProviderRegistration {
  provider: { id: string; status: string; [key: string]: unknown };
  providerToken: string;
}

interface JobCreation {
  jobId: string;
  executionToken: string;
  status: string;
  quotedAmountAtomic: string;
}

describe('Marketplace API core', () => {
  let app: FastifyInstance;
  let context: MarketplaceContext;
  let database: SqliteDatabase;
  let clock: Date;

  beforeEach(async () => {
    clock = new Date('2026-08-22T10:00:00.000Z');
    database = openDatabase(':memory:');
    const built = await buildMarketplaceApp({
      config,
      database,
      now: () => new Date(clock),
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

  async function registerProvider(
    overrides: Partial<typeof providerPayload> = {},
  ): Promise<ProviderRegistration> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/providers/register',
      payload: { ...providerPayload, ...overrides },
    });
    expect(response.statusCode).toBe(201);
    return response.json<ProviderRegistration>();
  }

  async function createJob(providerId: string): Promise<JobCreation> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      payload: {
        providerId,
        modelKey: providerPayload.modelKey,
        promptHash: 'a'.repeat(64),
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json<JobCreation>();
  }

  it('reports health', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'marketplace-api',
      database: 'ready',
    });
  });

  it('returns 503 when the SQLite readiness query fails', async () => {
    const prepare = vi.spyOn(database, 'prepare').mockImplementationOnce(() => {
      throw new Error('synthetic database failure');
    });
    const response = await app.inject({ method: 'GET', url: '/health' });
    prepare.mockRestore();

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'error',
      service: 'marketplace-api',
      database: 'unavailable',
    });
  });

  it('emits CORS headers only for the configured web origin', async () => {
    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: config.WEB_URL },
    });
    const disallowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://untrusted.example' },
    });

    expect(allowed.headers['access-control-allow-origin']).toBe(config.WEB_URL);
    expect(disallowed.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('keeps provider and execution token headers in the logger redaction list', () => {
    expect(SENSITIVE_LOG_PATHS).toContain('req.headers.authorization');
    expect(SENSITIVE_LOG_PATHS).toContain('req.headers.x-execution-token');
  });

  it('registers and upserts a provider without exposing token hashes', async () => {
    const first = await registerProvider();
    const second = await registerProvider({ name: 'Gaming-PC-Renamed' });

    expect(second.provider.id).toBe(first.provider.id);
    expect(second.provider.name).toBe('Gaming-PC-Renamed');
    expect(second.providerToken).not.toBe(first.providerToken);

    const list = await app.inject({ method: 'GET', url: '/v1/providers' });
    const serialized = list.body;
    expect(serialized).not.toContain('providerToken');
    expect(serialized).not.toContain(first.providerToken);
    expect(serialized).not.toContain(second.providerToken);
  });

  it('invalidates the previous provider token after re-registration', async () => {
    const first = await registerProvider();
    const second = await registerProvider();

    const oldToken = await app.inject({
      method: 'POST',
      url: `/v1/providers/${first.provider.id}/heartbeat`,
      headers: { authorization: `Bearer ${first.providerToken}` },
    });
    const currentToken = await app.inject({
      method: 'POST',
      url: `/v1/providers/${second.provider.id}/heartbeat`,
      headers: { authorization: `Bearer ${second.providerToken}` },
    });

    expect(oldToken.statusCode).toBe(401);
    expect(currentToken.statusCode).toBe(200);
  });

  it('authenticates heartbeats and marks stale providers offline deterministically', async () => {
    const registration = await registerProvider();

    const invalid = await app.inject({
      method: 'POST',
      url: `/v1/providers/${registration.provider.id}/heartbeat`,
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json().code).toBe('INVALID_PROVIDER_TOKEN');

    clock = new Date(clock.getTime() + 31_000);
    expect(context.providerService.markStaleProvidersOffline()).toBe(1);
    expect(context.providerService.get(registration.provider.id).status).toBe('OFFLINE');

    const heartbeat = await app.inject({
      method: 'POST',
      url: `/v1/providers/${registration.provider.id}/heartbeat`,
      headers: { authorization: `Bearer ${registration.providerToken}` },
    });
    expect(heartbeat.statusCode).toBe(200);
    expect(heartbeat.json().provider.status).toBe('ONLINE');
  });

  it('supports explicit provider status filters while returning all statuses by default', async () => {
    await registerProvider();
    clock = new Date(clock.getTime() + 31_000);
    context.providerService.markStaleProvidersOffline();

    const all = await app.inject({ method: 'GET', url: '/v1/providers' });
    const online = await app.inject({ method: 'GET', url: '/v1/providers?status=ONLINE' });
    expect(all.json().providers).toHaveLength(1);
    expect(online.json().providers).toHaveLength(0);
  });

  it('creates and atomically assigns a metadata-only job', async () => {
    const registration = await registerProvider();
    const created = await createJob(registration.provider.id);

    expect(created.status).toBe('ASSIGNED');
    expect(created.quotedAmountAtomic).toBe('2000');
    expect(created.executionToken).toBeTruthy();

    const detail = await app.inject({ method: 'GET', url: `/v1/jobs/${created.jobId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().job).toMatchObject({
      status: 'ASSIGNED',
      promptHash: 'a'.repeat(64),
      quotedAmountAtomic: '2000',
    });
    expect(detail.body).not.toContain('executionToken');
    expect(detail.body).not.toContain('providerWalletAddress');
  });

  it('freezes quote and provider wallet snapshots when the provider changes later', async () => {
    const registration = await registerProvider();
    const firstJob = await createJob(registration.provider.id);

    await registerProvider({
      walletAddress: '0x00000000000000000000000000000000000000b2',
      pricePer1kTokensAtomic: '9000',
    });

    const settlement = context.jobService.getForSettlement(firstJob.jobId);
    expect(settlement.quotedAmountAtomic).toBe('2000');
    expect(settlement.walletAddress).toBe('0x00000000000000000000000000000000000000b1');

    const secondJob = await createJob(registration.provider.id);
    expect(secondJob.quotedAmountAtomic).toBe('9000');
  });

  it('rejects jobs for offline, missing, or model-incompatible providers', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      payload: { providerId: 'p_missing', modelKey: 'demo-llm', promptHash: 'a'.repeat(64) },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('PROVIDER_NOT_FOUND');

    const registration = await registerProvider();
    const mismatch = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      payload: {
        providerId: registration.provider.id,
        modelKey: 'other-model',
        promptHash: 'a'.repeat(64),
      },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().code).toBe('PROVIDER_MODEL_MISMATCH');

    clock = new Date(clock.getTime() + 31_000);
    context.providerService.markStaleProvidersOffline();
    const offline = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      payload: {
        providerId: registration.provider.id,
        modelKey: 'demo-llm',
        promptHash: 'a'.repeat(64),
      },
    });
    expect(offline.statusCode).toBe(409);
    expect(offline.json().code).toBe('PROVIDER_OFFLINE');
  });

  it('enforces execution tokens and the job state machine', async () => {
    const registration = await registerProvider();
    const job = await createJob(registration.provider.id);

    const wrongToken = await app.inject({
      method: 'PATCH',
      url: `/v1/jobs/${job.jobId}/progress`,
      headers: { 'x-execution-token': 'wrong' },
      payload: { status: 'CONNECTING' },
    });
    expect(wrongToken.statusCode).toBe(401);

    const invalidTransition = await app.inject({
      method: 'PATCH',
      url: `/v1/jobs/${job.jobId}/progress`,
      headers: { 'x-execution-token': job.executionToken },
      payload: { status: 'RUNNING' },
    });
    expect(invalidTransition.statusCode).toBe(409);
    expect(invalidTransition.json().code).toBe('INVALID_JOB_TRANSITION');

    for (const payload of [
      { status: 'CONNECTING' },
      { status: 'RUNNING' },
      { status: 'VERIFYING', outputHash: 'b'.repeat(64), inputTokens: 20, outputTokens: 12 },
      { status: 'VERIFIED' },
    ]) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/jobs/${job.jobId}/progress`,
        headers: { 'x-execution-token': job.executionToken },
        payload,
      });
      expect(response.statusCode).toBe(200);
    }

    expect(context.jobService.get(job.jobId)).toMatchObject({
      status: 'VERIFIED',
      verificationStatus: 'PASSED',
      outputHash: 'b'.repeat(64),
      inputTokens: 20,
      outputTokens: 12,
    });
  });

  it('prevents stale compare-and-set updates from overwriting a newer job state', async () => {
    const registration = await registerProvider();
    const job = await createJob(registration.provider.id);
    const repository = new JobRepository(database);

    const winner = repository.updateIfStatus(
      job.jobId,
      'ASSIGNED',
      { status: 'CONNECTING' },
      clock.toISOString(),
    );
    const stale = repository.updateIfStatus(
      job.jobId,
      'ASSIGNED',
      { status: 'CANCELLED' },
      clock.toISOString(),
    );

    expect(winner?.status).toBe('CONNECTING');
    expect(stale).toBeUndefined();
    expect(context.jobService.get(job.jobId).status).toBe('CONNECTING');
  });

  it('rejects metadata updates after a job reaches a terminal state', async () => {
    const registration = await registerProvider();
    const job = await createJob(registration.provider.id);
    for (const payload of [
      { status: 'CONNECTING' },
      { status: 'RUNNING' },
      { status: 'FAILED' },
    ]) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/jobs/${job.jobId}/progress`,
        headers: { 'x-execution-token': job.executionToken },
        payload,
      });
      expect(response.statusCode).toBe(200);
    }

    const afterTerminal = await app.inject({
      method: 'PATCH',
      url: `/v1/jobs/${job.jobId}/progress`,
      headers: { 'x-execution-token': job.executionToken },
      payload: { durationMs: 999 },
    });
    expect(afterTerminal.statusCode).toBe(409);
    expect(afterTerminal.json().code).toBe('INVALID_JOB_TRANSITION');
  });

  it('rejects malformed verifier output hashes', async () => {
    const registration = await registerProvider();
    const job = await createJob(registration.provider.id);
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/jobs/${job.jobId}/progress`,
      headers: { 'x-execution-token': job.executionToken },
      payload: { verifierOutputHash: 'not-a-sha256' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('requires an output hash before verification can pass', async () => {
    const registration = await registerProvider();
    const job = await createJob(registration.provider.id);
    for (const status of ['CONNECTING', 'RUNNING', 'VERIFYING']) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/jobs/${job.jobId}/progress`,
        headers: { 'x-execution-token': job.executionToken },
        payload: { status },
      });
      expect(response.statusCode).toBe(200);
    }
    const verified = await app.inject({
      method: 'PATCH',
      url: `/v1/jobs/${job.jobId}/progress`,
      headers: { 'x-execution-token': job.executionToken },
      payload: { status: 'VERIFIED' },
    });
    expect(verified.statusCode).toBe(400);
    expect(verified.json().code).toBe('OUTPUT_HASH_REQUIRED');
  });

  it('provides safe settlement operations without exposing direct job writes to 2B', async () => {
    const registration = await registerProvider();
    const job = await createJob(registration.provider.id);
    for (const payload of [
      { status: 'CONNECTING' },
      { status: 'RUNNING' },
      { status: 'VERIFYING', outputHash: 'c'.repeat(64) },
      { status: 'VERIFIED' },
    ]) {
      await app.inject({
        method: 'PATCH',
        url: `/v1/jobs/${job.jobId}/progress`,
        headers: { 'x-execution-token': job.executionToken },
        payload,
      });
    }

    expect(context.jobService.markPaymentPending(job.jobId).status).toBe('PAYMENT_PENDING');
    const paid = context.jobService.markPaid(job.jobId, 'simulated_tx_001', 'SIMULATED');
    expect(paid).toMatchObject({
      status: 'PAID',
      paymentStatus: 'PAID',
      paymentMode: 'SIMULATED',
      paymentTxHash: 'simulated_tx_001',
      settledAmountAtomic: '2000',
    });
  });

  it.each(['prompt', 'response', 'rawOutput', 'content']) (
    'strictly rejects private or unknown job field %s',
    async (field) => {
      const registration = await registerProvider();
      const response = await app.inject({
        method: 'POST',
        url: '/v1/jobs',
        payload: {
          providerId: registration.provider.id,
          modelKey: 'demo-llm',
          promptHash: 'a'.repeat(64),
          [field]: 'secret-content',
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('VALIDATION_ERROR');
      expect(response.body).not.toContain('secret-content');
    },
  );

  it('keeps forbidden content columns out of the core schema', () => {
    const rows = database.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string }>;
    const columns = rows.map((row) => row.name);
    expect(columns).not.toContain('prompt');
    expect(columns).not.toContain('response');
    expect(columns).not.toContain('raw_output');
    expect(columns).not.toContain('content');
  });

  it('discovers economy migrations without edits to the core migration runner', () => {
    const migrationRoot = mkdtempSync(join(tmpdir(), 'meshcompute-migrations-'));
    const core = join(migrationRoot, 'core');
    const economy = join(migrationRoot, 'economy');
    mkdirSync(core);
    mkdirSync(economy);
    writeFileSync(join(core, '001_probe.sql'), 'CREATE TABLE core_probe (id TEXT PRIMARY KEY);');
    writeFileSync(
      join(economy, '001_probe.sql'),
      'CREATE TABLE economy_probe (id TEXT PRIMARY KEY);',
    );
    const migrationDatabase = openDatabase(':memory:');

    try {
      runMigrations(migrationDatabase, migrationRoot);
      const applied = migrationDatabase
        .prepare('SELECT id FROM schema_migrations ORDER BY id')
        .all() as Array<{ id: string }>;
      expect(applied.map((row) => row.id)).toEqual([
        'core/001_probe.sql',
        'economy/001_probe.sql',
      ]);
      expect(
        migrationDatabase
          .prepare("SELECT name FROM sqlite_master WHERE name = 'economy_probe'")
          .get(),
      ).toBeTruthy();
    } finally {
      migrationDatabase.close();
      rmSync(migrationRoot, { recursive: true, force: true });
    }
  });

  it('preserves providers and jobs across an application restart', async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'meshcompute-restart-'));
    const restartConfig: MarketplaceConfig = {
      ...config,
      DATABASE_URL: join(dataDirectory, 'restart.db'),
    };
    let firstApp: FastifyInstance | undefined;
    let secondApp: FastifyInstance | undefined;

    try {
      const first = await buildMarketplaceApp({
        config: restartConfig,
        logger: false,
        startOfflineMonitor: false,
      });
      firstApp = first.app;
      const registration = await firstApp.inject({
        method: 'POST',
        url: '/v1/providers/register',
        payload: providerPayload,
      });
      const providerId = registration.json<ProviderRegistration>().provider.id;
      const creation = await firstApp.inject({
        method: 'POST',
        url: '/v1/jobs',
        payload: { providerId, modelKey: 'demo-llm', promptHash: 'd'.repeat(64) },
      });
      const jobId = creation.json<JobCreation>().jobId;
      await firstApp.close();
      firstApp = undefined;

      const second = await buildMarketplaceApp({
        config: restartConfig,
        logger: false,
        startOfflineMonitor: false,
      });
      secondApp = second.app;
      const restored = await secondApp.inject({ method: 'GET', url: `/v1/jobs/${jobId}` });
      expect(restored.statusCode).toBe(200);
      expect(restored.json().job).toMatchObject({ id: jobId, status: 'ASSIGNED' });
    } finally {
      if (firstApp) await firstApp.close();
      if (secondApp) await secondApp.close();
      rmSync(dataDirectory, { recursive: true, force: true });
    }
  });
});
