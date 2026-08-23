/**
 * Configuracion del Consumer Agent. Doc 00 §37 / doc 01 §14.
 *
 * Nota sobre `PORT`: el doc 00 §37 lista `PORT=5050` bajo Consumer Agent y
 * `PORT=4000` bajo Marketplace API. Como el `.env.example` es unico y
 * compartido, colisionarian. Se usa `CONSUMER_PORT` con fallback a `PORT`,
 * de modo que un `.env` por app siguiendo el doc al pie de la letra tambien
 * funciona.
 */

import {
  BooleanFromEnv,
  IntFromEnv,
  loadEnv,
  normalizeHyperswarmSeed,
} from '@meshcompute/config';
import { z } from 'zod';

const ConsumerEnvSchema = z.object({
  CONSUMER_PORT: IntFromEnv(0, 0),
  PORT: IntFromEnv(0, 0),

  MARKETPLACE_API_URL: z.string().url().default('http://localhost:4000'),
  MARKETPLACE_DISABLED: BooleanFromEnv(false),

  // CA-002 / doc 01 §28: origen exacto, nunca '*'.
  WEB_ORIGIN: z.string().url().default('http://localhost:3001'),

  QVAC_FIRST_CONNECT_TIMEOUT_MS: IntFromEnv(60_000, 1_000),
  // CA-005 / DoD A: false en demo, para probar que la ejecucion fue remota.
  QVAC_FALLBACK_TO_LOCAL: BooleanFromEnv(false),

  CONSUMER_MODEL_KEY: z.string().min(1).default('local-tooluse-llm'),

  RELIABILITY_ENABLED: BooleanFromEnv(true),
  MAX_TOOL_TURNS: IntFromEnv(4, 1),
  MAX_TOOL_RETRIES: IntFromEnv(1, 0),
  MAX_FINAL_SCHEMA_RETRIES: IntFromEnv(1, 0),
  TOOL_TIMEOUT_MS: IntFromEnv(10_000, 100),

  // 'real' usa @qvac/sdk; 'mock' usa el adapter determinista (RNF-03).
  QVAC_ADAPTER: z.enum(['real', 'mock']).default('real'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type ConsumerConfig = z.infer<typeof ConsumerEnvSchema> & { port: number };

export function loadConsumerConfig(): ConsumerConfig {
  const env = loadEnv(ConsumerEnvSchema);
  normalizeHyperswarmSeed();
  // CONSUMER_PORT gana; PORT es el fallback del doc; 5050 el default.
  const port = env.CONSUMER_PORT || env.PORT || 5050;
  return { ...env, port };
}

/** CA-001: solo loopback. Nunca 0.0.0.0. */
export const BIND_HOST = '127.0.0.1';
