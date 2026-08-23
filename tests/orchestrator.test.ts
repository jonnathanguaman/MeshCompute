/**
 * Pruebas del Reliability Orchestrator. Doc 00 §35.
 *
 *   T-11 multi-step tool chain
 *   T-12 invalid tool args
 *   T-13 tool failure sin alucinacion
 *   T-15 scope violation
 *   T-16 max turns
 *   F5   tool loop
 *
 * Todo corre contra el adapter mock: deterministas, sin red ni GPU.
 */

import { createLogger } from '@meshcompute/config';
import {
  MockQvacConsumer,
  MOCK_PROVIDER_PUBLIC_KEY,
  defaultChainBehavior,
  mockOutcome,
  mockToolCall,
  type MockModelBehavior,
} from '@meshcompute/qvac-adapter';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DisabledConsumerMarketplaceClient,
  type ConsumerMarketplaceClient,
} from '../apps/consumer-agent/src/marketplace-client.js';
import {
  FIXTURE_JOB_ID,
  FIXTURE_PROVIDER_ID,
  fixtureJobs,
  fixtureProviders,
} from '../apps/consumer-agent/src/fixtures/demo-fixtures.js';
import { ReliabilityOrchestrator } from '../apps/consumer-agent/src/reliability/orchestrator.js';
import type { RetryPolicy } from '../apps/consumer-agent/src/reliability/retry-policy.js';
import type { ToolContext } from '../apps/consumer-agent/src/reliability/tool-registry.js';

// Logger silencioso: los tests comprueban comportamiento, no salida.
const logger = createLogger('test', 'error');

const POLICY: RetryPolicy = {
  maxToolTurns: 4,
  maxToolRetries: 1,
  maxFinalSchemaRetries: 1,
  toolTimeoutMs: 1_000,
};

let marketplace: ConsumerMarketplaceClient;

beforeEach(() => {
  marketplace = new DisabledConsumerMarketplaceClient(logger, {
    providers: fixtureProviders(),
    jobs: fixtureJobs(),
  });
});

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    jobId: FIXTURE_JOB_ID,
    providerId: FIXTURE_PROVIDER_ID,
    marketplace,
    timeoutMs: 1_000,
    ...overrides,
  };
}

async function runWith(
  behavior: MockModelBehavior,
  ctx: ToolContext = makeCtx(),
  policy: RetryPolicy = POLICY,
) {
  const consumer = new MockQvacConsumer({ behavior });
  const session = await consumer.openSession({
    providerPublicKey: MOCK_PROVIDER_PUBLIC_KEY,
    modelKey: 'tooluse-llm',
    timeoutMs: 5_000,
    fallbackToLocal: false,
  });

  return new ReliabilityOrchestrator().run({
    session,
    ctx,
    policy,
    prompt: 'Analyze this job.',
    logger,
    hardened: true,
  });
}

describe('T-11 multi-step tool chain', () => {
  it('encadena las tres tools y valida el final', async () => {
    const result = await runWith(
      defaultChainBehavior({ jobId: FIXTURE_JOB_ID, providerId: FIXTURE_PROVIDER_ID }),
    );

    expect(result.summary.status).toBe('PASSED');
    expect(result.summary.successfulTools).toBe(3);
    expect(result.summary.schemaPassed).toBe(true);
    expect(result.summary.groundingPassed).toBe(true);

    const names = result.summary.trace.map((t) => t.toolName);
    expect(names).toEqual([
      'get_provider_status',
      'get_job_metadata',
      'calculate_expected_cost',
    ]);
    expect(result.failures).toHaveLength(0);
  });

  it('el resultado usa el coste real de la tool, no uno inventado', async () => {
    const result = await runWith(
      defaultChainBehavior({ jobId: FIXTURE_JOB_ID, providerId: FIXTURE_PROVIDER_ID }),
    );
    expect(result.content).toContain('2310');
    expect(result.actualToolResults.get('calculate_expected_cost')).toMatchObject({
      expectedAmountAtomic: '2310',
    });
  });
});

describe('T-15 scope violation', () => {
  it('rechaza la tool cuando el modelo pide otro jobId y no la ejecuta', async () => {
    const behavior: MockModelBehavior = ({ turn }) => {
      if (turn === 1) {
        return mockOutcome({
          toolCalls: [mockToolCall('get_job_metadata', { jobId: 'job_OTHER' })],
        });
      }
      return mockOutcome({
        content: JSON.stringify({ status: 'INSUFFICIENT_EVIDENCE', reason: 'blocked' }),
      });
    };

    const result = await runWith(behavior);

    expect(result.failures).toContain('F9');
    const entry = result.summary.trace.find((t) => t.toolName === 'get_job_metadata');
    expect(entry?.executionStatus).toBe('REJECTED');
    expect(entry?.errorCode).toBe('TOOL_SCOPE_VIOLATION');
    // La tool NO se ejecuto: no hay resultado real registrado.
    expect(result.actualToolResults.has('get_job_metadata')).toBe(false);
  });

  it('tambien bloquea un providerId ajeno', async () => {
    const behavior: MockModelBehavior = ({ turn }) => {
      if (turn === 1) {
        return mockOutcome({
          toolCalls: [mockToolCall('get_provider_status', { providerId: 'p_999' })],
        });
      }
      return mockOutcome({
        content: JSON.stringify({ status: 'INSUFFICIENT_EVIDENCE', reason: 'blocked' }),
      });
    };

    const result = await runWith(behavior);
    expect(result.failures).toContain('F9');
    expect(result.actualToolResults.has('get_provider_status')).toBe(false);
  });
});

describe('T-12 invalid tool args', () => {
  it('no ejecuta la tool con argumentos que no cumplen Zod', async () => {
    const behavior: MockModelBehavior = ({ turn }) => {
      if (turn === 1) {
        // inputTokens deberia ser number, no string.
        return mockOutcome({
          toolCalls: [
            mockToolCall('calculate_expected_cost', {
              inputTokens: 'a lot',
              outputTokens: 340,
              pricePer1kTokensAtomic: '1500',
            }),
          ],
        });
      }
      return mockOutcome({
        content: JSON.stringify({ status: 'INSUFFICIENT_EVIDENCE', reason: 'bad args' }),
      });
    };

    const result = await runWith(behavior);

    expect(result.failures).toContain('F2');
    const entry = result.summary.trace.find((t) => t.toolName === 'calculate_expected_cost');
    expect(entry?.argsValid).toBe(false);
    expect(entry?.executionStatus).toBe('REJECTED');
    expect(result.actualToolResults.has('calculate_expected_cost')).toBe(false);
  });

  it('rechaza campos extra (schema estricto)', async () => {
    const behavior: MockModelBehavior = ({ turn }) => {
      if (turn === 1) {
        return mockOutcome({
          toolCalls: [
            mockToolCall('get_provider_status', {
              providerId: FIXTURE_PROVIDER_ID,
              extraField: 'unexpected',
            }),
          ],
        });
      }
      return mockOutcome({
        content: JSON.stringify({ status: 'INSUFFICIENT_EVIDENCE', reason: 'bad args' }),
      });
    };

    const result = await runWith(behavior);
    expect(result.failures).toContain('F2');
  });
});

describe('F1 wrong tool', () => {
  it('rechaza una tool fuera de la whitelist', async () => {
    const behavior: MockModelBehavior = ({ turn }) => {
      if (turn === 1) {
        return mockOutcome({
          toolCalls: [mockToolCall('read_user_files', { path: '/etc/passwd' })],
        });
      }
      return mockOutcome({
        content: JSON.stringify({ status: 'INSUFFICIENT_EVIDENCE', reason: 'no such tool' }),
      });
    };

    const result = await runWith(behavior);
    expect(result.failures).toContain('F1');
    const entry = result.summary.trace.find((t) => t.toolName === 'read_user_files');
    expect(entry?.executionStatus).toBe('REJECTED');
    expect(entry?.errorCode).toBe('WRONG_TOOL');
  });
});

describe('T-13 tool failure sin alucinacion', () => {
  it('rehusa cuando la tool falla tras el retry', async () => {
    const behavior: MockModelBehavior = ({ turn }) => {
      if (turn === 1) {
        return mockOutcome({
          toolCalls: [mockToolCall('get_job_metadata', { jobId: FIXTURE_JOB_ID })],
        });
      }
      // El modelo intenta inventar un resultado igualmente.
      return mockOutcome({
        content: JSON.stringify({
          providerStatus: 'ONLINE',
          expectedAmountAtomic: '2310',
          quoteConsistent: true,
          evidence: ['get_job_metadata'],
        }),
      });
    };

    // La tool nunca encuentra el job: NOT_FOUND en cada intento.
    const ctx = makeCtx({ injection: { notFound: 'get_job_metadata' } });
    const result = await runWith(behavior, ctx);

    // No se marca PASSED: el dato no existia.
    expect(result.summary.status).not.toBe('PASSED');
    expect(result.summary.refusalReason).toBeDefined();
    expect(result.actualToolResults.has('get_job_metadata')).toBe(false);

    const entry = result.summary.trace.find((t) => t.toolName === 'get_job_metadata');
    expect(entry?.executionStatus).toBe('ERROR');
    expect(entry?.retryCount).toBe(1); // exactamente un retry (MAX_TOOL_RETRIES=1)
  });

  it('F8: un timeout de tool queda registrado', async () => {
    const behavior: MockModelBehavior = ({ turn }) => {
      if (turn === 1) {
        return mockOutcome({
          toolCalls: [mockToolCall('get_provider_status', { providerId: FIXTURE_PROVIDER_ID })],
        });
      }
      return mockOutcome({
        content: JSON.stringify({ status: 'INSUFFICIENT_EVIDENCE', reason: 'timeout' }),
      });
    };

    const ctx = makeCtx({ injection: { timeout: 'get_provider_status' }, timeoutMs: 50 });
    const result = await runWith(behavior, ctx, { ...POLICY, toolTimeoutMs: 50 });

    expect(result.failures).toContain('F8');
    expect(result.summary.status).not.toBe('PASSED');
  });
});

describe('T-16 max turns', () => {
  it('termina al alcanzar MAX_TOOL_TURNS', async () => {
    // Un modelo atascado: siempre pide la misma tool con argumentos distintos.
    let counter = 0;
    const behavior: MockModelBehavior = () => {
      counter += 1;
      return mockOutcome({
        toolCalls: [
          mockToolCall('get_provider_status', { providerId: FIXTURE_PROVIDER_ID }),
        ],
        stopReason: `loop-${counter}`,
      });
    };

    const policy: RetryPolicy = { ...POLICY, maxToolTurns: 3 };
    const result = await runWith(behavior, makeCtx(), policy);

    expect(result.failures).toContain('F6');
    expect(result.summary.status).not.toBe('PASSED');
    // Nunca supera el presupuesto de turnos.
    const turns = new Set(result.summary.trace.map((t) => t.turn));
    expect(Math.max(...turns)).toBeLessThanOrEqual(3);
  });

  it('F5: detecta la misma llamada repetida', async () => {
    const behavior: MockModelBehavior = () =>
      mockOutcome({
        toolCalls: [
          mockToolCall('get_provider_status', { providerId: FIXTURE_PROVIDER_ID }),
        ],
      });

    const result = await runWith(behavior, makeCtx(), { ...POLICY, maxToolTurns: 3 });
    expect(result.failures).toContain('F5');
  });
});

describe('F7 final schema invalid', () => {
  it('marca F7 cuando el final no es JSON valido tras la reparacion', async () => {
    const behavior: MockModelBehavior = () =>
      mockOutcome({ content: 'I think the provider is probably online, roughly 2300 or so.' });

    const result = await runWith(behavior);

    expect(result.failures).toContain('F7');
    expect(result.summary.schemaPassed).toBe(false);
    expect(result.summary.status).toBe('FAILED');
  });
});

describe('refusal', () => {
  it('acepta una negativa explicita como final valido', async () => {
    const behavior: MockModelBehavior = () =>
      mockOutcome({
        content: JSON.stringify({
          status: 'INSUFFICIENT_EVIDENCE',
          reason: 'Required job metadata could not be retrieved.',
        }),
      });

    const result = await runWith(behavior);

    expect(result.summary.schemaPassed).toBe(true);
    expect(result.summary.status).toBe('REFUSED');
    expect(result.summary.refusalReason).toContain('job metadata');
  });
});

describe('trace sanitizado (RNF-14)', () => {
  it('el trace no contiene prompt ni resultados crudos', async () => {
    const result = await runWith(
      defaultChainBehavior({ jobId: FIXTURE_JOB_ID, providerId: FIXTURE_PROVIDER_ID }),
    );

    const allowed = new Set([
      'turn',
      'toolName',
      'argsValid',
      'executionStatus',
      'durationMs',
      'retryCount',
      'errorCode',
    ]);
    for (const item of result.summary.trace) {
      for (const key of Object.keys(item)) {
        expect(allowed.has(key)).toBe(true);
      }
    }

    const serialized = JSON.stringify(result.summary.trace);
    expect(serialized).not.toContain('Analyze this job');
    expect(serialized).not.toContain('2310');
  });
});

describe('varias tool calls en un mismo turno', () => {
  it('las procesa todas y aplica las guardas a cada una', async () => {
    // Un modelo puede emitir varias llamadas en un solo turno. Cada una debe
    // pasar la cadena de guardas por separado: una buena y una fuera de scope
    // no pueden compartir destino.
    const behavior: MockModelBehavior = ({ turn }) => {
      if (turn === 1) {
        return mockOutcome({
          toolCalls: [
            mockToolCall('get_provider_status', { providerId: FIXTURE_PROVIDER_ID }),
            mockToolCall('get_job_metadata', { jobId: 'job_OTHER' }),
          ],
        });
      }
      return mockOutcome({
        content: JSON.stringify({ status: 'INSUFFICIENT_EVIDENCE', reason: 'partial' }),
      });
    };

    const result = await runWith(behavior);

    // La legítima se ejecutó...
    expect(result.actualToolResults.has('get_provider_status')).toBe(true);
    // ...y la fuera de scope no.
    expect(result.actualToolResults.has('get_job_metadata')).toBe(false);
    expect(result.failures).toContain('F9');
    expect(result.summary.trace).toHaveLength(2);
  });
});
