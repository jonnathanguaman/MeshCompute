/**
 * A0 — Diagnostico del entorno QVAC. Doc 01 §4 / doc 00 §39.
 *
 * El SDK 0.17.1 NO expone un binario `qvac doctor`; el equivalente
 * programatico es `getSystemResources()`, que arranca el worker Bare y
 * consulta CPU/GPU/backends reales.
 *
 * Ejecutar ANTES de implementar nada que dependa de QVAC. Guardar la salida
 * para el README (doc 01 §40: hardware, modelo, latencia).
 *
 *   pnpm qvac:doctor
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getSystemResources } from '@qvac/sdk';
import { LLAMA_3_2_1B_INST_Q4_0, QWEN3_1_7B_INST_Q4 } from '@qvac/sdk/models';

const GB = 1024 ** 3;

/** El SDK envuelve cada dato en { status, value }. Desenvuelve sin romper. */
function unwrap(node: unknown): unknown {
  if (node && typeof node === 'object' && 'value' in node) {
    return unwrap((node as { value: unknown }).value);
  }
  return node;
}

function pick(root: unknown, dottedPath: string): unknown {
  let current: unknown = unwrap(root);
  for (const key of dottedPath.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = unwrap((current as Record<string, unknown>)[key]);
  }
  return current;
}

async function main(): Promise<void> {
  let failed = false;

  console.log('=== host ===');
  console.log(`  platform    : ${os.platform()} ${os.release()} (${os.arch()})`);
  console.log(`  node        : ${process.version}`);
  console.log(`  cpu         : ${os.cpus().length}x ${os.cpus()[0]?.model.trim() ?? 'unknown'}`);
  console.log(`  total ram   : ${(os.totalmem() / GB).toFixed(1)} GB`);
  console.log(`  free ram    : ${(os.freemem() / GB).toFixed(1)} GB`);

  const [major = '0', minor = '0'] = process.versions.node.split('.');
  const nodeOk = Number(major) > 22 || (Number(major) === 22 && Number(minor) >= 17);
  console.log(`  node>=22.17 : ${nodeOk ? 'OK' : 'FAIL — el SDK QVAC exige >=22.17'}`);
  if (!nodeOk) failed = true;

  console.log('\n=== modelos de demo (doc 00 §25) ===');
  for (const descriptor of [LLAMA_3_2_1B_INST_Q4_0, QWEN3_1_7B_INST_Q4]) {
    const d = descriptor as unknown as Record<string, unknown>;
    const sizeMb = Number(d['expectedSize']) / 1024 / 1024;
    console.log(
      `  ${String(d['name']).padEnd(24)} engine=${String(d['engine'])} ` +
        `quant=${String(d['quantization'])} size=${sizeMb.toFixed(0)}MB`,
    );
  }

  console.log('\n=== qvac runtime ===');
  console.log('  NOTA: el primer arranque del worker Bare puede exceder el timeout');
  console.log('  de 30s (extrae prebuilds nativos). Si falla, reintentar una vez.');

  const startedAt = Date.now();
  try {
    const resources = await getSystemResources();
    const bootMs = Date.now() - startedAt;
    console.log(`  worker boot : ${bootMs} ms  OK`);

    // La clave es `gpus` (plural). Buscar `gpu` devuelve undefined y hace
    // reportar 0 dispositivos aunque QVAC los haya detectado todos.
    const gpus = pick(resources, 'capabilities.gpus');
    const gpuList = Array.isArray(gpus) ? gpus : [];

    console.log(`  gpu devices : ${gpuList.length}`);
    for (const [index, entry] of gpuList.entries()) {
      const device = unwrap(entry) as Record<string, unknown> | undefined;
      if (!device) continue;
      console.log(`    [${index}] ${String(pick(device, 'name') ?? 'unknown')}`);

      const backends = pick(device, 'backends');
      if (backends && typeof backends === 'object') {
        const supported = Object.entries(backends as Record<string, unknown>)
          .filter(([, value]) => unwrap(value) === true)
          .map(([key]) => key);
        console.log(
          `         backends: ${supported.length > 0 ? supported.join(', ') : 'ninguno'}`,
        );
      }
    }
    if (gpuList.length === 0) {
      console.log('    (ninguna GPU detectada — la inferencia iria por CPU)');
    }

    const outDir = path.resolve('artifacts');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, 'qvac-doctor.json');
    fs.writeFileSync(
      outFile,
      JSON.stringify(
        {
          host: {
            platform: `${os.platform()} ${os.release()}`,
            arch: os.arch(),
            node: process.version,
            cpu: os.cpus()[0]?.model.trim(),
            logicalCores: os.cpus().length,
            totalRamGb: Number((os.totalmem() / GB).toFixed(1)),
          },
          workerBootMs: bootMs,
          resources,
        },
        null,
        2,
      ),
    );
    console.log(`\n  full report -> ${outFile}`);
  } catch (error) {
    failed = true;
    console.error(`  FAILED after ${Date.now() - startedAt} ms:`, error instanceof Error ? error.message : error);
    console.error('  El runtime QVAC no arranco. Reintentar; si persiste, revisar');
    console.error('  drivers/Vulkan y que bare-runtime-<platform> este instalado.');
  }

  console.log(`\n=== resultado: ${failed ? 'FAIL' : 'OK'} ===`);
  process.exit(failed ? 1 : 0);
}

await main();
