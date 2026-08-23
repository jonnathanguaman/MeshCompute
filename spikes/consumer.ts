/**
 * Spike A1 — lado consumer. Doc 01 §4.
 *
 * Criterio de exito: `Machine A -> Machine B -> output`.
 *
 *   pnpm spike:consumer --key <providerPublicKey>
 *
 * `fallbackToLocal: false` es deliberado (CA-005): si el provider remoto no
 * responde, esto DEBE fallar. Si se ejecutase en local, el spike diria "ok"
 * sin haber probado nada de P2P.
 */

import { ensureEnvLoaded } from '@meshcompute/config';
import { completion, loadModel, unloadModel } from '@qvac/sdk';
import { LLAMA_3_2_1B_INST_Q4_0 } from '@qvac/sdk/models';

// GGML_DISABLE_VULKAN (ver .env) debe estar en process.env antes de que el
// primer loadModel spawnee el worker Bare.
ensureEnvLoaded();

const argv = process.argv.slice(2);
const keyIndex = argv.indexOf('--key');
const providerPublicKey = keyIndex >= 0 ? argv[keyIndex + 1] : undefined;
const promptIndex = argv.indexOf('--prompt');
const prompt =
  promptIndex >= 0
    ? argv[promptIndex + 1]!
    : 'Return JSON only: {"answer": number}. Calculate 1947 * 82.';

if (!providerPublicKey) {
  console.error('usage: pnpm spike:consumer --key <providerPublicKey> [--prompt "..."]');
  process.exit(1);
}
if (!/^[0-9a-fA-F]{64}$/.test(providerPublicKey)) {
  // El SDK valida esto con Zod; comprobarlo antes da un mensaje util.
  console.error('ERROR: providerPublicKey must be a 64-character hex string.');
  process.exit(1);
}

async function main(): Promise<void> {
  console.log(`connecting to provider ${providerPublicKey!.slice(0, 16)}...`);
  console.log('(first connection bootstraps the DHT and can take 15-45 s)');

  const connectStart = Date.now();
  const modelId = await loadModel({
    modelSrc: LLAMA_3_2_1B_INST_Q4_0,
    modelConfig: { ctx_size: 2048 },
    delegate: {
      providerPublicKey: providerPublicKey!,
      timeout: 60_000,
      fallbackToLocal: false, // CA-005: la ejecucion tiene que ser remota
    },
  } as unknown as Parameters<typeof loadModel>[0]);

  const connectMs = Date.now() - connectStart;
  console.log(`connected in ${connectMs} ms (modelId=${modelId})`);

  const inferStart = Date.now();
  const run = completion({
    modelId,
    history: [{ role: 'user', content: prompt }],
    stream: true,
    generationParams: { temp: 0, seed: 42 },
  } as unknown as Parameters<typeof completion>[0]);

  for await (const event of run.events) {
    if (event.type === 'contentDelta') process.stdout.write(event.text);
  }

  const final = await run.final;
  const inferMs = Date.now() - inferStart;

  console.log('\n');
  console.log('=== result ===');
  console.log(`  content        : ${final.contentText}`);
  console.log(`  stopReason     : ${final.stopReason}`);
  console.log(`  promptTokens   : ${final.stats?.promptTokens ?? 'n/a'}`);
  console.log(`  generatedTokens: ${final.stats?.generatedTokens ?? 'n/a'}`);
  console.log(`  backendDevice  : ${final.stats?.backendDevice ?? 'n/a'}`);
  console.log(`  connect        : ${connectMs} ms`);
  console.log(`  inference      : ${inferMs} ms`);

  await unloadModel({ modelId });
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error('\nFAILED:', error instanceof Error ? error.message : error);
  console.error(
    '\nWith fallbackToLocal=false a failure here means the remote provider was not\n' +
      'reachable. Check that the provider is running and the public key is correct.',
  );
  process.exit(1);
}
