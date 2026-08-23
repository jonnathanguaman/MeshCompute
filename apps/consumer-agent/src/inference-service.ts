/**
 * Orquestacion del flujo de inferencia. Doc 01 §18 (los 11 pasos).
 *
 * Frontera de privacidad, explicita:
 *   - el prompt entra por loopback y NUNCA sale hacia el puerto 4000;
 *   - a la central van hash, metricas, estado y resultado de verificacion;
 *   - el output completo y el trace vuelven SOLO a la UI local.
 */

import type { Logger } from '@meshcompute/config';
import type {
  JobProgressPatch,
  LocalInferenceRequest,
  LocalInferenceResponse,
  ReliabilitySummary,
} from '@meshcompute/contracts';
import {
  QvacAdapterError,
  resolveModel,
  type QvacConsumerService,
} from '@meshcompute/qvac-adapter';
import type { ConsumerConfig } from './config.js';
import { ConsumerError } from './errors.js';
import { hashOutput } from './hashing.js';
import {
  reportProgressBestEffort,
  type ConsumerMarketplaceClient,
} from './marketplace-client.js';
import { ReliabilityOrchestrator } from './reliability/orchestrator.js';
import type { RetryPolicy } from './reliability/retry-policy.js';
import type { ToolContext } from './reliability/tool-registry.js';
import {
  notRequested,
  verifyLocalSchema,
  verifyRedundant,
  type VerificationOutcome,
} from './verification.js';

export interface InferenceServiceDeps {
  config: ConsumerConfig;
  logger: Logger;
  qvac: QvacConsumerService;
  marketplace: ConsumerMarketplaceClient;
}

export class InferenceService {
  private readonly orchestrator = new ReliabilityOrchestrator();
  /** CA: el agente atiende una inferencia a la vez (una maquina, un modelo). */
  private busy = false;

  constructor(private readonly deps: InferenceServiceDeps) {}

  isBusy(): boolean {
    return this.busy;
  }

  async run(request: LocalInferenceRequest): Promise<LocalInferenceResponse> {
    if (this.busy) {
      throw new ConsumerError('CONSUMER_AGENT_BUSY');
    }
    this.busy = true;
    try {
      return await this.execute(request);
    } finally {
      this.busy = false;
    }
  }

  private async execute(request: LocalInferenceRequest): Promise<LocalInferenceResponse> {
    const { config, logger, qvac, marketplace } = this.deps;
    const { jobId } = request;
    const startedAt = Date.now();

    // Paso 1: no loguear el body. Solo identificadores.
    logger.info({
      event: 'inference_received',
      jobId,
      providerId: request.provider.id,
      verificationMode: request.verificationMode,
    });

    const patch = (p: JobProgressPatch): Promise<void> =>
      reportProgressBestEffort(marketplace, logger, jobId, request.executionToken, p);

    // Paso 2: CONNECTING
    await patch({ status: 'CONNECTING' });

    // RF-J13 con guardia por modelo: el orchestrator (tools) solo se activa si
    // el chat template del modelo soporta tool calling. Un modelo sin tools
    // (p.ej. demo-llm) usa el camino simple en vez de fallar con un error
    // enganoso de conexion.
    const reliabilityActive =
      config.RELIABILITY_ENABLED && this.modelSupportsTools(request.provider.modelKey);
    if (config.RELIABILITY_ENABLED && !reliabilityActive) {
      logger.info({
        event: 'reliability_downgraded',
        jobId,
        modelKey: request.provider.modelKey,
        reason: 'model_does_not_support_tools',
      });
    }

    let session;
    try {
      // Paso 3: loadModel(delegate) con fallbackToLocal desde config.
      session = await qvac.openSession({
        providerPublicKey: request.provider.qvacPublicKey,
        modelKey: request.provider.modelKey,
        timeoutMs: config.QVAC_FIRST_CONNECT_TIMEOUT_MS,
        fallbackToLocal: config.QVAC_FALLBACK_TO_LOCAL,
        enableTools: reliabilityActive,
      });
      logger.info({
        event: 'qvac_connected',
        jobId,
        providerId: request.provider.id,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      // CA-009: el usuario recibe un error entendible y el job queda FAILED.
      await patch({ status: 'FAILED' });
      throw this.toConsumerError(error, request.provider.qvacPublicKey);
    }

    // Paso 4: RUNNING
    await patch({ status: 'RUNNING' });

    let content: string;
    let summary: ReliabilitySummary;
    let stats: { inputTokens?: number; outputTokens?: number; durationMs: number };

    try {
      // Paso 5: ejecutar. RF-J13: la ejecucion principal pasa por el
      // Reliability Orchestrator, no por un camino paralelo.
      if (reliabilityActive) {
        const policy: RetryPolicy = {
          maxToolTurns: config.MAX_TOOL_TURNS,
          maxToolRetries: config.MAX_TOOL_RETRIES,
          maxFinalSchemaRetries: config.MAX_FINAL_SCHEMA_RETRIES,
          toolTimeoutMs: config.TOOL_TIMEOUT_MS,
        };
        const ctx: ToolContext = {
          jobId,
          providerId: request.provider.id,
          marketplace,
          timeoutMs: config.TOOL_TIMEOUT_MS,
        };

        const result = await this.orchestrator.run({
          session,
          ctx,
          policy,
          prompt: request.prompt,
          logger,
          hardened: true,
        });

        content = result.content;
        summary = result.summary;
        stats = result.stats;
      } else {
        // Camino simple: sin tools. Se conserva para el spike P2P y para
        // demostrar delegated inference sin la capa Track 2.
        const outcome = await session.complete({
          history: [{ role: 'user', content: request.prompt }],
          // Keep the no-tools demo path identical to the proven two-machine
          // spike. `reasoning_budget` is not supported by every registry
          // model and can make Llama delegated requests time out.
          generation: { temperature: 0, seed: 42 },
        });
        content = outcome.content;
        stats = {
          inputTokens: outcome.stats.inputTokens,
          outputTokens: outcome.stats.outputTokens,
          durationMs: outcome.stats.durationMs,
        };
        summary = {
          status: 'PASSED',
          successfulTools: 0,
          failedTools: 0,
          retries: 0,
          schemaPassed: true,
          groundingPassed: true,
          trace: [],
        };
      }
    } catch (error) {
      await patch({ status: 'FAILED' });
      // El SDK no reconecta si el provider reinicio: se invalida la sesion
      // cacheada para que el proximo intento abra una nueva.
      if (error instanceof QvacAdapterError && error.code === 'PROVIDER_UNREACHABLE') {
        await qvac.dropSession(request.provider.qvacPublicKey);
      }
      throw this.toConsumerError(error, request.provider.qvacPublicKey);
    }

    // Pasos 7-8: normalizar y hashear.
    const { hash: outputHash } = hashOutput(content);

    // Paso 9: verificar.
    await patch({
      status: 'VERIFYING',
      outputHash,
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      durationMs: stats.durationMs,
    });

    const verification = await this.verify(request, content, outputHash, summary);

    // Paso 10: a la central solo hash/metricas/estado/verificacion.
    const verified = verification.status === 'PASSED' || verification.status === 'NOT_REQUESTED';
    await patch({
      status: verified ? 'VERIFIED' : 'VERIFICATION_FAILED',
      verificationStatus:
        verification.status === 'NOT_REQUESTED' ? 'NOT_REQUESTED' : verification.status,
    });

    logger.info({
      event: 'inference_completed',
      jobId,
      providerId: request.provider.id,
      status: verified ? 'VERIFIED' : 'VERIFICATION_FAILED',
      reliability: summary.status,
      durationMs: Date.now() - startedAt,
      outputHash,
    });

    // Paso 11: el output completo vuelve SOLO aqui, a la UI local (CA-006).
    const response: LocalInferenceResponse = {
      jobId,
      content,
      outputHash,
      stats: {
        inputTokens: stats.inputTokens,
        outputTokens: stats.outputTokens,
        durationMs: stats.durationMs,
      },
      verification: {
        mode: verification.mode,
        status: verification.status,
        ...(verification.verifierOutputHash
          ? { verifierOutputHash: verification.verifierOutputHash }
          : {}),
      },
      reliability: summary,
    };
    return response;
  }

  private async verify(
    request: LocalInferenceRequest,
    content: string,
    outputHash: string,
    summary: ReliabilitySummary,
  ): Promise<VerificationOutcome> {
    const { config, logger, qvac } = this.deps;

    if (request.verificationMode === 'NONE') return notRequested();

    if (request.verificationMode === 'REDUNDANT_DETERMINISTIC') {
      if (!request.verifier) {
        logger.warn({
          event: 'verifier_missing',
          jobId: request.jobId,
          hint: 'REDUNDANT_DETERMINISTIC requested without a verifier; falling back to LOCAL_SCHEMA',
        });
        return verifyLocalSchema({
          content,
          reliabilityPassed: summary.schemaPassed && summary.groundingPassed,
        });
      }

      try {
        const verifierSession = await qvac.openSession({
          providerPublicKey: request.verifier.qvacPublicKey,
          modelKey: request.provider.modelKey,
          timeoutMs: config.QVAC_FIRST_CONNECT_TIMEOUT_MS,
          fallbackToLocal: false,
          enableTools: false,
        });
        return await verifyRedundant({
          prompt: request.prompt,
          primaryOutputHash: outputHash,
          verifierSession,
          seed: 42,
        });
      } catch (error) {
        // Doc 01 §37: si el segundo provider falla, se cae a LOCAL_SCHEMA en
        // vez de tumbar el job.
        logger.warn({
          event: 'verifier_unavailable',
          jobId: request.jobId,
          error: error instanceof Error ? error.message : String(error),
        });
        return verifyLocalSchema({
          content,
          reliabilityPassed: summary.schemaPassed && summary.groundingPassed,
        });
      }
    }

    return verifyLocalSchema({
      content,
      reliabilityPassed: summary.schemaPassed && summary.groundingPassed,
    });
  }

  private modelSupportsTools(modelKey: string): boolean {
    try {
      return resolveModel(modelKey).supportsTools;
    } catch {
      // Clave desconocida: que falle openSession con su propio mensaje.
      return false;
    }
  }

  private toConsumerError(error: unknown, publicKey: string): ConsumerError {
    if (error instanceof ConsumerError) return error;

    if (error instanceof QvacAdapterError) {
      switch (error.code) {
        case 'PROVIDER_UNREACHABLE':
          return new ConsumerError('PROVIDER_UNREACHABLE', {
            providerPublicKey: `${publicKey.slice(0, 8)}...`,
          });
        case 'INFERENCE_TIMEOUT':
          return new ConsumerError('INFERENCE_TIMEOUT');
        case 'INVALID_PUBLIC_KEY':
          return new ConsumerError('INVALID_REQUEST', {
            reason: 'providerPublicKey must be a 64-character hex string',
          });
        case 'QVAC_UNAVAILABLE':
          return new ConsumerError('QVAC_UNAVAILABLE');
        default:
          return new ConsumerError('PROVIDER_UNREACHABLE');
      }
    }
    return new ConsumerError('PROVIDER_UNREACHABLE');
  }
}
