/**
 * Registro de modelos y resolución de GGUF locales de Ollama.
 *
 * Lo que estas pruebas protegen: que nadie pueda pedir tool calling a un
 * modelo cuyo chat template no lo soporta. Sin esa guarda, el síntoma sería un
 * benchmark con cero tool calls y refusals por todas partes — fácil de
 * confundir con un bug del orchestrator y difícil de diagnosticar en plena demo.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertToolCapable,
  buildModelSource,
  listModels,
  resolveModel,
  resolveOllamaModel,
} from '@meshcompute/qvac-adapter';
import { afterEach, describe, expect, it } from 'vitest';

describe('registro de modelos', () => {
  it('expone las cuatro claves esperadas', () => {
    const keys = listModels().map((m) => m.key);
    expect(keys).toContain('demo-llm');
    expect(keys).toContain('tooluse-llm');
    expect(keys).toContain('local-tooluse-llm');
    expect(keys).toContain('local-vision-llm');
  });

  it('lanza con una clave desconocida y lista las válidas', () => {
    expect(() => resolveModel('no-existe')).toThrow(/Unknown modelKey/);
    expect(() => resolveModel('no-existe')).toThrow(/demo-llm/);
  });

  it('cada entrada declara origen coherente con sus campos', () => {
    for (const model of listModels()) {
      if (model.source === 'registry') {
        expect(model.descriptor, `${model.key} necesita descriptor`).toBeDefined();
      } else {
        expect(model.ollamaRef, `${model.key} necesita ollamaRef`).toBeDefined();
      }
    }
  });
});

describe('assertToolCapable', () => {
  it('deja pasar un modelo con tools en su template', () => {
    expect(() => assertToolCapable(resolveModel('local-tooluse-llm'))).not.toThrow();
    expect(() => assertToolCapable(resolveModel('tooluse-llm'))).not.toThrow();
  });

  it('bloquea qwen2.5-vl: su chat template no contempla tool calling', () => {
    const vision = resolveModel('local-vision-llm');
    expect(vision.supportsTools).toBe(false);
    expect(() => assertToolCapable(vision)).toThrow(/cannot do tool calling/);
  });

  it('el mensaje de error sugiere modelos que sí sirven', () => {
    try {
      assertToolCapable(resolveModel('local-vision-llm'));
      throw new Error('debería haber lanzado');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('local-tooluse-llm');
    }
  });

  it('bloquea también Llama-3.2-1B, que tampoco declara tools', () => {
    expect(() => assertToolCapable(resolveModel('demo-llm'))).toThrow();
  });
});

describe('resolveOllamaModel', () => {
  const ollamaPresent = fs.existsSync(
    path.join(os.homedir(), '.ollama', 'models', 'manifests'),
  );

  it.skipIf(!ollamaPresent)('resuelve qwen3.5:4b a un blob que existe', () => {
    const files = resolveOllamaModel('qwen3.5:4b');
    expect(fs.existsSync(files.modelPath)).toBe(true);
    expect(files.sizeBytes).toBeGreaterThan(1e9);

    // El blob tiene que ser GGUF de verdad, no un manifest ni un placeholder.
    const magic = Buffer.alloc(4);
    const fd = fs.openSync(files.modelPath, 'r');
    fs.readSync(fd, magic, 0, 4, 0);
    fs.closeSync(fd);
    expect(magic.toString('ascii')).toBe('GGUF');
  });

  it('lanza con un mensaje accionable si el modelo no está', () => {
    expect(() => resolveOllamaModel('no-existe-jamas:1b')).toThrow(/ollama pull/);
  });

  it('acepta referencias sin tag y asume latest', () => {
    // No importa si existe: lo que se comprueba es que no revienta al parsear.
    expect(() => resolveOllamaModel('cualquiera')).toThrow(/not found/);
  });
});

describe('buildModelSource', () => {
  const ollamaPresent = fs.existsSync(
    path.join(os.homedir(), '.ollama', 'models', 'manifests'),
  );

  it('para el registry devuelve el descriptor sin modelType', () => {
    const source = buildModelSource(resolveModel('demo-llm'));
    expect(source.modelSrc).toBeDefined();
    // El descriptor ya lleva el engine; QVAC lo infiere.
    expect(source.modelType).toBeUndefined();
  });

  it.skipIf(!ollamaPresent)('para Ollama pasa modelType explícito', () => {
    const source = buildModelSource(resolveModel('local-tooluse-llm'));
    // Los blobs se llaman sha256-<hex>, sin extensión: QVAC no puede inferirlo.
    expect(source.modelType).toBe('llamacpp-completion');
    expect(String(source.modelSrc)).toContain('blobs');
  });
});

describe('OLLAMA_MODELS', () => {
  const original = process.env['OLLAMA_MODELS'];

  afterEach(() => {
    if (original === undefined) delete process.env['OLLAMA_MODELS'];
    else process.env['OLLAMA_MODELS'] = original;
  });

  it('respeta la variable de entorno al buscar la raíz', () => {
    process.env['OLLAMA_MODELS'] = path.join(os.tmpdir(), 'ollama-inexistente');
    expect(() => resolveOllamaModel('qwen3.5:4b')).toThrow(/ollama-inexistente/);
  });
});
