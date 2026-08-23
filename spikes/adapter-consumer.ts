import { QvacConsumer } from '@meshcompute/qvac-adapter';

const argv = process.argv.slice(2);
const keyIndex = argv.indexOf('--key');
const providerPublicKey = keyIndex >= 0 ? argv[keyIndex + 1] : undefined;

if (!providerPublicKey || !/^[0-9a-fA-F]{64}$/.test(providerPublicKey)) {
  console.error('usage: tsx spikes/adapter-consumer.ts --key <providerPublicKey>');
  process.exit(1);
}

const consumer = new QvacConsumer();

try {
  const connectedAt = Date.now();
  const session = await consumer.openSession({
    providerPublicKey,
    modelKey: 'demo-llm',
    timeoutMs: 120_000,
    fallbackToLocal: false,
    enableTools: false,
  });
  console.log(`adapter connected in ${Date.now() - connectedAt} ms (${session.modelId})`);

  const result = await session.complete({
    history: [{ role: 'user', content: 'Return JSON only: {"adapter":true}' }],
    generation: { temperature: 0, seed: 42 },
    timeoutMs: 120_000,
  });
  console.log(result.content);
} catch (error) {
  console.error(error);
  if (error instanceof Error && error.cause) console.error('cause:', error.cause);
  process.exitCode = 1;
} finally {
  await consumer.closeAll();
}
