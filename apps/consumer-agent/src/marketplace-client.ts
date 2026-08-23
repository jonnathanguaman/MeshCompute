/**
 * Cliente del Marketplace API para el Consumer Agent.
 *
 * ESTE ARCHIVO ES LA FRONTERA DE PRIVACIDAD (CA-007 / RNF-01).
 *
 * Es el unico punto por el que el Consumer Agent habla con la API central, y
 * lo unico que puede enviar es `JobProgressPatch`. El payload se valida con
 * el schema `.strict()` de contracts ANTES de salir por la red: si alguien
 * anadiera `content` o `prompt` al patch, el envio falla aqui en vez de
 * filtrarse. Doc 00 §9 convierte la privacidad en propiedad tecnica.
 */

import type { Logger } from '@meshcompute/config';
import {
  CONSUMER_EMITTABLE_STATUSES,
  JobProgressPatchSchema,
  type ConsumerEmittableStatus,
  type JobMetadataDTO,
  type JobProgressPatch,
  type ProviderPublicDTO,
} from '@meshcompute/contracts';

export interface ConsumerMarketplaceClient {
  patchProgress(jobId: string, executionToken: string, patch: JobProgressPatch): Promise<void>;
  getProvider(providerId: string): Promise<ProviderPublicDTO | undefined>;
  getJob(jobId: string): Promise<JobMetadataDTO | undefined>;
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

/** Doc 01 §25: no inventar estados. Solo estos seis salen de aqui. */
function assertEmittableStatus(status: string | undefined): void {
  if (status === undefined) return;
  if (!CONSUMER_EMITTABLE_STATUSES.includes(status as ConsumerEmittableStatus)) {
    throw new Error(
      `Consumer Agent must not emit job status "${status}". ` +
        `Allowed: ${CONSUMER_EMITTABLE_STATUSES.join(', ')}`,
    );
  }
}

export class HttpConsumerMarketplaceClient implements ConsumerMarketplaceClient {
  constructor(
    private readonly baseUrl: string,
    private readonly logger: Logger,
    private readonly timeoutMs = 5_000,
  ) {}

  async patchProgress(
    jobId: string,
    executionToken: string,
    patch: JobProgressPatch,
  ): Promise<void> {
    // Doble red de seguridad: schema estricto + whitelist de estados.
    const safe = JobProgressPatchSchema.parse(patch);
    assertEmittableStatus(safe.status);

    const response = await this.request(
      `/v1/jobs/${encodeURIComponent(jobId)}/progress`,
      {
        method: 'PATCH',
        body: JSON.stringify(safe),
        headers: { 'X-Execution-Token': executionToken },
      },
    );

    if (!response.ok) {
      throw new Error(`progress patch failed: HTTP ${response.status}`);
    }
    this.logger.debug({ event: 'job_progress_sent', jobId, status: safe.status });
  }

  async getProvider(providerId: string): Promise<ProviderPublicDTO | undefined> {
    const response = await this.request(`/v1/providers/${encodeURIComponent(providerId)}`, {
      method: 'GET',
    });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`getProvider failed: HTTP ${response.status}`);
    const body = (await response.json()) as { provider?: ProviderPublicDTO };
    if (!body.provider) throw new Error('getProvider response missing provider');
    return body.provider;
  }

  async getJob(jobId: string): Promise<JobMetadataDTO | undefined> {
    const response = await this.request(`/v1/jobs/${encodeURIComponent(jobId)}`, {
      method: 'GET',
    });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`getJob failed: HTTP ${response.status}`);
    const body = (await response.json()) as { job?: JobMetadataDTO };
    if (!body.job) throw new Error('getJob response missing job');
    return body.job;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Modo MARKETPLACE_DISABLED (doc 01 §24): imprime los estados localmente y no
 * hace fallar la inferencia. Los GET de tools se sirven desde fixtures, que
 * inyecta el llamador.
 */
export class DisabledConsumerMarketplaceClient implements ConsumerMarketplaceClient {
  constructor(
    private readonly logger: Logger,
    private readonly fixtures: {
      providers?: Map<string, ProviderPublicDTO>;
      jobs?: Map<string, JobMetadataDTO>;
    } = {},
  ) {}

  async patchProgress(
    jobId: string,
    _executionToken: string,
    patch: JobProgressPatch,
  ): Promise<void> {
    const safe = JobProgressPatchSchema.parse(patch);
    assertEmittableStatus(safe.status);
    this.logger.info({
      event: 'job_progress_local',
      jobId,
      status: safe.status,
      verificationStatus: safe.verificationStatus,
      outputHash: safe.outputHash,
    });
  }

  async getProvider(providerId: string): Promise<ProviderPublicDTO | undefined> {
    return this.fixtures.providers?.get(providerId);
  }

  async getJob(jobId: string): Promise<JobMetadataDTO | undefined> {
    return this.fixtures.jobs?.get(jobId);
  }
}

/**
 * Envoltura best-effort para el envio de progreso.
 *
 * Doc 01 §26: si el marketplace no esta disponible, la inferencia puede
 * terminar igualmente. Un fallo al reportar estado NUNCA debe tumbar un job
 * que si se ejecuto.
 */
export async function reportProgressBestEffort(
  client: ConsumerMarketplaceClient,
  logger: Logger,
  jobId: string,
  executionToken: string,
  patch: JobProgressPatch,
): Promise<void> {
  try {
    await client.patchProgress(jobId, executionToken, patch);
  } catch (error) {
    logger.warn({
      event: 'job_progress_failed',
      jobId,
      status: patch.status,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
