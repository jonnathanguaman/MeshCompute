/**
 * Traduccion `modelKey` (contrato MeshCompute) -> modelo real.
 *
 * El resto del monorepo habla de `demo-llm` / `tooluse-llm`; solo este archivo
 * conoce las constantes de QVAC y las rutas de Ollama. Cambiar de modelo es
 * cambiar esta tabla.
 *
 * Dos origenes posibles:
 *   - `registry`: descriptor del registry de QVAC (se descarga la primera vez);
 *   - `ollama`:   GGUF ya presente en `~/.ollama/models` (sin descarga).
 *
 * Doc 00 §25: empezar por el modelo pequeno para el spike P2P y usar el de
 * tool-use para Track 2. No subir de modelo hasta tener el benchmark estable.
 */

import type { LoadModelOptions } from '@qvac/sdk';
import { LLAMA_3_2_1B_INST_Q4_0, QWEN3_1_7B_INST_Q4 } from '@qvac/sdk/models';
import { resolveOllamaModel } from './ollama-models.js';

export interface ModelEntry {
  /** Clave publica usada en los DTOs y en PROVIDER_MODEL_KEY. */
  key: string;
  /** Etiqueta legible para la UI y el README. */
  label: string;
  /** Contexto por defecto al cargar. */
  ctxSize: number;
  /**
   * Si el chat template del modelo contempla tools.
   *
   * NO es una preferencia: se comprueba en los metadatos del GGUF
   * (`tokenizer.chat_template`). Un modelo sin tools en su template no puede
   * participar en la cadena del Reliability Orchestrator, por bueno que sea.
   */
  supportsTools: boolean;
  quantization: string;
  /** Origen del peso: registry de QVAC o disco local via Ollama. */
  source: 'registry' | 'ollama';
  /** Referencia Ollama (`nombre:tag`), solo para source === 'ollama'. */
  ollamaRef?: string;
  /** Descriptor del registry, solo para source === 'registry'. */
  descriptor?: LoadModelOptions['modelSrc'];
  /** Arquitectura declarada en el GGUF; util para diagnosticar. */
  architecture?: string;
  notes?: string;
}

const REGISTRY: ModelEntry[] = [
  {
    key: 'demo-llm',
    label: 'Llama-3.2-1B-Instruct-Q4_0',
    ctxSize: 2048,
    supportsTools: false,
    quantization: 'q4_0',
    source: 'registry',
    descriptor: LLAMA_3_2_1B_INST_Q4_0,
    notes: 'Modelo minimo para el spike P2P: conectividad antes que calidad.',
  },
  {
    key: 'tooluse-llm',
    label: 'Qwen3-1.7B-Instruct-Q4',
    ctxSize: 4096,
    supportsTools: true,
    quantization: 'q4',
    source: 'registry',
    descriptor: QWEN3_1_7B_INST_Q4,
    notes: 'Modelo de tool calling del ejemplo oficial de QVAC.',
  },
  {
    key: 'local-tooluse-llm',
    label: 'Qwen3.5-4B (Ollama, local)',
    ctxSize: 4096,
    supportsTools: true,
    quantization: 'q4_k_m',
    source: 'ollama',
    ollamaRef: 'qwen3.5:4b',
    architecture: 'qwen35',
    notes:
      'Ya descargado en disco. Su chat template SI declara tools y role:tool, ' +
      'y el SDK trae toolDialect "qwen35" para esta familia.',
  },
  {
    key: 'local-vision-llm',
    label: 'Qwen2.5-VL-3B (Ollama, local)',
    ctxSize: 4096,
    // Verificado leyendo tokenizer.chat_template del GGUF: solo system/user/
    // assistant. Sin role:tool ni tool_calls.
    supportsTools: false,
    quantization: 'q4_k_m',
    source: 'ollama',
    ollamaRef: 'qwen2.5vl:3b',
    architecture: 'qwen25vl',
    notes:
      'Multimodal. NO sirve para el Reliability Orchestrator: su chat template ' +
      'no contempla tool calling. Usarlo para Track 2 dejaria la cadena vacia.',
  },
];

const BY_KEY = new Map(REGISTRY.map((entry) => [entry.key, entry]));

export function resolveModel(modelKey: string): ModelEntry {
  const entry = BY_KEY.get(modelKey);
  if (!entry) {
    const known = [...BY_KEY.keys()].join(', ');
    throw new Error(`Unknown modelKey "${modelKey}". Known keys: ${known}`);
  }
  return entry;
}

export function listModels(): readonly ModelEntry[] {
  return REGISTRY;
}

/**
 * Construye la parte de `loadModel` que describe de donde sale el modelo.
 *
 * Para Ollama hay que pasar `modelType` explicito: los blobs se llaman
 * `sha256-<hex>` sin extension y QVAC no puede inferir el engine del nombre.
 */
export function buildModelSource(entry: ModelEntry): {
  modelSrc: LoadModelOptions['modelSrc'];
  modelType?: string;
  projectionModelSrc?: string;
} {
  if (entry.source === 'registry') {
    if (!entry.descriptor) {
      throw new Error(`Model "${entry.key}" is marked as registry but has no descriptor.`);
    }
    return { modelSrc: entry.descriptor };
  }

  if (!entry.ollamaRef) {
    throw new Error(`Model "${entry.key}" is marked as ollama but has no ollamaRef.`);
  }

  const files = resolveOllamaModel(entry.ollamaRef);
  const source: {
    modelSrc: LoadModelOptions['modelSrc'];
    modelType?: string;
    projectionModelSrc?: string;
  } = {
    modelSrc: files.modelPath as unknown as LoadModelOptions['modelSrc'],
    modelType: 'llamacpp-completion',
  };
  if (files.projectionPath) source.projectionModelSrc = files.projectionPath;
  return source;
}

/**
 * Falla ruidosamente si se pide tool calling a un modelo cuyo template no lo
 * soporta.
 *
 * Sin esta comprobacion el sintoma seria un benchmark con 0 tool calls y
 * refusals por todas partes, que es facil de confundir con un bug del
 * orchestrator. Doc 01 §37: si un modelo no sirve para tool use, hay que
 * registrarlo, no silenciarlo.
 */
export function assertToolCapable(entry: ModelEntry): void {
  if (entry.supportsTools) return;
  throw new Error(
    `Model "${entry.key}" (${entry.label}) cannot do tool calling: its chat template ` +
      `declares no tools and no role:tool.\n` +
      (entry.notes ? `  ${entry.notes}\n` : '') +
      `  Pick a tool-capable model: ` +
      `${REGISTRY.filter((m) => m.supportsTools).map((m) => m.key).join(', ')}`,
  );
}
