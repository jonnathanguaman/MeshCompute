import type { JobCreateRequest } from '@meshcompute/contracts';
import { describe, expect, it, vi } from 'vitest';
import { runInference } from '@/lib/consumer-agent';
import { createJob } from '@/lib/marketplace-api';

describe('privacy boundary', () => {
  it('sends only safe metadata to the central marketplace API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jobId: 'job_01',
        executionToken: 'token_01',
        provider: {},
        status: 'ASSIGNED',
        quotedAmountAtomic: '2000',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const metadata: JobCreateRequest = {
      providerId: 'provider_01',
      modelKey: 'qwen3-1.7b-q4',
      promptHash: 'a'.repeat(64),
    };
    await createJob(metadata);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(url).toBe('http://127.0.0.1:4000/v1/jobs');
    expect(sentBody).toEqual(metadata);
    expect(sentBody).not.toHaveProperty('prompt');
  });

  it('sends workload content only to the local Consumer Agent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jobId: 'job_01',
        content: 'verified output',
        outputHash: 'b'.repeat(64),
        stats: { durationMs: 25 },
        verification: { mode: 'LOCAL_SCHEMA', status: 'PASSED' },
        reliability: {
          status: 'PASSED',
          successfulTools: 1,
          failedTools: 0,
          retries: 0,
          schemaPassed: true,
          groundingPassed: true,
          trace: [],
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await runInference({
      jobId: 'job_01',
      executionToken: 'token_01',
      provider: {
        id: 'provider_01',
        qvacPublicKey: 'qvac-public-key',
        modelKey: 'qwen3-1.7b-q4',
      },
      prompt: 'private workload content',
      verificationMode: 'LOCAL_SCHEMA',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:5050/v1/inference');
    expect(JSON.parse(String(init.body))).toMatchObject({
      prompt: 'private workload content',
      jobId: 'job_01',
    });
  });
});
