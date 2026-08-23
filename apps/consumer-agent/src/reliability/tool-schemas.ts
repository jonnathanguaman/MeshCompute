/**
 * Schemas Zod de los argumentos de cada tool.
 *
 * RF-V06 (doc 00 §26): validar argumentos de tools con Zod.
 *
 * Todos son `.strict()`: si el modelo inventa un campo extra, es una senal de
 * que no entendio la tool y se cuenta como F2 INVALID_ARGS en vez de
 * ejecutarse con basura silenciosamente.
 */

import { z } from 'zod';

export const GetProviderStatusArgsSchema = z
  .object({
    providerId: z.string().min(1),
  })
  .strict();

export const GetJobMetadataArgsSchema = z
  .object({
    jobId: z.string().min(1),
  })
  .strict();

export const CalculateExpectedCostArgsSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    pricePer1kTokensAtomic: z
      .string()
      .regex(/^\d+$/, 'must be a non-negative integer string'),
  })
  .strict();

export type GetProviderStatusArgs = z.infer<typeof GetProviderStatusArgsSchema>;
export type GetJobMetadataArgs = z.infer<typeof GetJobMetadataArgsSchema>;
export type CalculateExpectedCostArgs = z.infer<typeof CalculateExpectedCostArgsSchema>;

/**
 * JSON Schema que se le declara al modelo.
 *
 * Se escribe a mano en vez de derivarlo de Zod porque el SDK acepta un
 * subconjunto muy concreto (`schemas/tools.js`: solo type/description/enum por
 * propiedad) y un conversor generico produciria claves que el SDK rechaza.
 */
export const TOOL_JSON_SCHEMAS = {
  get_provider_status: {
    type: 'object' as const,
    properties: {
      providerId: {
        type: 'string' as const,
        description: 'Id of the provider assigned to the current job.',
      },
    },
    required: ['providerId'],
  },
  get_job_metadata: {
    type: 'object' as const,
    properties: {
      jobId: {
        type: 'string' as const,
        description: 'Id of the current job.',
      },
    },
    required: ['jobId'],
  },
  calculate_expected_cost: {
    type: 'object' as const,
    properties: {
      inputTokens: {
        type: 'integer' as const,
        description: 'Number of input tokens reported by the job metadata.',
      },
      outputTokens: {
        type: 'integer' as const,
        description: 'Number of output tokens reported by the job metadata.',
      },
      pricePer1kTokensAtomic: {
        type: 'string' as const,
        description: 'Provider price per 1000 tokens, as an atomic integer string.',
      },
    },
    required: ['inputTokens', 'outputTokens', 'pricePer1kTokensAtomic'],
  },
};
