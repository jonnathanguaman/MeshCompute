/**
 * Schemas Zod estrictos.
 *
 * Doc 00 §9 / RNF-02: el schema central debe ser `.strict()`. Un payload que
 * traiga `prompt` (o cualquier otra clave no declarada) se rechaza. Esto
 * convierte la privacidad en una propiedad tecnica, no en una promesa.
 */

import { z } from 'zod';
import {
  JOB_STATUSES,
  PAYMENT_MODES,
  PAYMENT_STATUSES,
  PROVIDER_STATUSES,
  VERIFICATION_STATUSES,
} from './enums.js';
import { VERIFICATION_MODES } from './local-api.js';

/** SHA-256 en hexadecimal: exactamente 64 caracteres. Doc 01 §20. */
export const Sha256HexSchema = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]{64}$/, 'must be lowercase hex sha-256');

/** Cantidades atomicas: enteros como string, para no perder precision. */
export const AtomicAmountSchema = z
  .string()
  .regex(/^\d+$/, 'must be a non-negative integer string');

/**
 * Direccion EVM real: 0x + 40 hex. Evita registrar wallets de juguete que
 * harian fallar (o perder) un pago WDK real. No se exige checksum EIP-55:
 * las direcciones all-lowercase/all-uppercase son validas on-chain.
 */
export const EvmAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'must be a valid EVM address (0x + 40 hex chars)');

export const ProviderStatusSchema = z.enum(PROVIDER_STATUSES);
export const JobStatusSchema = z.enum(JOB_STATUSES);
export const VerificationStatusSchema = z.enum(VERIFICATION_STATUSES);
export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES);

export const ProviderRegisterRequestSchema = z
  .object({
    name: z.string().min(1),
    qvacPublicKey: z.string().min(1),
    walletAddress: EvmAddressSchema,
    modelKey: z.string().min(1),
    modelLabel: z.string().min(1),
    hardwareLabel: z.string().min(1),
    pricePer1kTokensAtomic: AtomicAmountSchema,
    pricingMode: z.literal('PER_JOB').optional(),
  })
  .strict();

export const ProviderPublicDTOSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    qvacPublicKey: z.string(),
    walletAddress: z.string(),
    modelKey: z.string(),
    modelLabel: z.string(),
    hardwareLabel: z.string(),
    pricePer1kTokensAtomic: AtomicAmountSchema,
    pricingMode: z.literal('PER_JOB'),
    tokenSymbol: z.literal('mUSDT'),
    status: ProviderStatusSchema,
    reputation: z.number(),
    jobsCompleted: z.number(),
    jobsFailed: z.number(),
    lastSeen: z.string(),
  })
  .strict();

/** Doc 00 §9, ejemplo canonico. Rechaza `prompt`. */
export const JobCreateRequestSchema = z
  .object({
    providerId: z.string(),
    verifierProviderId: z.string().optional(),
    modelKey: z.string(),
    promptHash: Sha256HexSchema,
    consumerWallet: EvmAddressSchema.optional(),
  })
  .strict();

export const JobMetadataDTOSchema = z
  .object({
    id: z.string(),
    providerId: z.string(),
    verifierProviderId: z.string().optional(),
    modelKey: z.string(),
    promptHash: z.string(),
    outputHash: z.string().optional(),
    verifierOutputHash: z.string().optional(),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    durationMs: z.number().optional(),
    quotedAmountAtomic: AtomicAmountSchema,
    settledAmountAtomic: AtomicAmountSchema.optional(),
    status: JobStatusSchema,
    verificationStatus: VerificationStatusSchema,
    paymentStatus: PaymentStatusSchema,
    paymentMode: z.enum(PAYMENT_MODES).optional(),
    paymentTxHash: z.string().optional(),
    paymentErrorCode: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
  })
  .strict();

/**
 * Lo unico que el Consumer Agent puede mandar al control plane.
 * `.strict()` garantiza que un `content`/`prompt` filtrado por accidente
 * falle en origen, antes de salir por la red.
 */
export const JobProgressPatchSchema = z
  .object({
    status: JobStatusSchema.optional(),
    outputHash: Sha256HexSchema.optional(),
    verifierOutputHash: Sha256HexSchema.optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    verificationStatus: VerificationStatusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'at least one progress field is required');

export const LocalInferenceRequestSchema = z
  .object({
    jobId: z.string().min(1),
    executionToken: z.string().min(1),
    provider: z
      .object({
        id: z.string().min(1),
        qvacPublicKey: z.string().min(1),
        modelKey: z.string().min(1),
      })
      .strict(),
    verifier: z
      .object({
        id: z.string().min(1),
        qvacPublicKey: z.string().min(1),
      })
      .strict()
      .optional(),
    prompt: z.string().min(1),
    verificationMode: z.enum(VERIFICATION_MODES),
  })
  .strict();

export const ApiErrorDTOSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  })
  .strict();
