/**
 * Resolucion de modelos ya descargados por Ollama.
 *
 * Motivacion: reutilizar los GGUF que la maquina ya tiene en disco en vez de
 * descargar otra vez desde el registry de QVAC. Un modelo de 3 GB por maquina
 * y por demo no es aceptable en un hackathon.
 *
 * Ollama NO guarda los modelos como `<nombre>.gguf`. Usa un layout tipo OCI:
 *
 *   ~/.ollama/models/
 *     manifests/registry.ollama.ai/library/<nombre>/<tag>   <- JSON con capas
 *     blobs/sha256-<hex>                                    <- contenido real
 *
 * La capa `application/vnd.ollama.image.model` es el GGUF. Los blobs no tienen
 * extension, asi que QVAC no puede inferir `modelType` del nombre y hay que
 * pasarlo explicito (`llamacpp-completion`).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MODEL_LAYER = 'application/vnd.ollama.image.model';
const PROJECTOR_LAYER = 'application/vnd.ollama.image.projector';

interface OllamaLayer {
  mediaType: string;
  digest: string;
  size: number;
}

interface OllamaManifest {
  layers: OllamaLayer[];
}

export interface OllamaModelFiles {
  /** Ruta absoluta al blob GGUF del modelo. */
  modelPath: string;
  /** Ruta al projector multimodal (mmproj), si el modelo lo trae. */
  projectionPath?: string;
  sizeBytes: number;
}

/** Raiz de Ollama. `OLLAMA_MODELS` la sobrescribe, igual que en Ollama. */
export function ollamaRoot(): string {
  return process.env['OLLAMA_MODELS'] ?? path.join(os.homedir(), '.ollama', 'models');
}

function digestToBlobPath(root: string, digest: string): string {
  // "sha256:abc..." -> "blobs/sha256-abc..."
  return path.join(root, 'blobs', digest.replace(':', '-'));
}

/**
 * Localiza los blobs de un modelo de Ollama.
 *
 * @param reference `nombre:tag` (p.ej. `qwen3.5:4b`). Sin tag asume `latest`.
 * @throws si el manifest o el blob no existen, con un mensaje accionable.
 */
export function resolveOllamaModel(reference: string): OllamaModelFiles {
  const [name, tag = 'latest'] = reference.split(':');
  if (!name) {
    throw new Error(`Invalid Ollama reference "${reference}". Expected "name:tag".`);
  }

  const root = ollamaRoot();
  const manifestPath = path.join(
    root,
    'manifests',
    'registry.ollama.ai',
    'library',
    name,
    tag,
  );

  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Ollama model "${reference}" not found.\n` +
        `  Looked for: ${manifestPath}\n` +
        `  Pull it with: ollama pull ${reference}`,
    );
  }

  let manifest: OllamaManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as OllamaManifest;
  } catch (error) {
    throw new Error(
      `Could not parse the Ollama manifest for "${reference}": ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const modelLayer = manifest.layers?.find((layer) => layer.mediaType === MODEL_LAYER);
  if (!modelLayer) {
    throw new Error(`The Ollama manifest for "${reference}" has no model layer.`);
  }

  const modelPath = digestToBlobPath(root, modelLayer.digest);
  if (!fs.existsSync(modelPath)) {
    throw new Error(
      `The manifest for "${reference}" points at a blob that is missing:\n  ${modelPath}\n` +
        `  Re-pull it with: ollama pull ${reference}`,
    );
  }

  const projectorLayer = manifest.layers?.find(
    (layer) => layer.mediaType === PROJECTOR_LAYER,
  );

  const result: OllamaModelFiles = {
    modelPath,
    sizeBytes: modelLayer.size,
  };

  if (projectorLayer) {
    const projectionPath = digestToBlobPath(root, projectorLayer.digest);
    if (fs.existsSync(projectionPath)) result.projectionPath = projectionPath;
  }

  return result;
}

/** true si el modelo esta disponible en local, sin lanzar. */
export function hasOllamaModel(reference: string): boolean {
  try {
    resolveOllamaModel(reference);
    return true;
  } catch {
    return false;
  }
}
