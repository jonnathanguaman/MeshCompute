/**
 * Tool registry: whitelist, scope y ejecucion.
 *
 * Doc 00 §11A / doc 01 §18A.
 *
 * Las tres tools minimas. Las dos primeras leen del Marketplace API; la
 * tercera es determinista local, sin LLM. No anadir una cuarta hasta que
 * estas funcionen (doc 00 §11A).
 */

import type { ToolDefinition } from '@meshcompute/qvac-adapter';
import type { z } from 'zod';
import type { ConsumerMarketplaceClient } from '../marketplace-client.js';
import { computeExpectedCostAtomic } from './cost.js';
import {
  CalculateExpectedCostArgsSchema,
  GetJobMetadataArgsSchema,
  GetProviderStatusArgsSchema,
  TOOL_JSON_SCHEMAS,
} from './tool-schemas.js';

/**
 * Contexto del job en curso.
 *
 * El orchestrator lo conoce; el modelo NO puede alterarlo. Es lo que hace
 * posible el check de scope: el modelo no elige que job o provider consultar.
 */
export interface ToolContext {
  jobId: string;
  providerId: string;
  marketplace: ConsumerMarketplaceClient;
  timeoutMs: number;
  /**
   * Inyeccion de fallos del benchmark (doc 01 §18B). Vive en el contexto y no
   * dentro del orchestrator a proposito: el sistema bajo prueba no debe saber
   * que esta siendo probado.
   */
  injection?: FailureInjection;
}

export interface FailureInjection {
  /** La tool nombrada devuelve 'not found'. */
  notFound?: string;
  /** La tool nombrada devuelve un payload vacio/invalido. */
  emptyResult?: string;
  /** La tool nombrada nunca responde (fuerza timeout). */
  timeout?: string;
  /** Sobrescribe el resultado de una tool con valores concretos. */
  override?: Record<string, unknown>;
}

export class ToolExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}

export interface RegisteredTool<TArgs = unknown, TResult = unknown> {
  name: string;
  description: string;
  schema: z.ZodType<TArgs>;
  /** JSON Schema declarado al modelo. */
  jsonSchema: ToolDefinition['parameters'];
  execute(args: TArgs, ctx: ToolContext): Promise<TResult>;
}

/** Aplica la inyeccion de fallos antes de la logica real de la tool. */
async function applyInjection(name: string, ctx: ToolContext): Promise<void> {
  const injection = ctx.injection;
  if (!injection) return;

  if (injection.timeout === name) {
    // Nunca resuelve por si solo: el runner de la tool aplica el timeout.
    await new Promise((resolve) => setTimeout(resolve, ctx.timeoutMs * 3));
  }
  if (injection.notFound === name) {
    throw new ToolExecutionError('NOT_FOUND', `${name}: resource not found`);
  }
}

const getProviderStatus: RegisteredTool = {
  name: 'get_provider_status',
  description:
    'Returns the current marketplace status of the compute provider assigned to this job, ' +
    'including its reputation and price per 1000 tokens.',
  schema: GetProviderStatusArgsSchema,
  jsonSchema: TOOL_JSON_SCHEMAS.get_provider_status,
  async execute(args, ctx) {
    const { providerId } = args as z.infer<typeof GetProviderStatusArgsSchema>;
    await applyInjection('get_provider_status', ctx);

    if (ctx.injection?.emptyResult === 'get_provider_status') {
      return {};
    }

    const provider = await ctx.marketplace.getProvider(providerId);
    if (!provider) {
      throw new ToolExecutionError('NOT_FOUND', `provider ${providerId} not found`);
    }

    // Se devuelve un subconjunto: el modelo no necesita la wallet ni los
    // contadores internos, y cuanto menor el payload menos margen de confusion.
    const result = {
      id: provider.id,
      name: provider.name,
      status: provider.status,
      reputation: provider.reputation,
      modelKey: provider.modelKey,
      pricePer1kTokensAtomic: provider.pricePer1kTokensAtomic,
    };
    return { ...result, ...(ctx.injection?.override ?? {}) };
  },
};

const getJobMetadata: RegisteredTool = {
  name: 'get_job_metadata',
  description:
    'Returns the recorded metadata of this job: token counts, duration, the quoted amount ' +
    'and its current status. Contains no prompt or model output.',
  schema: GetJobMetadataArgsSchema,
  jsonSchema: TOOL_JSON_SCHEMAS.get_job_metadata,
  async execute(args, ctx) {
    const { jobId } = args as z.infer<typeof GetJobMetadataArgsSchema>;
    await applyInjection('get_job_metadata', ctx);

    if (ctx.injection?.emptyResult === 'get_job_metadata') {
      return {};
    }

    const job = await ctx.marketplace.getJob(jobId);
    if (!job) {
      throw new ToolExecutionError('NOT_FOUND', `job ${jobId} not found`);
    }

    const result = {
      id: job.id,
      providerId: job.providerId,
      modelKey: job.modelKey,
      inputTokens: job.inputTokens,
      outputTokens: job.outputTokens,
      durationMs: job.durationMs,
      quotedAmountAtomic: job.quotedAmountAtomic,
      status: job.status,
    };
    return { ...result, ...(ctx.injection?.override ?? {}) };
  },
};

const calculateExpectedCost: RegisteredTool = {
  name: 'calculate_expected_cost',
  description:
    'Deterministically computes the expected cost in atomic units for a number of input and ' +
    'output tokens at a given price per 1000 tokens. Always use this instead of doing the ' +
    'arithmetic yourself.',
  schema: CalculateExpectedCostArgsSchema,
  jsonSchema: TOOL_JSON_SCHEMAS.calculate_expected_cost,
  async execute(args, ctx) {
    const typed = args as z.infer<typeof CalculateExpectedCostArgsSchema>;
    await applyInjection('calculate_expected_cost', ctx);

    if (ctx.injection?.emptyResult === 'calculate_expected_cost') {
      return {};
    }

    const expectedAmountAtomic = computeExpectedCostAtomic({
      inputTokens: typed.inputTokens,
      outputTokens: typed.outputTokens,
      pricePer1kTokensAtomic: typed.pricePer1kTokensAtomic,
    });

    const result = {
      expectedAmountAtomic,
      totalTokens: typed.inputTokens + typed.outputTokens,
      pricePer1kTokensAtomic: typed.pricePer1kTokensAtomic,
    };
    return { ...result, ...(ctx.injection?.override ?? {}) };
  },
};

export const TOOL_REGISTRY: readonly RegisteredTool[] = [
  getProviderStatus,
  getJobMetadata,
  calculateExpectedCost,
];

const BY_NAME = new Map(TOOL_REGISTRY.map((tool) => [tool.name, tool]));

/** RF-V07: nombre fuera de la whitelist -> F1 WRONG_TOOL. */
export function findTool(name: string): RegisteredTool | undefined {
  return BY_NAME.get(name);
}

export function toolNames(): string[] {
  return [...BY_NAME.keys()];
}

/** Definiciones que se declaran al modelo. Sin `handler`: ver findings §1. */
export function toolDefinitions(): ToolDefinition[] {
  return TOOL_REGISTRY.map((tool) => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.jsonSchema,
  }));
}

export interface ScopeViolation {
  field: string;
  expected: string;
  received: string;
}

/**
 * RF-V07 / doc 01 §18A: el modelo no elige `jobId` ni `providerId` arbitrarios.
 *
 * Se comprueba ANTES de ejecutar. Un modelo que pide otro job no es un error
 * de formato: es un intento de leer datos fuera de su alcance, y se cuenta
 * como F9 TOOL_SCOPE_VIOLATION.
 */
export function checkScope(
  args: Record<string, unknown>,
  ctx: ToolContext,
): ScopeViolation | undefined {
  const jobId = args['jobId'];
  if (typeof jobId === 'string' && jobId !== ctx.jobId) {
    return { field: 'jobId', expected: ctx.jobId, received: jobId };
  }

  const providerId = args['providerId'];
  if (typeof providerId === 'string' && providerId !== ctx.providerId) {
    return { field: 'providerId', expected: ctx.providerId, received: providerId };
  }

  return undefined;
}

/** Ejecuta una tool con timeout duro. RNF-13: todo loop tiene limites. */
export async function executeWithTimeout<TArgs>(
  tool: RegisteredTool<TArgs>,
  args: TArgs,
  ctx: ToolContext,
): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      tool.execute(args, ctx),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ToolExecutionError('TOOL_TIMEOUT', `${tool.name}: timed out`)),
          ctx.timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
