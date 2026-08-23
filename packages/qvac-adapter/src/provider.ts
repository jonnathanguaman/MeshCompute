/**
 * Provider QVAC real: convierte la maquina en nodo de inferencia.
 *
 * Doc 01 §8. Escrito contra `docs/qvac-findings.md`.
 */

import { loadModel, startQVACProvider, stopQVACProvider, unloadModel } from '@qvac/sdk';
import type { LoadModelOptions } from '@qvac/sdk';
import { buildModelSource, resolveModel } from './model-registry.js';
import {
  QvacAdapterError,
  type ProviderStartOptions,
  type QvacProviderService,
} from './types.js';

export class QvacProvider implements QvacProviderService {
  private publicKey: string | undefined;
  private warmModelId: string | undefined;

  /**
   * Arranca el servicio provider y devuelve la public key a publicar.
   *
   * PA-001: `startQVACProvider` puede devolver `success: false` SIN lanzar.
   * Comprobarlo es obligatorio; si no, el agente se registraria como ONLINE
   * con un runtime muerto.
   */
  async start(options: ProviderStartOptions = {}): Promise<{ publicKey: string }> {
    const allowed = options.allowedConsumerKeys ?? [];

    const params =
      allowed.length > 0 ? { firewall: { mode: 'allow' as const, publicKeys: allowed } } : {};

    let response: Awaited<ReturnType<typeof startQVACProvider>>;
    try {
      response = await startQVACProvider(params);
    } catch (error) {
      throw new QvacAdapterError(
        'QVAC_UNAVAILABLE',
        `startQVACProvider threw: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }

    if (!response.success || !response.publicKey) {
      throw new QvacAdapterError(
        'QVAC_UNAVAILABLE',
        `QVAC provider failed to start: ${response.error ?? 'unknown error'}`,
      );
    }

    this.publicKey = response.publicKey;
    return { publicKey: response.publicKey };
  }

  /**
   * Precarga el modelo localmente.
   *
   * Sin esto, la primera inferencia delegada dispara la descarga del GGUF
   * (737 MB / 1 GB segun el modelo) mientras el consumer espera, y la demo
   * parece colgada. Doc 00 §39: "calentar previamente la conexion".
   */
  async warmup(modelKey: string): Promise<void> {
    const model = resolveModel(modelKey);
    const source = buildModelSource(model);

    const modelConfig: Record<string, unknown> = { ctx_size: model.ctxSize };
    if (model.supportsTools) modelConfig['tools'] = true;
    if (source.projectionModelSrc) {
      modelConfig['projectionModelSrc'] = source.projectionModelSrc;
    }

    try {
      this.warmModelId = await loadModel({
        modelSrc: source.modelSrc,
        ...(source.modelType ? { modelType: source.modelType } : {}),
        modelConfig,
      } as LoadModelOptions);
    } catch (error) {
      throw new QvacAdapterError(
        'MODEL_LOAD_FAILED',
        `Could not warm up model "${modelKey}": ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  getPublicKey(): string | undefined {
    return this.publicKey;
  }

  /** PA-008: apagado limpio. Idempotente, como el propio SDK. */
  async stop(): Promise<void> {
    if (this.warmModelId) {
      try {
        await unloadModel({ modelId: this.warmModelId });
      } catch {
        // best-effort
      }
      this.warmModelId = undefined;
    }
    try {
      await stopQVACProvider();
    } catch {
      // best-effort: idempotente por contrato del SDK
    }
    this.publicKey = undefined;
  }
}
