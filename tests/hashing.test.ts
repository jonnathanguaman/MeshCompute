/**
 * Doc 01 §19-§20: normalizacion y SHA-256.
 *
 * La normalizacion tiene que ser estable o la verificacion redundante
 * (doc 01 §22) produce falsos negativos.
 */

import { describe, expect, it } from 'vitest';
import {
  extractJson,
  hashOutput,
  normalizeJsonOutput,
  normalizeTextOutput,
  sha256,
} from '../apps/consumer-agent/src/hashing.js';

describe('sha256', () => {
  it('produce 64 caracteres hex en minuscula', () => {
    const hash = sha256('meshcompute');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('es estable entre llamadas', () => {
    expect(sha256('same input')).toBe(sha256('same input'));
  });
});

describe('extractJson', () => {
  it('extrae JSON de un fence markdown', () => {
    const text = 'Here you go:\n```json\n{"answer": 159654}\n```\nHope it helps.';
    expect(JSON.parse(extractJson(text))).toEqual({ answer: 159654 });
  });

  it('extrae JSON rodeado de prosa sin fences', () => {
    const text = 'The result is {"answer": 42} as computed.';
    expect(JSON.parse(extractJson(text))).toEqual({ answer: 42 });
  });

  it('no se rompe con llaves dentro de strings', () => {
    const text = '{"note": "this } is not the end", "ok": true}';
    expect(JSON.parse(extractJson(text))).toEqual({
      note: 'this } is not the end',
      ok: true,
    });
  });

  it('maneja objetos anidados', () => {
    const text = 'prefix {"a": {"b": {"c": 1}}} suffix';
    expect(JSON.parse(extractJson(text))).toEqual({ a: { b: { c: 1 } } });
  });
});

describe('normalizeJsonOutput', () => {
  it('produce el mismo hash independientemente del orden de las claves', () => {
    const a = normalizeJsonOutput('{"b": 2, "a": 1}');
    const b = normalizeJsonOutput('{"a": 1, "b": 2}');
    expect(a).toBe(b);
    expect(sha256(a)).toBe(sha256(b));
  });

  it('ordena claves anidadas', () => {
    const a = normalizeJsonOutput('{"x": {"z": 1, "y": 2}}');
    const b = normalizeJsonOutput('{"x": {"y": 2, "z": 1}}');
    expect(a).toBe(b);
  });

  it('ignora el espaciado y los fences', () => {
    const a = normalizeJsonOutput('```json\n{  "answer" :  1  }\n```');
    const b = normalizeJsonOutput('{"answer":1}');
    expect(a).toBe(b);
  });

  it('es idempotente', () => {
    const once = normalizeJsonOutput('{"b":2,"a":1}');
    expect(normalizeJsonOutput(once)).toBe(once);
  });
});

describe('normalizeTextOutput', () => {
  it('normaliza finales de linea y recorta', () => {
    expect(normalizeTextOutput('  line1\r\nline2  ')).toBe('line1\nline2');
  });
});

describe('hashOutput', () => {
  it('marca la salida JSON como tal', () => {
    const result = hashOutput('{"answer": 1}');
    expect(result.isJson).toBe(true);
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cae a texto cuando no hay JSON', () => {
    const result = hashOutput('just prose');
    expect(result.isJson).toBe(false);
    expect(result.normalized).toBe('just prose');
  });

  it('dos providers que emiten el mismo JSON con distinto formato coinciden', () => {
    // Base de REDUNDANT_DETERMINISTIC (doc 01 §22).
    const a = hashOutput('```json\n{"answer": 159654}\n```');
    const b = hashOutput('{"answer":159654}');
    expect(a.hash).toBe(b.hash);
  });
});
