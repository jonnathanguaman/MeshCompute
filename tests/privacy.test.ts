/**
 * Privacidad como propiedad tecnica, no como promesa.
 *
 * Doc 00 §9 / RNF-01 / CA-007 / CA-008 / PA-006 / T-03.
 *
 * Estas pruebas existen porque la afirmacion central del producto ante el
 * jurado es "el marketplace no recibe el prompt". Una promesa sin test es
 * una promesa.
 */

import { __loggerTesting, createLogger } from '@meshcompute/config';
import {
  JobCreateRequestSchema,
  JobProgressPatchSchema,
  LocalInferenceRequestSchema,
} from '@meshcompute/contracts';
import { describe, expect, it, vi } from 'vitest';
import { HttpConsumerMarketplaceClient } from '../apps/consumer-agent/src/marketplace-client.js';

const logger = createLogger('test', 'error');

describe('T-03: los schemas centrales rechazan contenido', () => {
  it('JobCreateRequest rechaza un payload con prompt', () => {
    const result = JobCreateRequestSchema.safeParse({
      providerId: 'p1',
      modelKey: 'demo-llm',
      promptHash: 'a'.repeat(64),
      prompt: 'dato privado',
    });
    expect(result.success).toBe(false);
  });

  it('JobProgressPatch rechaza content/output/prompt', () => {
    for (const leaked of ['prompt', 'content', 'output', 'response', 'trace']) {
      const result = JobProgressPatchSchema.safeParse({
        status: 'RUNNING',
        [leaked]: 'dato privado',
      });
      expect(result.success, `${leaked} deberia rechazarse`).toBe(false);
    }
  });

  it('JobCreateRequest exige un promptHash de 64 hex, no el prompt', () => {
    expect(
      JobCreateRequestSchema.safeParse({
        providerId: 'p1',
        modelKey: 'demo-llm',
        promptHash: 'demasiado-corto',
      }).success,
    ).toBe(false);
  });
});

describe('CA-007: el cliente central nunca envia contenido', () => {
  it('un patch con content falla ANTES de salir por la red', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const client = new HttpConsumerMarketplaceClient('http://localhost:4000', logger);

    await expect(
      client.patchProgress('job_1', 'exec-token', {
        status: 'VERIFIED',
        // @ts-expect-error: se comprueba justamente el caso prohibido
        content: 'respuesta del modelo',
      }),
    ).rejects.toThrow();

    // Lo importante: no hubo request.
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('el body enviado solo contiene campos de JobProgressPatch', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const client = new HttpConsumerMarketplaceClient('http://localhost:4000', logger);
    await client.patchProgress('job_1', 'exec-token', {
      status: 'VERIFIED',
      outputHash: 'c'.repeat(64),
      inputTokens: 1200,
      outputTokens: 340,
      durationMs: 1820,
      verificationStatus: 'PASSED',
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(call[1].body)) as Record<string, unknown>;
    const headers = call[1].headers as Record<string, string>;

    expect(headers['X-Execution-Token']).toBe('exec-token');
    expect(JSON.stringify(body)).not.toContain('exec-token');

    const allowed = new Set([
      'status',
      'outputHash',
      'inputTokens',
      'outputTokens',
      'durationMs',
      'verificationStatus',
    ]);
    for (const key of Object.keys(body)) {
      expect(allowed.has(key), `campo inesperado: ${key}`).toBe(true);
    }
    vi.unstubAllGlobals();
  });

  it('doc 01 §25: no se emiten estados fuera de la secuencia permitida', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const client = new HttpConsumerMarketplaceClient('http://localhost:4000', logger);

    // PAID lo decide B tras el settlement; A no puede inventarlo.
    await expect(client.patchProgress('job_1', 'exec-token', { status: 'PAID' })).rejects.toThrow(
      /must not emit job status/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('CA-008 / PA-007: el logger redacta', () => {
  it('sustituye las claves prohibidas', () => {
    const redacted = __loggerTesting.redact({
      jobId: 'job_1',
      prompt: 'texto secreto del usuario',
      response: 'salida del modelo',
      providerToken: 'tok_123',
      executionToken: 'exec_123',
      nested: { seedPhrase: 'palabra1 palabra2', ok: 'visible' },
    }) as Record<string, unknown>;

    expect(redacted['jobId']).toBe('job_1');
    expect(redacted['prompt']).toBe('[REDACTED]');
    expect(redacted['response']).toBe('[REDACTED]');
    expect(redacted['providerToken']).toBe('[REDACTED]');
    expect(redacted['executionToken']).toBe('[REDACTED]');

    const nested = redacted['nested'] as Record<string, unknown>;
    expect(nested['seedPhrase']).toBe('[REDACTED]');
    expect(nested['ok']).toBe('visible');
  });

  it('la redaccion no distingue mayusculas', () => {
    const redacted = __loggerTesting.redact({ Prompt: 'x', PROMPT: 'y' }) as Record<string, unknown>;
    expect(redacted['Prompt']).toBe('[REDACTED]');
    expect(redacted['PROMPT']).toBe('[REDACTED]');
  });

  it('un prompt nunca aparece en la salida real del logger', () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    const testLogger = createLogger('privacy-test', 'debug');
    testLogger.info({
      event: 'inference_received',
      jobId: 'job_1',
      prompt: 'CONTENIDO-PRIVADO-DEL-USUARIO',
    });

    spy.mockRestore();
    expect(lines.join('\n')).not.toContain('CONTENIDO-PRIVADO-DEL-USUARIO');
    expect(lines.join('\n')).toContain('[REDACTED]');
  });

  it('los errores se reducen a name/message y no arrastran el request', () => {
    const error = new Error('boom') as Error & { request?: unknown };
    error.request = { prompt: 'CONTENIDO-PRIVADO' };

    const redacted = __loggerTesting.redact({ error }) as Record<string, unknown>;
    expect(JSON.stringify(redacted)).not.toContain('CONTENIDO-PRIVADO');
  });
});

describe('la frontera local SI acepta el prompt', () => {
  it('LocalInferenceRequest lo exige: es loopback', () => {
    const result = LocalInferenceRequestSchema.safeParse({
      jobId: 'job_1',
      executionToken: 'tok',
      provider: { id: 'p1', qvacPublicKey: 'a'.repeat(64), modelKey: 'demo-llm' },
      prompt: 'contenido del usuario',
      verificationMode: 'LOCAL_SCHEMA',
    });
    expect(result.success).toBe(true);
  });

  it('pero sigue rechazando campos no declarados', () => {
    const result = LocalInferenceRequestSchema.safeParse({
      jobId: 'job_1',
      executionToken: 'tok',
      provider: { id: 'p1', qvacPublicKey: 'a'.repeat(64), modelKey: 'demo-llm' },
      prompt: 'contenido',
      verificationMode: 'LOCAL_SCHEMA',
      exfiltrate: 'http://evil.example',
    });
    expect(result.success).toBe(false);
  });
});
