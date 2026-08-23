/**
 * Adapter QVAC falso y determinista.
 *
 * RNF-03 (doc 00 §27): debe haber mocks/fallbacks. Sirve para:
 *  - tests unitarios sin red ni GPU;
 *  - desarrollar el Reliability Orchestrator mientras el carril P2P avanza
 *    en paralelo (doc 01 §31);
 *  - validar el runner del benchmark antes de gastar horas de CPU.
 *
 * NO sustituye al modelo real en el benchmark que se reporta: el doc 01 §18B
 * exige runs reales. El benchmark marca explicitamente el adapter usado.
 */

import {
  QvacAdapterError,
  isValidPublicKey,
  type CompleteOptions,
  type CompletionOutcome,
  type DelegatedSession,
  type OpenSessionOptions,
  type ProviderStartOptions,
  type QvacConsumerService,
  type QvacProviderService,
  type ToolCallRequest,
} from './types.js';

/**
 * Comportamiento de un modelo simulado.
 *
 * Recibe el turno (1-based) y el historial, y decide que responder. Asi un
 * escenario de benchmark puede scriptear "llama la tool 1, luego la 2, luego
 * miente en el final" de forma perfectamente reproducible.
 */
export type MockModelBehavior = (context: {
  turn: number;
  options: CompleteOptions;
}) => CompletionOutcome | Promise<CompletionOutcome>;

let callCounter = 0;

/** Ids estables: el mock no puede usar aleatoriedad si debe ser reproducible. */
function nextCallId(): string {
  callCounter += 1;
  return `mockcall_${callCounter}`;
}

export function resetMockCallIds(): void {
  callCounter = 0;
}

export function mockToolCall(
  name: string,
  args: Record<string, unknown>,
): ToolCallRequest {
  return { id: nextCallId(), name, arguments: args };
}

export function mockOutcome(partial: Partial<CompletionOutcome>): CompletionOutcome {
  return {
    content: partial.content ?? '',
    toolCalls: partial.toolCalls ?? [],
    stopReason: partial.stopReason ?? 'eos',
    stats: {
      inputTokens: partial.stats?.inputTokens ?? 128,
      outputTokens: partial.stats?.outputTokens ?? 64,
      durationMs: partial.stats?.durationMs ?? 5,
      backendDevice: 'cpu',
    },
  };
}

/**
 * Behavior por defecto: encadena las tres tools del registry en orden y
 * cierra con un final coherente construido desde lo que las tools devolvieron
 * (los resultados llegan en el history como role:'tool').
 */
export interface ChainBehaviorIds {
  /** Debe coincidir con ToolContext.jobId o el orchestrator marcara scope violation. */
  jobId: string;
  providerId: string;
}

export function defaultChainBehavior(ids: ChainBehaviorIds): MockModelBehavior {
  return ({ turn, options }) => {
    const toolMessages = options.history.filter((m) => m.role === 'tool');

    if (turn === 1) {
      return mockOutcome({
        toolCalls: [mockToolCall('get_provider_status', { providerId: ids.providerId })],
        stopReason: 'toolCalls',
      });
    }
    if (turn === 2) {
      return mockOutcome({
        toolCalls: [mockToolCall('get_job_metadata', { jobId: ids.jobId })],
        stopReason: 'toolCalls',
      });
    }
    if (turn === 3) {
      // Lee tokens y precio de los resultados ya observados.
      const job = safeParse(toolMessages[1]?.content);
      const provider = safeParse(toolMessages[0]?.content);
      return mockOutcome({
        toolCalls: [
          mockToolCall('calculate_expected_cost', {
            inputTokens: numberOr(job?.['inputTokens'], 1200),
            outputTokens: numberOr(job?.['outputTokens'], 340),
            pricePer1kTokensAtomic: String(
              provider?.['pricePer1kTokensAtomic'] ?? '2000',
            ),
          }),
        ],
        stopReason: 'toolCalls',
      });
    }

    const provider = safeParse(toolMessages[0]?.content);
    const job = safeParse(toolMessages[1]?.content);
    const cost = safeParse(toolMessages[2]?.content);
    const expected = String(cost?.['expectedAmountAtomic'] ?? '0');

    return mockOutcome({
      content: JSON.stringify({
        providerStatus: provider?.['status'] ?? 'ONLINE',
        expectedAmountAtomic: expected,
        quoteConsistent: expected === String(job?.['quotedAmountAtomic'] ?? ''),
        evidence: ['get_provider_status', 'get_job_metadata', 'calculate_expected_cost'],
      }),
    });
  };
}

function safeParse(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

class MockSession implements DelegatedSession {
  constructor(
    readonly modelId: string,
    readonly providerPublicKey: string,
    readonly delegated: boolean,
    private readonly behavior: MockModelBehavior,
  ) {}

  async complete(options: CompleteOptions): Promise<CompletionOutcome> {
    // El turno se DERIVA del history, no de un contador de sesion.
    //
    // El SDK real es stateless por llamada: todo el estado de la conversacion
    // viaja en `history`. Con un contador de sesion, la segunda inferencia
    // sobre una sesion reutilizada (que es el comportamiento correcto y
    // deseado: la conexion DHT se paga una vez) empezaria en el turno 5 y se
    // saltaria toda la cadena de tools.
    const toolMessages = options.history.filter((m) => m.role === 'tool').length;
    return this.behavior({ turn: toolMessages + 1, options });
  }

  async close(): Promise<void> {
    // sin recursos que liberar
  }
}

export interface MockConsumerOptions {
  behavior?: MockModelBehavior;
  /** Ids del job en curso; se usan si no se pasa un `behavior` explicito. */
  ids?: ChainBehaviorIds;
  /** Simula un provider inalcanzable al abrir sesion (para probar T-05). */
  unreachable?: boolean;
}

export class MockQvacConsumer implements QvacConsumerService {
  private readonly sessions = new Map<string, DelegatedSession>();
  private behavior: MockModelBehavior;
  private unreachable: boolean;

  constructor(options: MockConsumerOptions = {}) {
    this.behavior =
      options.behavior ??
      defaultChainBehavior(options.ids ?? { jobId: 'job_123', providerId: 'p_001' });
    this.unreachable = options.unreachable ?? false;
  }

  setBehavior(behavior: MockModelBehavior): void {
    this.behavior = behavior;
  }

  setUnreachable(value: boolean): void {
    this.unreachable = value;
  }

  async openSession(options: OpenSessionOptions): Promise<DelegatedSession> {
    if (!isValidPublicKey(options.providerPublicKey)) {
      throw new QvacAdapterError(
        'INVALID_PUBLIC_KEY',
        'providerPublicKey must be a 64-character hex string (32-byte ed25519 public key).',
      );
    }
    if (this.unreachable) {
      throw new QvacAdapterError(
        'PROVIDER_UNREACHABLE',
        'Mock provider is configured as unreachable.',
      );
    }

    // Sesion nueva por llamada cuando se fuerza, para que cada run del
    // benchmark empiece con el contador de turnos en cero.
    const existing = this.sessions.get(options.providerPublicKey);
    if (existing && !options.forceNewConnection) return existing;

    const session = new MockSession(
      `mock-model:${options.modelKey}`,
      options.providerPublicKey,
      !options.fallbackToLocal,
      this.behavior,
    );
    this.sessions.set(options.providerPublicKey, session);
    return session;
  }

  async dropSession(providerPublicKey: string): Promise<void> {
    this.sessions.delete(providerPublicKey);
  }

  isReady(): boolean {
    return true;
  }

  async closeAll(): Promise<void> {
    this.sessions.clear();
  }
}

/** Public key valida (64 hex) para fixtures y tests. */
export const MOCK_PROVIDER_PUBLIC_KEY = 'a'.repeat(64);

export class MockQvacProvider implements QvacProviderService {
  private started = false;

  async start(_options: ProviderStartOptions = {}): Promise<{ publicKey: string }> {
    this.started = true;
    return { publicKey: MOCK_PROVIDER_PUBLIC_KEY };
  }

  async warmup(_modelKey: string): Promise<void> {
    // nada que precargar
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  isStarted(): boolean {
    return this.started;
  }
}
