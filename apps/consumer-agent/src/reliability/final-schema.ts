/**
 * Schema estricto de la respuesta final. Doc 00 §11A.
 *
 * Dos formas validas de terminar:
 *   1. una respuesta con los valores usados y su evidencia;
 *   2. una negativa explicita por falta de evidencia.
 *
 * Cualquier otra cosa es F7 FINAL_SCHEMA_INVALID.
 *
 * findings §2: el SDK no permite combinar `responseFormat` con `tools`, asi
 * que el turno final se emite SIN tools y CON el JSON Schema de aqui. llama.cpp
 * lo convierte a GBNF y restringe la generacion a nivel de sampler: el schema
 * deja de ser una validacion a posteriori y pasa a ser una garantia
 * estructural. Zod sigue validando despues (defensa en profundidad y para
 * poder contar F7).
 */

import { z } from 'zod';

export const FinalAnswerSchema = z
  .object({
    providerStatus: z.enum(['ONLINE', 'OFFLINE', 'BUSY']),
    expectedAmountAtomic: z.string().regex(/^\d+$/, 'must be an integer string'),
    quoteConsistent: z.boolean(),
    evidence: z.array(z.string()).min(1),
  })
  .strict();

export const RefusalSchema = z
  .object({
    status: z.literal('INSUFFICIENT_EVIDENCE'),
    reason: z.string().min(1),
  })
  .strict();

export type FinalAnswer = z.infer<typeof FinalAnswerSchema>;
export type Refusal = z.infer<typeof RefusalSchema>;

export type ParsedFinal =
  | { kind: 'ANSWER'; value: FinalAnswer }
  | { kind: 'REFUSAL'; value: Refusal }
  | { kind: 'INVALID'; error: string };

/**
 * JSON Schema equivalente para `responseFormat.json_schema`.
 *
 * Se escribe a mano y no se deriva de Zod: llama.cpp lo convierte a GBNF y
 * acepta un subconjunto de JSON Schema. `oneOf` cubre las dos formas validas.
 * `additionalProperties: false` es explicito porque el SDK documenta que
 * `strict` NO aplica las semanticas de auto-tightening de OpenAI.
 */
export const FINAL_JSON_SCHEMA: Record<string, unknown> = {
  oneOf: [
    {
      type: 'object',
      properties: {
        providerStatus: { type: 'string', enum: ['ONLINE', 'OFFLINE', 'BUSY'] },
        expectedAmountAtomic: { type: 'string' },
        quoteConsistent: { type: 'boolean' },
        evidence: { type: 'array', items: { type: 'string' } },
      },
      required: ['providerStatus', 'expectedAmountAtomic', 'quoteConsistent', 'evidence'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['INSUFFICIENT_EVIDENCE'] },
        reason: { type: 'string' },
      },
      required: ['status', 'reason'],
      additionalProperties: false,
    },
  ],
};

export const FINAL_SCHEMA_NAME = 'meshcompute_job_analysis';

/**
 * Parsea el texto final del modelo.
 * `extractJson` tolera fences y prosa alrededor; el GBNF deberia evitarlo,
 * pero el modo baseline del benchmark corre sin responseFormat.
 */
export function parseFinal(text: string, extractJson: (t: string) => string): ParsedFinal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch (error) {
    return {
      kind: 'INVALID',
      error: `not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const refusal = RefusalSchema.safeParse(parsed);
  if (refusal.success) return { kind: 'REFUSAL', value: refusal.data };

  const answer = FinalAnswerSchema.safeParse(parsed);
  if (answer.success) return { kind: 'ANSWER', value: answer.data };

  return {
    kind: 'INVALID',
    error: answer.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; '),
  };
}
