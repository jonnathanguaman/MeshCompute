import type {
  JobCreateRequest,
  JobCreateResponse,
  JobMetadataDTO,
  JobStatus,
  ProviderPublicDTO,
} from '@meshcompute/contracts';
import { webConfig } from './config';
import type { MarketplaceStats } from './types';
import {
  createMockJob,
  getMockJob,
  getMockJobs,
  getMockProvider,
  getMockProviders,
  getMockStats,
  settleMockJob,
} from '@/mocks/demo-data';

export class MarketplaceApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'MarketplaceApiError';
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${webConfig.marketplaceApiUrl}${path}`, {
    ...init,
    headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
    cache: 'no-store',
  });
  const body = (await response.json().catch(() => ({}))) as {
    code?: string;
    message?: string;
  } & T;
  if (!response.ok) {
    throw new MarketplaceApiError(
      body.code ?? 'MARKETPLACE_UNAVAILABLE',
      body.message ?? 'Marketplace unavailable.',
      response.status,
    );
  }
  return body;
}

export async function getProviders(status?: ProviderPublicDTO['status']): Promise<ProviderPublicDTO[]> {
  if (webConfig.useMocks) {
    const providers = getMockProviders();
    return status ? providers.filter((provider) => provider.status === status) : providers;
  }
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const result = await requestJson<{ providers: ProviderPublicDTO[] }>(`/v1/providers${query}`);
  return result.providers;
}

export async function getProvider(id: string): Promise<ProviderPublicDTO> {
  if (webConfig.useMocks) {
    const provider = getMockProvider(id);
    if (!provider) throw new MarketplaceApiError('PROVIDER_NOT_FOUND', 'Provider not found.', 404);
    return provider;
  }
  const result = await requestJson<{ provider: ProviderPublicDTO }>(`/v1/providers/${id}`);
  return result.provider;
}

export async function createJob(
  input: JobCreateRequest,
  sessionToken?: string,
): Promise<JobCreateResponse> {
  if (webConfig.useMocks) return createMockJob(input);
  return requestJson<JobCreateResponse>('/v1/jobs', {
    method: 'POST',
    body: JSON.stringify(input),
    // Con sesion de cliente, el job queda ligado a su saldo en el portal.
    ...(sessionToken ? { headers: { authorization: `Bearer ${sessionToken}` } } : {}),
  });
}

export async function getJob(id: string): Promise<JobMetadataDTO> {
  if (webConfig.useMocks) {
    const job = getMockJob(id);
    if (!job) throw new MarketplaceApiError('JOB_NOT_FOUND', 'Job not found.', 404);
    return job;
  }
  const result = await requestJson<{ job: JobMetadataDTO }>(`/v1/jobs/${id}`);
  return result.job;
}

export async function getJobs(filters: { status?: JobStatus; providerId?: string } = {}): Promise<JobMetadataDTO[]> {
  if (webConfig.useMocks) {
    return getMockJobs().filter(
      (job) =>
        (!filters.status || job.status === filters.status) &&
        (!filters.providerId || job.providerId === filters.providerId),
    );
  }
  const query = new URLSearchParams();
  if (filters.status) query.set('status', filters.status);
  if (filters.providerId) query.set('providerId', filters.providerId);
  const suffix = query.size ? `?${query.toString()}` : '';
  const result = await requestJson<{ jobs: JobMetadataDTO[] }>(`/v1/jobs${suffix}`);
  return result.jobs;
}

export async function cancelJob(id: string, executionToken: string): Promise<JobMetadataDTO> {
  const result = await requestJson<{ job: JobMetadataDTO }>(
    `/v1/jobs/${encodeURIComponent(id)}/progress`,
    {
      method: 'PATCH',
      headers: { 'x-execution-token': executionToken },
      body: JSON.stringify({ status: 'CANCELLED' }),
    },
  );
  return result.job;
}

export async function settleJob(id: string): Promise<JobMetadataDTO> {
  if (webConfig.useMocks) return settleMockJob(id);
  const result = await requestJson<{ job: JobMetadataDTO }>(`/v1/jobs/${id}/settle`, {
    method: 'POST',
  });
  return result.job;
}

export async function getStats(): Promise<MarketplaceStats> {
  if (webConfig.useMocks) return getMockStats();
  return requestJson<MarketplaceStats>('/v1/stats');
}
