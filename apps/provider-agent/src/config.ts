/**
 * Configuracion del Provider Agent. Doc 01 §9 / doc 00 §37.
 */

import {
  BooleanFromEnv,
  IntFromEnv,
  ListFromEnv,
  loadEnv,
  normalizeHyperswarmSeed,
} from '@meshcompute/config';
import { z } from 'zod';

const ProviderEnvSchema = z.object({
  MARKETPLACE_API_URL: z
    .string()
    .url()
    .default('http://localhost:4000')
    .refine((url) => !url.includes('100.x.x.x'), {
      message: 'replace http://100.x.x.x:4000 with the real Marketplace API URL',
    }),

  PROVIDER_NAME: z.string().min(1).default('Gaming-PC-01'),
  PROVIDER_WALLET: z
    .string()
    .regex(
      /^0x[0-9a-fA-F]{40}$/,
      'PROVIDER_WALLET must be a real EVM address (0x + 40 hex chars); payments go there',
    ),
  PROVIDER_HARDWARE: z.string().min(1).default('unknown-hardware'),

  PROVIDER_MODEL_KEY: z.string().min(1).default('local-tooluse-llm'),
  PROVIDER_MODEL_LABEL: z.string().min(1).default('Qwen3.5-4B-Q4_K_M'),

  PROVIDER_PRICE_ATOMIC: z
    .string()
    .regex(/^\d+$/, 'PROVIDER_PRICE_ATOMIC must be a non-negative integer string')
    .default('2000'),

  // PA-009: permite probar QVAC sin backend.
  MARKETPLACE_DISABLED: BooleanFromEnv(false),

  QVAC_FIREWALL_ALLOWED_KEYS: ListFromEnv(),
  PROVIDER_WARMUP_MODEL: BooleanFromEnv(true),

  HEARTBEAT_INTERVAL_MS: IntFromEnv(10_000, 1_000),
  REGISTER_RETRY_MS: IntFromEnv(3_000, 500),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type ProviderConfig = z.infer<typeof ProviderEnvSchema>;

export function loadProviderConfig(): ProviderConfig {
  const config = loadEnv(ProviderEnvSchema);
  normalizeHyperswarmSeed();
  return config;
}
