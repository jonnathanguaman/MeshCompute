/**
 * Diagnostico: por que loadModel nunca termina en esta maquina.
 * Activa el logging interno del SDK y del servidor para ver donde se atasca.
 */
import { ensureEnvLoaded } from '@meshcompute/config';
import { setGlobalLogLevel, setGlobalConsoleOutput } from '@qvac/sdk/logging';
setGlobalLogLevel('debug');
setGlobalConsoleOutput(true);

// Carga GGML_DISABLE_VULKAN del .env antes de spawnear el worker. Para
// reproducir el cuelgue de Vulkan a proposito: GGML_DISABLE_VULKAN=0.
ensureEnvLoaded();

const { loadModel, subscribeServerLogs } = await import('@qvac/sdk');
const { LLAMA_3_2_1B_INST_Q4_0 } = await import('@qvac/sdk/models');

try {
  await subscribeServerLogs((entry: unknown) => {
    console.log('[server]', typeof entry === 'string' ? entry : JSON.stringify(entry));
  });
  console.log('--- server logs subscribed ---');
} catch (e) {
  console.log('subscribeServerLogs failed:', (e as Error).message);
}

const t0 = Date.now();
const timer = setInterval(() => {
  console.log(`  ... ${Math.round((Date.now() - t0) / 1000)}s elapsed`);
}, 30_000);

try {
  const id = await loadModel({
    modelSrc: LLAMA_3_2_1B_INST_Q4_0,
    modelConfig: { ctx_size: 512, device: 'cpu', gpu_layers: 0 },
  } as unknown as Parameters<typeof loadModel>[0]);
  console.log(`LOADED in ${Date.now() - t0} ms: ${id}`);
} catch (e) {
  console.log(`FAILED after ${Date.now() - t0} ms:`, (e as Error).message);
} finally {
  clearInterval(timer);
}
process.exit(0);
