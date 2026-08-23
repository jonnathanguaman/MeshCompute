import { randomUUID } from 'node:crypto';

const baseUrl = (process.env.MARKETPLACE_API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const recipient = process.env.PAYMENT_TEST_RECIPIENT;

async function jsonRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json()) as T;
  if (!response.ok) {
    const error = body as { code?: string; message?: string; details?: { reasonCode?: string } };
    throw new Error(
      `${init.method ?? 'GET'} ${path} failed (${response.status} ${error.code ?? 'UNKNOWN'}${error.details?.reasonCode ? `/${error.details.reasonCode}` : ''}): ${error.message ?? 'Unknown error'}`,
    );
  }
  return body;
}

async function main(): Promise<void> {
  if (process.env.CONFIRM_TESTNET_TRANSFER !== 'YES') {
    throw new Error('Set CONFIRM_TESTNET_TRANSFER=YES to acknowledge one demo-token transfer.');
  }
  if (!recipient || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    throw new Error('PAYMENT_TEST_RECIPIENT must be a valid demo-only EVM testnet address.');
  }

  const suffix = randomUUID();
  const registration = await jsonRequest<{
    provider: { id: string };
  }>('/v1/providers/register', {
    method: 'POST',
    body: JSON.stringify({
      name: `Payment-Smoke-${suffix.slice(0, 8)}`,
      qvacPublicKey: `qvac-payment-smoke-${suffix}`,
      walletAddress: recipient,
      modelKey: 'demo-llm',
      modelLabel: 'Payment Smoke Model',
      hardwareLabel: 'Payment Smoke Fixture',
      pricePer1kTokensAtomic: '2000',
      pricingMode: 'PER_JOB',
    }),
  });
  const created = await jsonRequest<{ jobId: string; executionToken: string }>('/v1/jobs', {
    method: 'POST',
    body: JSON.stringify({
      providerId: registration.provider.id,
      modelKey: 'demo-llm',
      promptHash: 'a'.repeat(64),
    }),
  });

  for (const payload of [
    { status: 'CONNECTING' },
    { status: 'RUNNING' },
    { status: 'VERIFYING' },
    {
      status: 'VERIFIED',
      outputHash: 'b'.repeat(64),
      verificationStatus: 'PASSED',
    },
  ]) {
    await jsonRequest(`/v1/jobs/${created.jobId}/progress`, {
      method: 'PATCH',
      headers: { 'x-execution-token': created.executionToken },
      body: JSON.stringify(payload),
    });
  }

  const settlement = await jsonRequest<{
    job: {
      id: string;
      status: string;
      paymentMode?: string;
      paymentTxHash?: string;
      settledAmountAtomic?: string;
    };
  }>(`/v1/jobs/${created.jobId}/settle`, { method: 'POST' });
  if (
    settlement.job.status !== 'PAID' ||
    settlement.job.paymentMode !== 'WDK_TESTNET' ||
    !settlement.job.paymentTxHash
  ) {
    throw new Error('The API did not return a WDK_TESTNET payment result.');
  }

  // Wallet seeds and scoped API tokens are intentionally never printed.
  process.stdout.write(
    [
      'MeshCompute WDK testnet payment smoke: PASSED',
      `API: ${baseUrl}`,
      `Job: ${settlement.job.id}`,
      `Mode: ${settlement.job.paymentMode}`,
      `Amount (atomic): ${settlement.job.settledAmountAtomic ?? 'unknown'}`,
      `Transaction: ${settlement.job.paymentTxHash}`,
      'Verify the transaction hash in the explorer for the configured testnet.',
    ].join('\n') + '\n',
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown payment smoke-test error';
  process.stderr.write(`MeshCompute WDK testnet payment smoke: FAILED\n${message}\n`);
  process.exitCode = 1;
});
