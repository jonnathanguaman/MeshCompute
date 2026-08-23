import type {
  JobCreateRequest,
  JobCreateResponse,
  JobMetadataDTO,
  JobStatus,
  ProviderPublicDTO,
  ReliabilitySummary,
} from '@meshcompute/contracts';
import type { BenchmarkResult, MarketplaceStats } from '@/lib/types';

const now = '2026-08-22T16:00:00.000Z';

export const mockProviders: ProviderPublicDTO[] = [
  {
    id: 'p_demo_01',
    name: 'Andes GPU Node',
    qvacPublicKey: 'qvac-demo-public-key-andes-0001',
    walletAddress: '0x00000000000000000000000000000000000000e1',
    modelKey: 'demo-llm',
    modelLabel: 'Qwen3 1.7B Q4',
    hardwareLabel: 'RTX 4070 · 12 GB',
    pricePer1kTokensAtomic: '2000',
    pricingMode: 'PER_JOB',
    tokenSymbol: 'mUSDT',
    status: 'ONLINE',
    reputation: 97,
    jobsCompleted: 31,
    jobsFailed: 1,
    lastSeen: now,
  },
  {
    id: 'p_demo_02',
    name: 'Pacific Compute',
    qvacPublicKey: 'qvac-demo-public-key-pacific-0002',
    walletAddress: '0x00000000000000000000000000000000000000e2',
    modelKey: 'demo-llm',
    modelLabel: 'Llama 3.2 1B Q4',
    hardwareLabel: 'RTX 3060 · 12 GB',
    pricePer1kTokensAtomic: '1500',
    pricingMode: 'PER_JOB',
    tokenSymbol: 'mUSDT',
    status: 'ONLINE',
    reputation: 94,
    jobsCompleted: 18,
    jobsFailed: 2,
    lastSeen: now,
  },
  {
    id: 'p_demo_03',
    name: 'Quito Lab Offline',
    qvacPublicKey: 'qvac-demo-public-key-quito-0003',
    walletAddress: '0x00000000000000000000000000000000000000e3',
    modelKey: 'demo-llm',
    modelLabel: 'Qwen3 1.7B Q4',
    hardwareLabel: 'RTX 4060 · 8 GB',
    pricePer1kTokensAtomic: '1800',
    pricingMode: 'PER_JOB',
    tokenSymbol: 'mUSDT',
    status: 'OFFLINE',
    reputation: 91,
    jobsCompleted: 12,
    jobsFailed: 3,
    lastSeen: '2026-08-22T15:40:00.000Z',
  },
];

const initialJobs: JobMetadataDTO[] = [
  {
    id: 'job_demo_running',
    providerId: 'p_demo_02',
    modelKey: 'demo-llm',
    promptHash: '1'.repeat(64),
    quotedAmountAtomic: '1500',
    status: 'RUNNING',
    verificationStatus: 'NOT_REQUESTED',
    paymentStatus: 'NOT_STARTED',
    inputTokens: 48,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
  },
  {
    id: 'job_demo_verified',
    providerId: 'p_demo_01',
    modelKey: 'demo-llm',
    promptHash: '2'.repeat(64),
    outputHash: '3'.repeat(64),
    quotedAmountAtomic: '2000',
    status: 'VERIFIED',
    verificationStatus: 'PASSED',
    paymentStatus: 'NOT_STARTED',
    inputTokens: 72,
    outputTokens: 116,
    durationMs: 2240,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
  },
  {
    id: 'job_demo_paid',
    providerId: 'p_demo_01',
    modelKey: 'demo-llm',
    promptHash: '4'.repeat(64),
    outputHash: '5'.repeat(64),
    quotedAmountAtomic: '2000',
    settledAmountAtomic: '2000',
    status: 'PAID',
    verificationStatus: 'PASSED',
    paymentStatus: 'PAID',
    paymentMode: 'SIMULATED',
    paymentTxHash: 'sim_job_demo_paid',
    inputTokens: 41,
    outputTokens: 88,
    durationMs: 1810,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: now,
  },
];

const jobs = new Map(initialJobs.map((job) => [job.id, job]));

export const mockReliability: ReliabilitySummary = {
  status: 'PASSED',
  requiredTools: 3,
  successfulTools: 3,
  failedTools: 0,
  retries: 0,
  schemaPassed: true,
  groundingPassed: true,
  trace: [
    {
      turn: 1,
      toolName: 'get_provider_status',
      argsValid: true,
      executionStatus: 'SUCCESS',
      durationMs: 18,
      retryCount: 0,
    },
    {
      turn: 2,
      toolName: 'get_job_metadata',
      argsValid: true,
      executionStatus: 'SUCCESS',
      durationMs: 13,
      retryCount: 0,
    },
    {
      turn: 3,
      toolName: 'calculate_expected_cost',
      argsValid: true,
      executionStatus: 'SUCCESS',
      durationMs: 2,
      retryCount: 0,
    },
  ],
};

export const mockBenchmark: BenchmarkResult = {
  status: 'READY',
  mock: true,
  model: 'Qwen3 1.7B',
  quantization: 'Q4',
  datasetVersion: 'preview-v1',
  baseline: {
    runs: 20,
    taskSuccessRate: 55,
    validArgumentRate: 68,
    groundedAnswerRate: 52,
    correctRefusalRate: 40,
    hallucinatedResultRate: 25,
    averageLatencyMs: 2120,
  },
  hardened: {
    runs: 20,
    taskSuccessRate: 85,
    validArgumentRate: 95,
    groundedAnswerRate: 90,
    correctRefusalRate: 90,
    hallucinatedResultRate: 5,
    averageLatencyMs: 2510,
  },
  failures: { WRONG_TOOL: 1, INVALID_ARGS: 1, TOOL_TIMEOUT: 1, GROUNDING_MISMATCH: 1 },
  generatedAt: now,
};

export function getMockProviders(): ProviderPublicDTO[] {
  return mockProviders.map((provider) => ({ ...provider }));
}

export function getMockProvider(id: string): ProviderPublicDTO | undefined {
  const provider = mockProviders.find((candidate) => candidate.id === id);
  return provider ? { ...provider } : undefined;
}

export function getMockJobs(): JobMetadataDTO[] {
  return Array.from(jobs.values(), (job) => ({ ...job }));
}

export function getMockJob(id: string): JobMetadataDTO | undefined {
  const job = jobs.get(id);
  return job ? { ...job } : undefined;
}

export function createMockJob(input: JobCreateRequest): JobCreateResponse {
  const provider = getMockProvider(input.providerId);
  if (!provider) throw new Error('PROVIDER_NOT_FOUND');
  const id = `job_mock_${Date.now()}`;
  const createdAt = new Date().toISOString();
  jobs.set(id, {
    id,
    providerId: provider.id,
    ...(input.verifierProviderId ? { verifierProviderId: input.verifierProviderId } : {}),
    modelKey: input.modelKey,
    promptHash: input.promptHash,
    quotedAmountAtomic: provider.pricePer1kTokensAtomic,
    status: 'ASSIGNED',
    verificationStatus: 'NOT_REQUESTED',
    paymentStatus: 'NOT_STARTED',
    createdAt,
    updatedAt: createdAt,
  });
  return {
    jobId: id,
    executionToken: `mock_execution_${id}`,
    provider,
    status: 'ASSIGNED',
    quotedAmountAtomic: provider.pricePer1kTokensAtomic,
  };
}

export function patchMockJob(id: string, patch: Partial<JobMetadataDTO>): JobMetadataDTO {
  const current = jobs.get(id);
  if (!current) throw new Error('JOB_NOT_FOUND');
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  jobs.set(id, next);
  return { ...next };
}

export function settleMockJob(id: string): JobMetadataDTO {
  const current = jobs.get(id);
  if (!current) throw new Error('JOB_NOT_FOUND');
  return patchMockJob(id, {
    status: 'PAID',
    paymentStatus: 'PAID',
    paymentMode: 'SIMULATED',
    paymentTxHash: `sim_${id}`,
    settledAmountAtomic: current.quotedAmountAtomic,
    completedAt: new Date().toISOString(),
  });
}

export function getMockStats(): MarketplaceStats {
  const allJobs = getMockJobs();
  const verified = allJobs.filter((job) => ['VERIFIED', 'PAYMENT_PENDING', 'PAID'].includes(job.status));
  const paid = allJobs.filter((job) => job.paymentStatus === 'PAID');
  const totalPaidAtomic = paid
    .reduce((total, job) => total + BigInt(job.settledAmountAtomic ?? '0'), 0n)
    .toString();
  return {
    providersOnline: mockProviders.filter((provider) => provider.status === 'ONLINE').length,
    jobsTotal: allJobs.length,
    jobsVerified: verified.length,
    successRate: allJobs.length ? Number(((verified.length / allJobs.length) * 100).toFixed(1)) : 0,
    totalPaidAtomic,
  };
}

export function advanceMockJob(id: string, status: JobStatus): JobMetadataDTO {
  return patchMockJob(id, { status });
}
