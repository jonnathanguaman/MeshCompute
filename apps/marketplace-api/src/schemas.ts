import {
  JOB_STATUSES,
  PROVIDER_STATUSES,
  USER_ROLES,
  VERIFICATION_STATUSES,
} from '@meshcompute/contracts';
import { z } from 'zod';

const atomicAmount = z.string().regex(/^\d+$/, 'Must be a non-negative atomic-unit integer.');
const sha256 = z.string().regex(/^[a-fA-F0-9]{64}$/, 'Must be a 64-character SHA-256 hex digest.');
const identifier = z.string().trim().min(1).max(200);
// Wallet EVM real: un pago WDK contra una direccion invalida falla o se pierde.
const evmAddress = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid EVM address (0x + 40 hex characters).');

export const ProviderRegisterSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    qvacPublicKey: z.string().trim().min(16).max(500),
    walletAddress: evmAddress,
    modelKey: identifier,
    modelLabel: z.string().trim().min(1).max(200),
    hardwareLabel: z.string().trim().min(1).max(200),
    pricePer1kTokensAtomic: atomicAmount,
    pricingMode: z.literal('PER_JOB').default('PER_JOB'),
  })
  .strict();

export const ProviderListQuerySchema = z
  .object({
    status: z.enum(PROVIDER_STATUSES).optional(),
  })
  .strict();

export const IdParamsSchema = z.object({ id: identifier }).strict();

export const JobCreateSchema = z
  .object({
    providerId: identifier,
    verifierProviderId: identifier.optional(),
    modelKey: identifier,
    promptHash: sha256,
    consumerWallet: evmAddress.optional(),
  })
  .strict();

export const JobListQuerySchema = z
  .object({
    status: z.enum(JOB_STATUSES).optional(),
    providerId: identifier.optional(),
  })
  .strict();

export const JobProgressSchema = z
  .object({
    status: z.enum(JOB_STATUSES).optional(),
    outputHash: sha256.optional(),
    verifierOutputHash: sha256.optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    verificationStatus: z.enum(VERIFICATION_STATUSES).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one progress field is required.');

export const AuthRegisterSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(200),
    password: z.string().min(8).max(200),
    role: z.enum(USER_ROLES),
    displayName: z.string().trim().min(1).max(120),
  })
  .strict();

export const AuthLoginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(200),
    password: z.string().min(1).max(200),
  })
  .strict();

export const ProviderListingUpsertSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    qvacPublicKey: z.string().trim().min(16).max(500),
    description: z.string().trim().max(1000).default(''),
    modelKey: identifier.default('demo-llm'),
    modelLabel: z.string().trim().min(1).max(200),
    hardwareLabel: z.string().trim().min(1).max(200).default('Portal listing'),
    pricePer1kTokensAtomic: atomicAmount,
    walletAddress: evmAddress,
  })
  .strict();

export const ContractCreateSchema = z
  .object({
    providerId: identifier,
    message: z.string().trim().max(500).optional(),
  })
  .strict();

export function zodDetails(error: z.ZodError): Record<string, unknown> {
  return {
    issues: error.issues.map((issue) => ({
      code: issue.code,
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
