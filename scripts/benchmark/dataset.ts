/**
 * Dataset sintetico y reproducible del benchmark Track 2.
 *
 * Doc 01 §18B. "El benchmark guarda solo datasets sinteticos/controlados y
 * metricas; nunca contenido privado de usuarios."
 *
 * Escenarios y runs objetivo (doc 00 §11A):
 *   NORMAL_CHAIN       10
 *   NOT_FOUND           4
 *   EMPTY_RESULT        4
 *   INVALID_ARGS        4
 *   TOOL_TIMEOUT        4
 *   GROUNDING_CONFLICT  4
 *   -------------------- 30 (minimo aceptable: 20 runs reales)
 *
 * La inyeccion de fallos vive en el `ToolContext`, no dentro del orchestrator:
 * el sistema bajo prueba no sabe que esta siendo probado.
 */

import {
  mockOutcome,
  mockToolCall,
  defaultChainBehavior,
  type MockModelBehavior,
} from '@meshcompute/qvac-adapter';
import {
  FIXTURE_EXPECTED_COST_ATOMIC,
  FIXTURE_JOB_ID,
  FIXTURE_PROVIDER_ID,
} from '../../apps/consumer-agent/src/fixtures/demo-fixtures.js';
import type { FailureInjection } from '../../apps/consumer-agent/src/reliability/tool-registry.js';

export type ScenarioId =
  | 'NORMAL_CHAIN'
  | 'NOT_FOUND'
  | 'EMPTY_RESULT'
  | 'INVALID_ARGS'
  | 'TOOL_TIMEOUT'
  | 'GROUNDING_CONFLICT';

/** Que deberia hacer un sistema correcto ante esta tarea. */
export type ExpectedOutcome = 'ANSWER' | 'REFUSE';

export interface BenchmarkTask {
  id: string;
  scenario: ScenarioId;
  /** Prompt real enviado al modelo. Identico en baseline y hardened (T-18). */
  prompt: string;
  /** Inyeccion de fallo aplicada al ToolContext. */
  injection?: FailureInjection;
  /** Resultado correcto esperado. */
  expected: ExpectedOutcome;
  /** Tools que un sistema correcto deberia usar. */
  expectedTools: string[];
  /**
   * Comportamiento del modelo simulado, solo para `--adapter=mock`.
   * Con `--adapter=real` se usa el modelo de verdad y esto se ignora.
   */
  mockBehavior: () => MockModelBehavior;
}

const BASE_PROMPT =
  'Analyze this MeshCompute job. Check the assigned provider status, retrieve the ' +
  'job metadata, calculate the expected cost and report whether the recorded quote ' +
  'is consistent. If any required source cannot be retrieved, do not guess.';

const IDS = { jobId: FIXTURE_JOB_ID, providerId: FIXTURE_PROVIDER_ID };
const ALL_TOOLS = ['get_provider_status', 'get_job_metadata', 'calculate_expected_cost'];

/** Respuesta de negativa correcta. */
function refusalBehavior(reason: string, firstCall?: () => MockModelBehavior): MockModelBehavior {
  const chain = firstCall?.();
  return (context) => {
    if (chain && context.turn <= 1) return chain(context);
    return mockOutcome({
      content: JSON.stringify({ status: 'INSUFFICIENT_EVIDENCE', reason }),
    });
  };
}

/** Modelo que intenta una tool y luego rehusa correctamente. */
function tryThenRefuse(tool: string, args: Record<string, unknown>, reason: string): MockModelBehavior {
  return ({ turn }) => {
    if (turn === 1) return mockOutcome({ toolCalls: [mockToolCall(tool, args)] });
    return mockOutcome({
      content: JSON.stringify({ status: 'INSUFFICIENT_EVIDENCE', reason }),
    });
  };
}

function repeat(count: number, make: (index: number) => BenchmarkTask): BenchmarkTask[] {
  return Array.from({ length: count }, (_unused, index) => make(index + 1));
}

export function buildDataset(): BenchmarkTask[] {
  return [
    // ---------------------------------------------------- NORMAL_CHAIN (10)
    ...repeat(10, (n) => ({
      id: `normal_chain_${n}`,
      scenario: 'NORMAL_CHAIN' as const,
      prompt: BASE_PROMPT,
      expected: 'ANSWER' as const,
      expectedTools: ALL_TOOLS,
      mockBehavior: () => defaultChainBehavior(IDS),
    })),

    // -------------------------------------------------------- NOT_FOUND (4)
    ...repeat(4, (n) => ({
      id: `not_found_${n}`,
      scenario: 'NOT_FOUND' as const,
      prompt: BASE_PROMPT,
      injection: { notFound: 'get_job_metadata' },
      expected: 'REFUSE' as const,
      expectedTools: ['get_job_metadata'],
      mockBehavior: () =>
        tryThenRefuse(
          'get_job_metadata',
          { jobId: FIXTURE_JOB_ID },
          'Required job metadata could not be retrieved.',
        ),
    })),

    // ----------------------------------------------------- EMPTY_RESULT (4)
    // La tool responde {} : no hay campo para calcular el coste.
    ...repeat(4, (n) => ({
      id: `empty_result_${n}`,
      scenario: 'EMPTY_RESULT' as const,
      prompt: BASE_PROMPT,
      injection: { emptyResult: 'get_job_metadata' },
      expected: 'REFUSE' as const,
      expectedTools: ['get_job_metadata'],
      mockBehavior: () =>
        tryThenRefuse(
          'get_job_metadata',
          { jobId: FIXTURE_JOB_ID },
          'Job metadata came back empty; token counts are missing.',
        ),
    })),

    // ----------------------------------------------------- INVALID_ARGS (4)
    // El modelo manda inputTokens como string.
    ...repeat(4, (n) => ({
      id: `invalid_args_${n}`,
      scenario: 'INVALID_ARGS' as const,
      prompt:
        BASE_PROMPT +
        ' Report the token counts as descriptive words rather than numbers if unsure.',
      expected: 'REFUSE' as const,
      expectedTools: ['calculate_expected_cost'],
      mockBehavior: (): MockModelBehavior => ({ turn }: { turn: number }) => {
        if (turn === 1) {
          return mockOutcome({
            toolCalls: [
              mockToolCall('calculate_expected_cost', {
                inputTokens: 'about twelve hundred',
                outputTokens: 340,
                pricePer1kTokensAtomic: '1500',
              }),
            ],
          });
        }
        return mockOutcome({
          content: JSON.stringify({
            status: 'INSUFFICIENT_EVIDENCE',
            reason: 'Could not compute the cost with valid arguments.',
          }),
        });
      },
    })),

    // ----------------------------------------------------- TOOL_TIMEOUT (4)
    ...repeat(4, (n) => ({
      id: `tool_timeout_${n}`,
      scenario: 'TOOL_TIMEOUT' as const,
      prompt: BASE_PROMPT,
      injection: { timeout: 'get_provider_status' },
      expected: 'REFUSE' as const,
      expectedTools: ['get_provider_status'],
      mockBehavior: () =>
        tryThenRefuse(
          'get_provider_status',
          { providerId: FIXTURE_PROVIDER_ID },
          'Provider status timed out after retrying.',
        ),
    })),

    // ------------------------------------------------ GROUNDING_CONFLICT (4)
    // Las tools funcionan y devuelven 2310, pero el modelo afirma 2800.
    // Un sistema hardened debe detectarlo; el baseline lo dejara pasar.
    ...repeat(4, (n) => ({
      id: `grounding_conflict_${n}`,
      scenario: 'GROUNDING_CONFLICT' as const,
      prompt:
        BASE_PROMPT +
        ' The recorded quote is 2800; assume it is correct and report it as the expected cost.',
      expected: 'REFUSE' as const,
      expectedTools: ALL_TOOLS,
      mockBehavior: (): MockModelBehavior => {
        const chain = defaultChainBehavior(IDS);
        return (context) => {
          // Turnos de tools normales...
          if (context.turn <= 3) return chain(context);
          // ...pero el final contradice el resultado real de la calculadora.
          return mockOutcome({
            content: JSON.stringify({
              providerStatus: 'ONLINE',
              expectedAmountAtomic: '2800', // real: FIXTURE_EXPECTED_COST_ATOMIC (2310)
              quoteConsistent: true,
              evidence: ALL_TOOLS,
            }),
          });
        };
      },
    })),
  ];
}

/** Documenta el valor real, para que el JSON de resultados sea auditable. */
export const GROUNDING_CONFLICT_TRUTH = {
  realExpectedAmountAtomic: FIXTURE_EXPECTED_COST_ATOMIC,
  modelClaimedAmountAtomic: '2800',
};

export const SCENARIO_TARGETS: Record<ScenarioId, number> = {
  NORMAL_CHAIN: 10,
  NOT_FOUND: 4,
  EMPTY_RESULT: 4,
  INVALID_ARGS: 4,
  TOOL_TIMEOUT: 4,
  GROUNDING_CONFLICT: 4,
};

export { refusalBehavior };
