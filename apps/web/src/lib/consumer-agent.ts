import { webConfig } from './config';
import { sha256Hex } from './hashing';
import type { ConsumerHealth, LocalInferenceRequest, LocalInferenceResponse } from './types';
import { advanceMockJob, mockReliability, patchMockJob } from '@/mocks/demo-data';

export class ConsumerAgentError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ConsumerAgentError';
  }
}

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function getConsumerHealth(): Promise<ConsumerHealth> {
  if (webConfig.useMocks) return { status: 'ok', service: 'consumer-agent', qvacReady: true };
  try {
    const response = await fetch(`${webConfig.consumerAgentUrl}/health`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Health response was not successful.');
    return (await response.json()) as ConsumerHealth;
  } catch {
    throw new ConsumerAgentError(
      'CONSUMER_AGENT_UNAVAILABLE',
      'Local Consumer Agent is not running.',
    );
  }
}

export async function runInference(input: LocalInferenceRequest): Promise<LocalInferenceResponse> {
  if (webConfig.useMocks) {
    advanceMockJob(input.jobId, 'CONNECTING');
    await pause(250);
    advanceMockJob(input.jobId, 'RUNNING');
    await pause(500);
    const content = JSON.stringify(
      {
        providerStatus: 'ONLINE',
        expectedAmountAtomic: '2000',
        quoteConsistent: true,
        evidence: ['get_provider_status', 'get_job_metadata', 'calculate_expected_cost'],
      },
      null,
      2,
    );
    const outputHash = await sha256Hex(content);
    advanceMockJob(input.jobId, 'VERIFYING');
    await pause(250);
    patchMockJob(input.jobId, {
      status: 'VERIFIED',
      outputHash,
      verificationStatus: 'PASSED',
      inputTokens: 72,
      outputTokens: 116,
      durationMs: 1_240,
    });
    return {
      jobId: input.jobId,
      content,
      outputHash,
      stats: { inputTokens: 72, outputTokens: 116, durationMs: 1_240 },
      verification: { mode: input.verificationMode, status: 'PASSED' },
      reliability: mockReliability,
    };
  }

  try {
    const response = await fetch(`${webConfig.consumerAgentUrl}/v1/inference`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = (await response.json().catch(() => ({}))) as LocalInferenceResponse & {
      code?: string;
      message?: string;
    };
    if (!response.ok) {
      throw new ConsumerAgentError(
        body.code ?? 'INFERENCE_FAILED',
        body.message ?? 'Remote inference failed.',
      );
    }
    return body;
  } catch (error) {
    if (error instanceof ConsumerAgentError) throw error;
    throw new ConsumerAgentError('CONSUMER_AGENT_UNAVAILABLE', 'Local Consumer Agent is not running.');
  }
}
