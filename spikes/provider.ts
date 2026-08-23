/**
 * Spike A1 — lado provider. Doc 01 §4.
 *
 * Arranca QVAC como provider y publica su public key. Sin marketplace, sin
 * HTTP, sin nada mas: si esto no funciona entre dos maquinas, no tiene sentido
 * construir abstracciones encima.
 *
 *   MAQUINA 1:  pnpm spike:provider
 *   MAQUINA 2:  pnpm spike:consumer --key <la public key impresa aqui>
 *
 * Opcional: exportar QVAC_HYPERSWARM_SEED para que la key sea estable entre
 * reinicios y no haya que recopiarla en cada prueba.
 */

import { ensureEnvLoaded } from '@meshcompute/config';
import { startQVACProvider, stopQVACProvider } from '@qvac/sdk';
import { loadModel } from '@qvac/sdk';
import { LLAMA_3_2_1B_INST_Q4_0 } from '@qvac/sdk/models';

// GGML_DISABLE_VULKAN (ver .env) debe estar en process.env antes de que el
// primer loadModel spawnee el worker Bare.
ensureEnvLoaded();

const WARMUP = process.argv.includes('--warmup');

async function main(): Promise<void> {
  console.log('starting QVAC provider...');

  const response = await startQVACProvider();

  // El SDK puede devolver success:false SIN lanzar. Comprobarlo es obligatorio.
  if (!response.success || !response.publicKey) {
    console.error(`FAILED: ${response.error ?? 'unknown error'}`);
    process.exit(1);
  }

  console.log('');
  console.log('  QVAC provider started');
  console.log(`  Public key: ${response.publicKey}`);
  console.log('');
  console.log('  Copy that key to machine 2 and run:');
  console.log(`    pnpm spike:consumer --key ${response.publicKey}`);
  console.log('');

  if (WARMUP) {
    // Precarga el modelo para que la primera peticion delegada no dispare la
    // descarga del GGUF (737 MB) mientras el consumer espera.
    console.log('warming up model (first run downloads ~737 MB)...');
    const started = Date.now();
    await loadModel({
      modelSrc: LLAMA_3_2_1B_INST_Q4_0,
      modelConfig: { ctx_size: 2048 },
      onProgress: (progress: { percentage?: number }) => {
        if (progress.percentage !== undefined) {
          process.stdout.write(`\r  download: ${progress.percentage.toFixed(0)}%   `);
        }
      },
    } as unknown as Parameters<typeof loadModel>[0]);
    console.log(`\n  model ready in ${Date.now() - started} ms`);
  }

  console.log('waiting for delegated inference. Ctrl+C to stop.');
}

async function shutdown(): Promise<void> {
  console.log('\nstopping provider...');
  try {
    await stopQVACProvider();
  } catch {
    // idempotente por contrato del SDK
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await main();
setInterval(() => undefined, 1 << 30);
