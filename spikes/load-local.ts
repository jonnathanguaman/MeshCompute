/**
 * Verifica que QVAC puede cargar un GGUF de Ollama y generar.
 *
 *   pnpm tsx spikes/load-local.ts [modelKey]
 *
 * Los blobs de Ollama no tienen extension, asi que se pasa `modelType`
 * explicito. Si la arquitectura del GGUF no la soporta el llama.cpp embebido
 * en QVAC, el fallo aparece aqui y no en mitad de la demo.
 */
import { ensureEnvLoaded } from '@meshcompute/config';
import { completion, loadModel, unloadModel } from '@qvac/sdk';
import { buildModelSource, resolveModel } from '@meshcompute/qvac-adapter';

// Antes del primer loadModel: el worker Bare hereda process.env al spawnearse
// y GGML_DISABLE_VULKAN (ver .env) tiene que estar puesta antes de ese spawn.
ensureEnvLoaded();

const key = process.argv[2] ?? 'local-tooluse-llm';
const entry = resolveModel(key);
const source = buildModelSource(entry);

console.log(`model      : ${entry.key} — ${entry.label}`);
console.log(`arch       : ${entry.architecture ?? 'n/a'}`);
console.log(`tools      : ${entry.supportsTools ? 'SI' : 'NO'}`);
console.log(`src        : ${String(source.modelSrc).slice(0, 90)}`);
console.log(`modelType  : ${source.modelType ?? '(inferido)'}`);

// Un loadModel que no responde es indistinguible de uno lento si no se acota.
// Causa conocida en maquinas con iGPU AMD: el backend Vulkan del addon se
// cuelga al inicializar (100% de un core, RAM congelada). GGML_DISABLE_VULKAN=1
// en el .env lo evita; ver docs/qvac-findings.md.
const LOAD_TIMEOUT_MS = Number(process.env['LOAD_TIMEOUT_MS'] ?? 300_000);

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_r, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `${what} did not finish in ${ms} ms. ` +
                'Known cause on AMD iGPU machines: the Vulkan backend hangs during ' +
                'init (one core at 100%, RAM frozen). Set GGML_DISABLE_VULKAN=1 in ' +
                'the .env to force CPU. See docs/qvac-findings.md.',
            ),
          ),
        ms,
      ),
    ),
  ]);
}

const t0 = Date.now();
const modelId = await withTimeout(loadModel({
  modelSrc: source.modelSrc,
  ...(source.modelType ? { modelType: source.modelType } : {}),
  modelConfig: {
    // El KV cache crece con el contexto y se suma al peso del modelo. En una
    // maquina sin GPU y con poca RAM libre, un ctx grande es la diferencia
    // entre cargar y que el worker muera.  CTX_SIZE=1024 para descartarlo.
    ctx_size: Number(process.env['CTX_SIZE'] ?? entry.ctxSize),
    ...(entry.supportsTools ? { tools: true } : {}),
    ...(source.projectionModelSrc ? { projectionModelSrc: source.projectionModelSrc } : {}),
  },
} as unknown as Parameters<typeof loadModel>[0]), LOAD_TIMEOUT_MS, 'loadModel');
console.log(`\nloaded in ${Date.now() - t0} ms (modelId=${modelId})`);

const t1 = Date.now();
const run = completion({
  modelId,
  history: [{ role: 'user', content: 'Return JSON only: {"answer": number}. Calculate 1947 * 82.' }],
  stream: true,
  generationParams: { temp: 0, seed: 42, reasoning_budget: 0 },
} as unknown as Parameters<typeof completion>[0]);

for await (const e of run.events) {
  if (e.type === 'contentDelta') process.stdout.write(e.text);
}
const final = await run.final;
console.log(`\n\ncontent   : ${final.contentText.slice(0, 200)}`);
// `stats` se expone en los .d.ts como el schema Zod, no como el tipo inferido,
// asi que se estrecha una sola vez a lo que realmente llega en runtime.
const stats = final.stats as
  | { promptTokens?: number; generatedTokens?: number; backendDevice?: 'cpu' | 'gpu' }
  | undefined;
console.log(`tokens    : in=${stats?.promptTokens ?? '?'} out=${stats?.generatedTokens ?? '?'}`);
console.log(`device    : ${stats?.backendDevice ?? '?'}`);
console.log(`inference : ${Date.now() - t1} ms`);

await unloadModel({ modelId });
process.exit(0);
