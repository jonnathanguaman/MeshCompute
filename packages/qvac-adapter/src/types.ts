/**
 * Frontera tipada con QVAC.
 *
 * Doc 01 §6: "C y B nunca importan QVAC directamente. Si cambia una firma del
 * SDK, cambias un solo paquete."
 *
 * Nada de este archivo importa `@qvac/sdk`: son los tipos que el resto del
 * monorepo consume. La traduccion a la superficie real del SDK vive en
 * `provider.ts` / `consumer.ts`, contra `docs/qvac-findings.md`.
 */

/** Mensaje de conversacion. `role` es libre en el SDK; `tool` es valido. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

/**
 * Definicion de tool que se declara al modelo.
 *
 * Se declara SIN handler a proposito: el SDK solo ejecuta si le pasamos uno
 * (ver findings §1). Al omitirlo, el orchestrator conserva el control de
 * whitelist -> scope -> Zod -> retry, que es justo lo que mide el benchmark.
 */
export interface ToolDefinition {
  /**
   * Discriminante que exige `toolSchema` del SDK. Sin el, `validateTools` no
   * reconoce el objeto como `Tool` y cae al camino `ToolInput`, que espera un
   * ZodObject en `parameters` en vez de un JSON Schema.
   */
  type: 'function';
  name: string;
  description: string;
  /** JSON Schema del objeto de argumentos. */
  parameters: {
    type: 'object';
    properties: Record<
      string,
      {
        type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
        description?: string;
        enum?: Array<string | number | boolean | null>;
      }
    >;
    required?: string[];
  };
}

/** Tool call emitida por el modelo. `arguments` llega ya parseado (findings). */
export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Metricas normalizadas. Los nombres del SDK se mapean aqui, no fuera. */
export interface CompletionStatsNormalized {
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
  backendDevice?: 'cpu' | 'gpu';
  tokensPerSecond?: number;
}

export interface CompletionOutcome {
  content: string;
  toolCalls: ToolCallRequest[];
  stopReason: string;
  stats: CompletionStatsNormalized;
}

/** Sampling. `temp: 0` + `seed` fijo habilitan REDUNDANT_DETERMINISTIC. */
export interface GenerationOptions {
  temperature?: number;
  seed?: number;
  maxTokens?: number;
  /** Desactiva el canal de razonamiento (Qwen3 emite `<think>`). */
  disableReasoning?: boolean;
}

/**
 * Restriccion de salida estructurada.
 *
 * IMPORTANTE (findings §2): el SDK rechaza combinar esto con `tools`. El
 * orchestrator lo usa solo en el turno final, que va sin tools.
 */
export interface StructuredOutputSchema {
  name: string;
  schema: Record<string, unknown>;
}

export interface CompleteOptions {
  history: ChatMessage[];
  tools?: ToolDefinition[];
  responseSchema?: StructuredOutputSchema;
  generation?: GenerationOptions;
  /** Timeout de la llamada; se traduce a cancel() del SDK. */
  timeoutMs?: number;
}

/**
 * Sesion de inferencia ya conectada a un provider.
 *
 * Existe porque `loadModel` con delegate paga el coste de bootstrap DHT
 * (15-45 s en frio) y devuelve un `modelId` reutilizable: las llamadas
 * siguientes reusan el socket abierto. Mantener la sesion viva es lo que
 * hace posible "calentar la conexion antes de la demo" (doc 00 §39).
 */
export interface DelegatedSession {
  readonly modelId: string;
  readonly providerPublicKey: string;
  readonly delegated: boolean;
  complete(options: CompleteOptions): Promise<CompletionOutcome>;
  close(): Promise<void>;
}

export interface ProviderStartOptions {
  /**
   * Public keys de consumers autorizados. Vacio = sin firewall (cualquiera
   * puede conectar). Solo para demo.
   */
  allowedConsumerKeys?: string[];
}

export interface QvacProviderService {
  start(options?: ProviderStartOptions): Promise<{ publicKey: string }>;
  /** Precarga el modelo para que la primera peticion delegada no descargue. */
  warmup(modelKey: string): Promise<void>;
  stop(): Promise<void>;
}

export interface OpenSessionOptions {
  providerPublicKey: string;
  modelKey: string;
  timeoutMs: number;
  /** CA-005 / DoD A: `false` en demo, para probar que la ejecucion fue remota. */
  fallbackToLocal: boolean;
  /** `tools: true` en modelConfig. Necesario para el Reliability Orchestrator. */
  enableTools?: boolean;
  forceNewConnection?: boolean;
}

export interface QvacConsumerService {
  /** Abre (o reutiliza) una sesion delegada contra un provider. */
  openSession(options: OpenSessionOptions): Promise<DelegatedSession>;
  /** Invalida la sesion cacheada de un provider (p.ej. tras un reinicio). */
  dropSession(providerPublicKey: string): Promise<void>;
  /** true si hay al menos una sesion viva. Alimenta `qvacReady` de /health. */
  isReady(): boolean;
  closeAll(): Promise<void>;
}

/**
 * Doc 01 §26. El adapter normaliza cualquier fallo del SDK a estos codigos
 * para que el Consumer Agent no tenga que interpretar strings del SDK.
 */
export type QvacErrorCode =
  | 'PROVIDER_UNREACHABLE'
  | 'INFERENCE_TIMEOUT'
  | 'QVAC_UNAVAILABLE'
  | 'MODEL_LOAD_FAILED'
  | 'INVALID_PUBLIC_KEY';

export class QvacAdapterError extends Error {
  readonly code: QvacErrorCode;
  override readonly cause?: unknown;

  constructor(code: QvacErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'QvacAdapterError';
    this.code = code;
    this.cause = cause;
  }
}

/** Public key hyperswarm: ed25519 de 32 bytes en hex. Validado por el SDK. */
export const PUBLIC_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

export function isValidPublicKey(value: string): boolean {
  return PUBLIC_KEY_PATTERN.test(value);
}
