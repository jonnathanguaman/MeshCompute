import { randomUUID } from 'node:crypto';

const baseUrl = (process.env.MARKETPLACE_API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');

async function jsonRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json()) as T;
  if (!response.ok) {
    const errorBody = body as { code?: string; message?: string };
    throw new Error(
      `${init.method ?? 'GET'} ${path} failed (${response.status} ${errorBody.code ?? 'UNKNOWN'}): ${errorBody.message ?? 'Unknown error'}`,
    );
  }
  return { status: response.status, body };
}

async function main(): Promise<void> {
  const suffix = randomUUID();
  const health = await jsonRequest<{
    status: string;
    database: string;
  }>('/health');

  const registration = await jsonRequest<{
    provider: { id: string; status: string };
    providerToken: string;
  }>('/v1/providers/register', {
    method: 'POST',
    body: JSON.stringify({
      name: `Core-Smoke-${suffix.slice(0, 8)}`,
      qvacPublicKey: `qvac-smoke-${suffix}`,
      walletAddress: `0x${'0'.repeat(8)}${suffix.replaceAll('-', '').slice(0, 32)}`,
      modelKey: 'demo-llm',
      modelLabel: 'Core Smoke Model',
      hardwareLabel: 'Core Smoke Fixture',
      pricePer1kTokensAtomic: '2000',
      pricingMode: 'PER_JOB',
    }),
  });

  await jsonRequest(`/v1/providers/${registration.body.provider.id}/heartbeat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${registration.body.providerToken}` },
  });

  const created = await jsonRequest<{
    jobId: string;
    executionToken: string;
    status: string;
    quotedAmountAtomic: string;
  }>('/v1/jobs', {
    method: 'POST',
    body: JSON.stringify({
      providerId: registration.body.provider.id,
      modelKey: 'demo-llm',
      promptHash: 'a'.repeat(64),
    }),
  });

  for (const payload of [
    { status: 'CONNECTING' },
    { status: 'RUNNING' },
    { status: 'VERIFYING', outputHash: 'b'.repeat(64), durationMs: 1 },
    { status: 'VERIFIED' },
  ]) {
    await jsonRequest(`/v1/jobs/${created.body.jobId}/progress`, {
      method: 'PATCH',
      headers: { 'x-execution-token': created.body.executionToken },
      body: JSON.stringify(payload),
    });
  }

  const final = await jsonRequest<{
    job: { status: string; verificationStatus: string; outputHash?: string };
  }>(`/v1/jobs/${created.body.jobId}`);

  if (
    health.body.status !== 'ok' ||
    health.body.database !== 'ready' ||
    registration.body.provider.status !== 'ONLINE' ||
    created.body.status !== 'ASSIGNED' ||
    final.body.job.status !== 'VERIFIED' ||
    final.body.job.verificationStatus !== 'PASSED' ||
    final.body.job.outputHash?.length !== 64
  ) {
    throw new Error('Smoke flow completed with an unexpected state.');
  }

  // Tokens are intentionally never printed.
  process.stdout.write(
    [
      'MeshCompute Backend Core smoke: PASSED',
      `API: ${baseUrl}`,
      `Provider: ${registration.body.provider.status}`,
      `Job: ${created.body.status} -> ${final.body.job.status}`,
      `Verification: ${final.body.job.verificationStatus}`,
      `Quote: ${created.body.quotedAmountAtomic}`,
    ].join('\n') + '\n',
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown smoke-test error';
  process.stderr.write(`MeshCompute Backend Core smoke: FAILED\n${message}\n`);
  process.exitCode = 1;
});
