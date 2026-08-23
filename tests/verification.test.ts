/**
 * Verificacion local — M5, lado A. Doc 01 §21-§23.
 *
 * Incluye el caso canonico del doc 01 §21 (`1947 * 82 = 159654`) y la base de
 * REDUNDANT_DETERMINISTIC.
 */

import { MOCK_PROVIDER_PUBLIC_KEY, MockQvacConsumer, mockOutcome } from '@meshcompute/qvac-adapter';
import { describe, expect, it } from 'vitest';
import { hashOutput } from '../apps/consumer-agent/src/hashing.js';
import {
  notRequested,
  verifyExpectedAnswer,
  verifyLocalSchema,
  verifyRedundant,
} from '../apps/consumer-agent/src/verification.js';

describe('verifyExpectedAnswer (doc 01 §21)', () => {
  it('acepta el resultado correcto', () => {
    const result = verifyExpectedAnswer('{"answer": 159654}', 159654);
    expect(result.status).toBe('PASSED');
  });

  it('tolera fences y prosa alrededor', () => {
    const result = verifyExpectedAnswer(
      'Sure! ```json\n{"answer": 159654}\n``` Let me know if you need more.',
      159654,
    );
    expect(result.status).toBe('PASSED');
  });

  it('rechaza un valor incorrecto', () => {
    const result = verifyExpectedAnswer('{"answer": 159000}', 159654);
    expect(result.status).toBe('FAILED');
    expect(result.detail).toContain('expected 159654');
  });

  it('rechaza si answer no es numero', () => {
    const result = verifyExpectedAnswer('{"answer": "159654"}', 159654);
    expect(result.status).toBe('FAILED');
  });

  it('rechaza salida no JSON', () => {
    const result = verifyExpectedAnswer('The answer is 159654.', 159654);
    expect(result.status).toBe('FAILED');
  });
});

describe('verifyLocalSchema', () => {
  it('pasa con JSON valido y reliability ok', () => {
    const result = verifyLocalSchema({
      content: '{"providerStatus":"ONLINE"}',
      reliabilityPassed: true,
    });
    expect(result.status).toBe('PASSED');
  });

  it('falla si el grounding no paso, aunque el JSON sea valido', () => {
    // Un JSON perfectamente formado pero no fundamentado no puede pasar:
    // es exactamente el caso que Track 2 debe atrapar.
    const result = verifyLocalSchema({
      content: '{"providerStatus":"ONLINE"}',
      reliabilityPassed: false,
    });
    expect(result.status).toBe('FAILED');
    expect(result.detail).toContain('grounding');
  });

  it('falla con salida no JSON', () => {
    const result = verifyLocalSchema({ content: 'prose only', reliabilityPassed: true });
    expect(result.status).toBe('FAILED');
  });

  it('falla si el JSON es un array y no un objeto', () => {
    const result = verifyLocalSchema({ content: '[1,2,3]', reliabilityPassed: true });
    expect(result.status).toBe('FAILED');
  });
});

describe('notRequested', () => {
  it('devuelve NOT_REQUESTED para el modo NONE', () => {
    expect(notRequested()).toEqual({ mode: 'NONE', status: 'NOT_REQUESTED' });
  });
});

describe('verifyRedundant (doc 01 §22)', () => {
  const PROMPT = 'Return JSON only: {"answer": number}. Calculate 1947 * 82.';

  async function verifierSessionReturning(content: string) {
    const consumer = new MockQvacConsumer({ behavior: () => mockOutcome({ content }) });
    return consumer.openSession({
      providerPublicKey: MOCK_PROVIDER_PUBLIC_KEY,
      modelKey: 'demo-llm',
      timeoutMs: 5_000,
      fallbackToLocal: false,
    });
  }

  it('PASSED cuando los dos hashes coinciden', async () => {
    const primary = hashOutput('{"answer": 159654}');
    const verifierSession = await verifierSessionReturning('{"answer": 159654}');

    const result = await verifyRedundant({
      prompt: PROMPT,
      primaryOutputHash: primary.hash,
      verifierSession,
    });

    expect(result.status).toBe('PASSED');
    expect(result.verifierOutputHash).toBe(primary.hash);
  });

  it('PASSED aunque el formato difiera: la normalizacion lo absorbe', async () => {
    const primary = hashOutput('{"answer": 159654}');
    const verifierSession = await verifierSessionReturning(
      '```json\n{  "answer" : 159654 }\n```',
    );

    const result = await verifyRedundant({
      prompt: PROMPT,
      primaryOutputHash: primary.hash,
      verifierSession,
    });

    expect(result.status).toBe('PASSED');
  });

  it('FAILED cuando los providers no coinciden', async () => {
    const primary = hashOutput('{"answer": 159654}');
    const verifierSession = await verifierSessionReturning('{"answer": 159000}');

    const result = await verifyRedundant({
      prompt: PROMPT,
      primaryOutputHash: primary.hash,
      verifierSession,
    });

    expect(result.status).toBe('FAILED');
    expect(result.verifierOutputHash).not.toBe(primary.hash);
  });

  it('FAILED si el verificador revienta, sin tumbar el proceso', async () => {
    const consumer = new MockQvacConsumer({
      behavior: () => {
        throw new Error('verifier exploded');
      },
    });
    const verifierSession = await consumer.openSession({
      providerPublicKey: MOCK_PROVIDER_PUBLIC_KEY,
      modelKey: 'demo-llm',
      timeoutMs: 5_000,
      fallbackToLocal: false,
    });

    const result = await verifyRedundant({
      prompt: PROMPT,
      primaryOutputHash: 'a'.repeat(64),
      verifierSession,
    });

    expect(result.status).toBe('FAILED');
    expect(result.detail).toContain('verifier provider failed');
  });
});
