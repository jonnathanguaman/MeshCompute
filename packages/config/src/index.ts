/**
 * @meshcompute/config — unico punto de lectura de process.env.
 *
 * RNF-08 (doc 00 §27): nada sensible hardcodeado. Si falta una variable
 * requerida el proceso falla ruidosamente al arrancar, no a mitad de la demo.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z, type ZodTypeAny } from 'zod';

let dotenvLoaded = false;

/**
 * Carga .env una sola vez.
 *
 * Busca en el cwd y, sobre todo, en la raiz del monorepo: `pnpm provider:start`
 * usa `--filter`, asi que el cwd pasa a ser `apps/provider-agent` y el `.env`
 * de la raiz no se encontraria.
 *
 * `fileURLToPath` es obligatorio: en Windows, `new URL(...).pathname` devuelve
 * `/E:/MeshCompute/.env` — con barra inicial — que no es una ruta valida, y
 * dotenv falla en silencio dejando el proceso sin configuracion.
 */
function ensureDotenv(): void {
  if (dotenvLoaded) return;

  // 1) cwd: para quien ejecute desde la raiz o desde su propia app.
  loadDotenv();

  // 2) raiz del monorepo: packages/config/src -> config -> packages -> raiz
  const here = path.dirname(fileURLToPath(import.meta.url));
  const rootEnv = path.resolve(here, '..', '..', '..', '.env');
  if (existsSync(rootEnv)) loadDotenv({ path: rootEnv });

  normalizeGgmlVulkanFlag();
  dotenvLoaded = true;
}

/**
 * Carga .env y aplica las normalizaciones, para entry points sin schema Zod
 * (spikes y scripts). Los agentes ya pasan por aqui via `loadEnv`.
 *
 * Imprescindible antes del primer `loadModel`/`getSystemResources`: el worker
 * Bare hereda process.env al spawnearse, y `GGML_DISABLE_VULKAN` tiene que
 * estar puesta ANTES de ese spawn o el backend nativo no la ve.
 */
export function ensureEnvLoaded(): void {
  ensureDotenv();
}

/**
 * Normaliza `GGML_DISABLE_VULKAN` antes de que el worker nativo la herede.
 *
 * En esta maquina (iGPU AMD Radeon, Ryzen 4600H) el backend Vulkan del addon
 * llama.cpp se cuelga inicializando: 100% de un core, memoria congelada, y
 * `loadModel` no termina nunca. Con la variable puesta, el mismo modelo carga
 * en ~14 s por CPU. Ver docs/qvac-findings.md.
 *
 * Se normaliza por si el addon la trata por PRESENCIA y no por valor:
 * "0"/"false"/"off"/vacia se eliminan de process.env para que `=0` en el .env
 * signifique "usar GPU" y no lo contrario.
 */
export function normalizeGgmlVulkanFlag(): void {
  const raw = process.env['GGML_DISABLE_VULKAN'];
  if (raw === undefined) return;

  const value = raw.trim().toLowerCase();
  if (['', '0', 'false', 'no', 'off'].includes(value)) {
    delete process.env['GGML_DISABLE_VULKAN'];
  }
}

/**
 * Normaliza `QVAC_HYPERSWARM_SEED` antes de que el SDK la lea.
 *
 * El SDK la consume directamente de process.env y exige 32 bytes (64 hex) si
 * esta presente. Un `.env` con la linea `QVAC_HYPERSWARM_SEED=` la deja como
 * cadena vacia — presente pero invalida — y `startQVACProvider` falla con
 * `seed must be 'crypto_sign_SEEDBYTES' bytes`.
 *
 * Vacia  -> se elimina, el SDK genera una keypair efimera.
 * Con valor -> se valida el formato aqui, no en mitad de la demo.
 */
export function normalizeHyperswarmSeed(): void {
  const raw = process.env['QVAC_HYPERSWARM_SEED'];
  if (raw === undefined) return;

  const seed = raw.trim();
  if (seed === '') {
    delete process.env['QVAC_HYPERSWARM_SEED'];
    return;
  }

  if (!/^[0-9a-fA-F]{64}$/.test(seed)) {
    throw new ConfigError(
      'QVAC_HYPERSWARM_SEED must be 64 hex characters (32 bytes), or left unset.\n' +
        '  Generate one with:\n' +
        "    node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n" +
        '  Setting it keeps the provider public key stable across restarts.',
    );
  }
  process.env['QVAC_HYPERSWARM_SEED'] = seed;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Valida process.env contra un schema Zod y devuelve el resultado tipado.
 * Los errores se agrupan para no obligar a arreglar una variable por corrida.
 */
export function loadEnv<T extends ZodTypeAny>(schema: T): z.infer<T> {
  ensureDotenv();
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(
      `Invalid environment configuration:\n${details}\n\n` +
        'Copy .env.example to .env and fill in the missing values.',
    );
  }

  return parsed.data;
}

/** "true"/"1"/"yes" -> true. Cualquier otra cosa -> false. */
export const BooleanFromEnv = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((raw) => {
      if (raw === undefined || raw.trim() === '') return defaultValue;
      return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
    });

/** Entero positivo desde env, con default. */
export const IntFromEnv = (defaultValue: number, min = 0) =>
  z
    .string()
    .optional()
    .transform((raw) => (raw === undefined || raw.trim() === '' ? defaultValue : Number(raw)))
    .pipe(z.number().int().min(min));

/** Lista separada por comas; vacio -> []. */
export const ListFromEnv = () =>
  z
    .string()
    .optional()
    .transform((raw) =>
      (raw ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    );

export {
  createLogger,
  type Logger,
  type LogFields,
  type LogLevel,
  __testing as __loggerTesting,
} from './logger.js';
