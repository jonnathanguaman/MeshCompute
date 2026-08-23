import 'dotenv/config';
import { z } from 'zod';

const EvmAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const ConfigSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    HOST: z.string().min(1).default('0.0.0.0'),
    WEB_URL: z.string().url().default('http://localhost:3001'),
    DATABASE_URL: z.string().min(1).default('./meshcompute.db'),
    PROVIDER_OFFLINE_AFTER_MS: z.coerce.number().int().positive().default(30_000),
    PROVIDER_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
    PRICING_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),
    // Vigencia de un contrato de portal (REQUESTED/ACCEPTED) antes de EXPIRED.
    CONTRACT_TTL_MS: z.coerce.number().int().positive().default(3_600_000),
    PAYMENT_MODE: z.enum(['SIMULATED', 'WDK_TESTNET']).default('SIMULATED'),
    // Liquida automaticamente cada job VERIFIED; 'false' vuelve al settle manual.
    AUTO_SETTLE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    // Doc B §19 "mejor": liquidar ceil(tokens/1000)*tarifa en vez del precio fijo.
    SETTLE_BY_TOKENS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    EVM_RPC_URL: z.string().url().optional(),
    TESTNET_TOKEN_ADDRESS: EvmAddressSchema.optional(),
    TREASURY_SEED_PHRASE: z.string().min(1).optional(),
    TOKEN_DECIMALS: z.coerce.number().int().min(0).max(30).default(6),
    WDK_TESTNET_CHAIN_ID: z.coerce.number().int().positive().default(11_155_111),
    WDK_ACCOUNT_INDEX: z.coerce.number().int().min(0).default(0),
    WDK_MAX_TRANSFER_ATOMIC: z.string().regex(/^\d+$/).default('1000000'),
    WDK_MAX_FEE_WEI: z.string().regex(/^\d+$/).default('10000000000000000'),
    WDK_RPC_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(10_000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .strict();

export type MarketplaceConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): MarketplaceConfig {
  const paymentMode = environment.PAYMENT_MODE === 'TESTNET'
    ? 'WDK_TESTNET'
    : environment.PAYMENT_MODE;
  const parsed = ConfigSchema.safeParse({
    PORT: environment.PORT,
    HOST: environment.HOST,
    WEB_URL: environment.WEB_URL,
    DATABASE_URL: environment.DATABASE_URL,
    PROVIDER_OFFLINE_AFTER_MS: environment.PROVIDER_OFFLINE_AFTER_MS,
    PROVIDER_SWEEP_INTERVAL_MS: environment.PROVIDER_SWEEP_INTERVAL_MS,
    PRICING_TIMEOUT_MS: environment.PRICING_TIMEOUT_MS,
    CONTRACT_TTL_MS: environment.CONTRACT_TTL_MS,
    PAYMENT_MODE: paymentMode,
    AUTO_SETTLE: environment.AUTO_SETTLE,
    SETTLE_BY_TOKENS: environment.SETTLE_BY_TOKENS,
    EVM_RPC_URL: environment.EVM_RPC_URL,
    TESTNET_TOKEN_ADDRESS:
      environment.TESTNET_TOKEN_ADDRESS ?? environment.MOCK_TOKEN_ADDRESS,
    TREASURY_SEED_PHRASE: environment.TREASURY_SEED_PHRASE,
    TOKEN_DECIMALS: environment.TOKEN_DECIMALS,
    WDK_TESTNET_CHAIN_ID: environment.WDK_TESTNET_CHAIN_ID,
    WDK_ACCOUNT_INDEX: environment.WDK_ACCOUNT_INDEX,
    WDK_MAX_TRANSFER_ATOMIC: environment.WDK_MAX_TRANSFER_ATOMIC,
    WDK_MAX_FEE_WEI: environment.WDK_MAX_FEE_WEI,
    WDK_RPC_TIMEOUT_MS: environment.WDK_RPC_TIMEOUT_MS,
    LOG_LEVEL: environment.LOG_LEVEL,
  });

  if (!parsed.success) {
    throw new Error(`Invalid marketplace configuration: ${z.prettifyError(parsed.error)}`);
  }

  if (parsed.data.PAYMENT_MODE === 'WDK_TESTNET') {
    const missing = [
      !parsed.data.EVM_RPC_URL ? 'EVM_RPC_URL' : undefined,
      !parsed.data.TESTNET_TOKEN_ADDRESS ? 'TESTNET_TOKEN_ADDRESS' : undefined,
      !parsed.data.TREASURY_SEED_PHRASE ? 'TREASURY_SEED_PHRASE' : undefined,
    ].filter((name): name is string => name !== undefined);
    if (missing.length > 0) {
      throw new Error(
        `Invalid marketplace configuration: WDK_TESTNET requires ${missing.join(', ')}.`,
      );
    }
    if (parsed.data.TOKEN_DECIMALS !== 6) {
      throw new Error(
        'Invalid marketplace configuration: MeshCompute mUSDT settlement requires TOKEN_DECIMALS=6.',
      );
    }
  }

  return parsed.data;
}
