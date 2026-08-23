/**
 * Consumer QVAC real: delegated inference contra un provider remoto.
 *
 * Escrito contra `docs/qvac-findings.md`, no contra la documentacion web.
 * Puntos que este archivo encapsula (y que nadie mas debe tener que saber):
 *
 *  - `delegate` va en `loadModel`, no en `completion`.
 *  - `final.contentText`, no `final.content`.
 *  - `stats.promptTokens` / `stats.generatedTokens`, no input/outputTokens.
 *  - `responseFormat` no se puede combinar con `tools`.
 *  - la conexion fria DHT cuesta 15-45 s; el `modelId` se cachea y reusa.
 */

import { cancel, completion, loadModel, unloadModel } from '@qvac/sdk';
import type { LoadModelOptions } from '@qvac/sdk';
import { assertToolCapable, buildModelSource, resolveModel } from './model-registry.js';
import {
  QvacAdapterError,
  isValidPublicKey,
  type ChatMessage,
  type CompleteOptions,
  type CompletionOutcome,
  type DelegatedSession,
  type OpenSessionOptions,
  type QvacConsumerService,
  type ToolCallRequest,
} from './types.js';

/** Traduce un fallo del SDK al codigo estable del doc 01 §26. */
function classifyError(error: unknown, timedOut: boolean): QvacAdapterError {
  if (error instanceof QvacAdapterError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (timedOut || lower.includes('timed out') || lower.includes('timeout')) {
    return new QvacAdapterError('INFERENCE_TIMEOUT', message, error);
  }
  if (
    lower.includes('unreachable') ||
    lower.includes('connect') ||
    lower.includes('peer') ||
    lower.includes('dht') ||
    lower.includes('delegat')
  ) {
    return new QvacAdapterError('PROVIDER_UNREACHABLE', message, error);
  }
  if (lower.includes('worker') || lower.includes('rpc')) {
    return new QvacAdapterError('QVAC_UNAVAILABLE', message, error);
  }
  return new QvacAdapterError('MODEL_LOAD_FAILED', message, error);
}

/**
 * Sesion delegada viva. Una por providerPublicKey.
 *
 * Serializa las completions: el mismo modelId no debe recibir dos requests
 * concurrentes, y el Consumer Agent solo atiende una inferencia a la vez.
 */
class QvacDelegatedSession implements DelegatedSession {
  private inFlight: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(
    readonly modelId: string,
    readonly providerPublicKey: string,
    readonly delegated: boolean,
    private readonly defaultTimeoutMs: number,
  ) {}

  async complete(options: CompleteOptions): Promise<CompletionOutcome> {
    if (this.closed) {
      throw new QvacAdapterError('QVAC_UNAVAILABLE', 'Session already closed.');
    }

    // Encola detras de la anterior para no solapar requests sobre el modelId.
    const run = this.inFlight.then(
      () => this.runCompletion(options),
      () => this.runCompletion(options),
    );
    this.inFlight = run.catch(() => undefined);
    return run;
  }

  private async runCompletion(options: CompleteOptions): Promise<CompletionOutcome> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const startedAt = Date.now();

    // findings §2: responseFormat y tools son mutuamente excluyentes. Se
    // valida aqui para fallar con un mensaje util en vez de un error de Zod
    // del SDK enterrado tres capas mas abajo.
    if (options.responseSchema && options.tools && options.tools.length > 0) {
      throw new QvacAdapterError(
        'MODEL_LOAD_FAILED',
        'responseSchema cannot be combined with tools; emit the final turn without tools.',
      );
    }

    const generation = options.generation ?? {};
    const generationParams: Record<string, unknown> = {};
    if (generation.temperature !== undefined) generationParams['temp'] = generation.temperature;
    if (generation.seed !== undefined) generationParams['seed'] = generation.seed;
    if (generation.maxTokens !== undefined) generationParams['predict'] = generation.maxTokens;
    if (generation.disableReasoning) generationParams['reasoning_budget'] = 0;

    const params: Record<string, unknown> = {
      modelId: this.modelId,
      history: options.history.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    };
    if (Object.keys(generationParams).length > 0) {
      params['generationParams'] = generationParams;
    }
    if (options.tools && options.tools.length > 0) {
      params['tools'] = options.tools;
    }
    if (options.responseSchema) {
      params['responseFormat'] = {
        type: 'json_schema',
        json_schema: {
          name: options.responseSchema.name,
          schema: options.responseSchema.schema,
        },
      };
    }

    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    try {
      const run = completion(params as Parameters<typeof completion>[0]);

      timer = setTimeout(() => {
        timedOut = true;
        // cancel() solo surte efecto una vez el server registro el request.
        void Promise.resolve(cancel({ requestId: run.requestId })).catch(() => undefined);
      }, timeoutMs);

      // Se recogen las tool calls desde el stream de eventos: es la via
      // canonica y llega antes que `final`.
      const toolCalls: ToolCallRequest[] = [];
      for await (const event of run.events) {
        if (event.type === 'toolCall') {
          const call = (event as { call: ToolCallRequest }).call;
          toolCalls.push({
            id: call.id,
            name: call.name,
            arguments: (call.arguments ?? {}) as Record<string, unknown>,
          });
        }
      }

      const final = await run.final;
      const durationMs = Date.now() - startedAt;

      if (timedOut) {
        throw new QvacAdapterError(
          'INFERENCE_TIMEOUT',
          `Provider did not answer within ${timeoutMs} ms.`,
        );
      }

      // `final.toolCalls` es la fuente agregada; el stream puede quedarse
      // corto si el modelo emitio la llamada en el ultimo frame.
      const finalToolCalls = Array.isArray(final.toolCalls) ? final.toolCalls : [];
      for (const call of finalToolCalls) {
        if (!toolCalls.some((seen) => seen.id === call.id)) {
          toolCalls.push({
            id: call.id,
            name: call.name,
            arguments: (call.arguments ?? {}) as Record<string, unknown>,
          });
        }
      }

      return {
        content: final.contentText ?? '',
        toolCalls,
        stopReason: final.stopReason ?? 'eos',
        stats: {
          durationMs,
          ...(final.stats?.promptTokens !== undefined
            ? { inputTokens: final.stats.promptTokens }
            : {}),
          ...(final.stats?.generatedTokens !== undefined
            ? { outputTokens: final.stats.generatedTokens }
            : {}),
          ...(final.stats?.backendDevice !== undefined
            ? { backendDevice: final.stats.backendDevice }
            : {}),
          ...(final.stats?.tokensPerSecond !== undefined
            ? { tokensPerSecond: final.stats.tokensPerSecond }
            : {}),
        },
      };
    } catch (error) {
      throw classifyError(error, timedOut);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await unloadModel({ modelId: this.modelId });
    } catch {
      // Cerrar es best-effort: si el worker ya murio, no hay nada que liberar.
    }
  }
}

/**
 * Servicio consumer con cache de sesiones por providerPublicKey.
 *
 * El SDK no reconecta solo si el provider reinicia (findings): por eso
 * `dropSession` existe y el Consumer Agent la llama cuando una inferencia
 * falla con PROVIDER_UNREACHABLE.
 */
export class QvacConsumer implements QvacConsumerService {
  private readonly sessions = new Map<string, DelegatedSession>();
  private readonly pending = new Map<string, Promise<DelegatedSession>>();

  async openSession(options: OpenSessionOptions): Promise<DelegatedSession> {
    const key = options.providerPublicKey;

    if (!isValidPublicKey(key)) {
      throw new QvacAdapterError(
        'INVALID_PUBLIC_KEY',
        'providerPublicKey must be a 64-character hex string (32-byte ed25519 public key).',
      );
    }

    const existing = this.sessions.get(key);
    if (existing && !options.forceNewConnection) return existing;

    // Dos peticiones simultaneas al mismo provider no deben abrir dos
    // conexiones DHT: la segunda espera a la primera.
    const inFlight = this.pending.get(key);
    if (inFlight && !options.forceNewConnection) return inFlight;

    const creation = this.createSession(options)
      .then((session) => {
        this.sessions.set(key, session);
        return session;
      })
      .finally(() => {
        this.pending.delete(key);
      });

    this.pending.set(key, creation);
    return creation;
  }

  private async createSession(options: OpenSessionOptions): Promise<DelegatedSession> {
    const model = resolveModel(options.modelKey);

    // Si se piden tools, el modelo tiene que poder hacerlas. Fallar aqui da un
    // mensaje claro; no hacerlo daria un benchmark con cero tool calls.
    const wantTools = options.enableTools ?? model.supportsTools;
    if (wantTools) assertToolCapable(model);

    const source = buildModelSource(model);

    const modelConfig: Record<string, unknown> = { ctx_size: model.ctxSize };
    if (wantTools) modelConfig['tools'] = true;
    if (source.projectionModelSrc) {
      modelConfig['projectionModelSrc'] = source.projectionModelSrc;
    }

    try {
      const modelId = await loadModel({
        modelSrc: source.modelSrc,
        ...(source.modelType ? { modelType: source.modelType } : {}),
        modelConfig,
        delegate: {
          providerPublicKey: options.providerPublicKey,
          timeout: options.timeoutMs,
          fallbackToLocal: options.fallbackToLocal,
          forceNewConnection: options.forceNewConnection ?? false,
        },
      } as LoadModelOptions);

      return new QvacDelegatedSession(
        modelId,
        options.providerPublicKey,
        !options.fallbackToLocal,
        options.timeoutMs,
      );
    } catch (error) {
      throw classifyError(error, false);
    }
  }

  async dropSession(providerPublicKey: string): Promise<void> {
    const session = this.sessions.get(providerPublicKey);
    if (!session) return;
    this.sessions.delete(providerPublicKey);
    await session.close();
  }

  isReady(): boolean {
    return this.sessions.size > 0;
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.map((session) => session.close()));
  }
}

/** Helper de conveniencia usado por los spikes. */
export async function runDelegatedCompletion(input: {
  providerPublicKey: string;
  prompt: string;
  modelKey: string;
  timeoutMs: number;
  fallbackToLocal: boolean;
}): Promise<CompletionOutcome> {
  const consumer = new QvacConsumer();
  try {
    const session = await consumer.openSession({
      providerPublicKey: input.providerPublicKey,
      modelKey: input.modelKey,
      timeoutMs: input.timeoutMs,
      fallbackToLocal: input.fallbackToLocal,
    });
    const history: ChatMessage[] = [{ role: 'user', content: input.prompt }];
    return await session.complete({ history });
  } finally {
    await consumer.closeAll();
  }
}
