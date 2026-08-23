import type { PricingService } from '@meshcompute/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { buildMarketplaceApp } from '../src/app.js';
import { loadConfig, type MarketplaceConfig } from '../src/config.js';
import { openDatabase, type SqliteDatabase } from '../src/db/connection.js';

const config: MarketplaceConfig = {
  ...loadConfig({}),
  PORT: 4000,
  HOST: '127.0.0.1',
  WEB_URL: 'http://localhost:3000',
  DATABASE_URL: ':memory:',
  PROVIDER_OFFLINE_AFTER_MS: 30_000,
  PROVIDER_SWEEP_INTERVAL_MS: 5_000,
  PRICING_TIMEOUT_MS: 15,
  LOG_LEVEL: 'silent',
};

const providerPayload = {
  name: 'Pricing-Provider',
  qvacPublicKey: 'qvac-pricing-provider-key-0001',
  walletAddress: '0x00000000000000000000000000000000000000d1',
  modelKey: 'demo-llm',
  modelLabel: 'Pricing Model',
  hardwareLabel: 'Pricing Hardware',
  pricePer1kTokensAtomic: '2000',
};

describe('PricingService boundary', () => {
  const databases: SqliteDatabase[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  async function createJobWith(pricingService: PricingService) {
    const database = openDatabase(':memory:');
    databases.push(database);
    const { app } = await buildMarketplaceApp({
      config,
      database,
      pricingService,
      logger: false,
      startOfflineMonitor: false,
    });
    const registration = await app.inject({
      method: 'POST',
      url: '/v1/providers/register',
      payload: providerPayload,
    });
    const providerId = registration.json().provider.id as string;
    const response = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      payload: { providerId, modelKey: 'demo-llm', promptHash: 'a'.repeat(64) },
    });
    await app.close();
    return response;
  }

  it('returns PRICING_TIMEOUT instead of hanging job creation', async () => {
    const response = await createJobWith({
      quote: () => new Promise(() => undefined),
    });
    expect(response.statusCode).toBe(504);
    expect(response.json().code).toBe('PRICING_TIMEOUT');
  });

  it('normalizes PricingService failures without leaking their message', async () => {
    const response = await createJobWith({
      quote: async () => {
        throw new Error('private upstream pricing detail');
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('PRICING_UNAVAILABLE');
    expect(response.body).not.toContain('private upstream pricing detail');
  });
});
