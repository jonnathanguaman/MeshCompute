/**
 * Normalizacion y hashing del output. Doc 01 §19-§20.
 *
 * El hash es lo unico del contenido que llega a la API central, asi que la
 * normalizacion tiene que ser estable: dos ejecuciones que producen el mismo
 * dato deben producir el mismo hash, o la verificacion redundante (doc 01 §22)
 * daria falsos negativos.
 */

import { createHash } from 'node:crypto';

/**
 * Extrae el primer objeto/array JSON de un texto.
 *
 * Un small model rara vez devuelve JSON puro: suele envolverlo en fences
 * ```json o anteponer prosa. Se recorta al primer bloque balanceado en vez de
 * confiar en un regex, que se rompe con llaves anidadas dentro de strings.
 */
export function extractJson(text: string): string {
  const trimmed = text.trim();

  // Fence markdown explicito.
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fence?.[1]?.trim() ?? trimmed;

  const start = candidate.search(/[{[]/);
  if (start === -1) return candidate;

  const open = candidate[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < candidate.length; i += 1) {
    const char = candidate[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }

  return candidate.slice(start);
}

/** Ordena claves recursivamente para que el orden no afecte al hash. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const out: Record<string, unknown> = {};
  for (const [key, item] of entries) out[key] = sortKeys(item);
  return out;
}

/**
 * Normaliza una salida JSON. Doc 01 §19.
 * Lanza si el texto no contiene JSON valido: el llamador decide si eso es
 * VERIFICATION_FAILED o si debe caer a normalizacion de texto.
 */
export function normalizeJsonOutput(text: string): string {
  const parsed: unknown = JSON.parse(extractJson(text));
  return JSON.stringify(sortKeys(parsed));
}

/** Normalizacion de texto: trim + finales de linea. Sin transformaciones agresivas. */
export function normalizeTextOutput(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

/**
 * Normaliza intentando JSON primero y cayendo a texto.
 * Devuelve tambien que estrategia se uso, porque la verificacion LOCAL_SCHEMA
 * necesita saber si habia JSON parseable.
 */
export function normalizeOutput(text: string): { normalized: string; isJson: boolean } {
  try {
    return { normalized: normalizeJsonOutput(text), isJson: true };
  } catch {
    return { normalized: normalizeTextOutput(text), isJson: false };
  }
}

/** SHA-256 en hex de 64 caracteres. Doc 01 §20. */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Atajo: normaliza y hashea en un paso. */
export function hashOutput(text: string): { normalized: string; hash: string; isJson: boolean } {
  const { normalized, isJson } = normalizeOutput(text);
  return { normalized, hash: sha256(normalized), isJson };
}
