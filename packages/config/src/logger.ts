/**
 * Logger estructurado con redaccion obligatoria.
 *
 * RNF-05 (doc 00 §36): cada servicio imprime timestamp, service, event,
 * jobId/providerId y status. Nunca prompts.
 *
 * La redaccion NO es opcional ni depende de que quien llama se acuerde: el
 * logger recorre el objeto antes de serializar y sustituye cualquier clave
 * prohibida. PA-006/PA-007 y CA-008 dependen de esto, y hay un test que lo
 * verifica.
 */

/**
 * Claves cuyo valor jamas debe aparecer en un log.
 * Doc 00 §36 / doc 01 §13.
 */
const REDACTED_KEYS = new Set([
  'prompt',
  'response',
  'content',
  'contenttext',
  'output',
  'outputtext',
  'inputtext',
  'conversation',
  'history',
  'documentcontent',
  'seed',
  'seedphrase',
  'privatekey',
  'walletprivatekey',
  'executiontoken',
  'providertoken',
  'authorization',
  'password',
  'secret',
  'apikey',
  'token',
]);

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[MAX_DEPTH]';
  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? REDACTED : redact(item, depth + 1);
  }
  return out;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Campos estables que la demo y los tests esperan ver. */
export interface LogFields {
  event: string;
  jobId?: string;
  providerId?: string;
  status?: string;
  durationMs?: number;
  [key: string]: unknown;
}

export interface Logger {
  debug(fields: LogFields): void;
  info(fields: LogFields): void;
  warn(fields: LogFields): void;
  error(fields: LogFields): void;
  /** Texto libre para banners de arranque. Nunca para datos de request. */
  banner(line: string): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(service: string, minLevel: LogLevel = 'info'): Logger {
  const threshold = LEVEL_ORDER[minLevel];

  function emit(level: LogLevel, fields: LogFields): void {
    if (LEVEL_ORDER[level] < threshold) return;

    const { event, ...rest } = fields;
    const safe = redact(rest) as Record<string, unknown>;

    const parts = [
      new Date().toISOString(),
      `[${service}]`,
      `level=${level}`,
      `event=${event}`,
    ];
    for (const [key, value] of Object.entries(safe)) {
      if (value === undefined) continue;
      parts.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
    }

    const line = parts.join(' ');
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  return {
    debug: (fields) => emit('debug', fields),
    info: (fields) => emit('info', fields),
    warn: (fields) => emit('warn', fields),
    error: (fields) => emit('error', fields),
    banner: (line) => console.log(line),
  };
}

/** Exportado para poder testear la redaccion de forma aislada. */
export const __testing = { redact, REDACTED_KEYS, REDACTED };
