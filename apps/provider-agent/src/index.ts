/**
 * Provider Agent — M1. Doc 00 §10 / doc 01 §7-§13.
 *
 * Convierte esta maquina en un nodo de inferencia QVAC y la publica en el
 * marketplace.
 *
 *   pnpm provider:start
 *
 * Flujo (doc 01 §8):
 *   load env -> validar -> startQVACProvider -> publicKey -> warmup
 *   -> register -> heartbeat loop -> seguir vivo
 */

import { createLogger } from '@meshcompute/config';
import { QvacAdapterError, QvacProvider, watchInferenceJobs } from '@meshcompute/qvac-adapter';
import type { ProviderRegisterRequest } from '@meshcompute/contracts';
import { loadProviderConfig, type ProviderConfig } from './config.js';
import {
  DisabledMarketplaceClient,
  HttpMarketplaceClient,
  type MarketplaceClient,
  type RegistrationResult,
} from './marketplace-client.js';

const config: ProviderConfig = loadProviderConfig();
const logger = createLogger('provider-agent', config.LOG_LEVEL);

const provider = new QvacProvider();
const marketplace: MarketplaceClient = config.MARKETPLACE_DISABLED
  ? new DisabledMarketplaceClient(logger)
  : new HttpMarketplaceClient(config.MARKETPLACE_API_URL, logger);

let heartbeatTimer: NodeJS.Timeout | undefined;
let registration: RegistrationResult | undefined;
let shuttingDown = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * PA-005: la API central puede no estar disponible al arrancar. QVAC sigue
 * arriba y reintentamos indefinidamente con backoff simple. Un provider que
 * se apaga porque el backend tarda en levantar seria inutil en la demo.
 */
async function registerWithRetry(request: ProviderRegisterRequest): Promise<RegistrationResult> {
  let attempt = 0;

  for (;;) {
    if (shuttingDown) throw new Error('shutting down');
    attempt += 1;
    try {
      const result = await marketplace.register(request);
      logger.info({
        event: 'marketplace_registered',
        providerId: result.providerId,
        attempt,
      });
      return result;
    } catch (error) {
      // Backoff simple con techo. Doc 01 §12: no dedicar tiempo a circuit breakers.
      const waitMs = Math.min(config.REGISTER_RETRY_MS * attempt, 30_000);
      logger.warn({
        event: 'marketplace_register_failed',
        attempt,
        retryInMs: waitMs,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(waitMs);
    }
  }
}

/**
 * PA-004. Un heartbeat fallido NO apaga QVAC (doc 01 §11): se avisa y se
 * reintenta en el siguiente tick.
 */
function startHeartbeat(result: RegistrationResult): void {
  heartbeatTimer = setInterval(() => {
    void marketplace.heartbeat(result.providerId, result.providerToken).then(
      () => logger.debug({ event: 'heartbeat_ok', providerId: result.providerId }),
      (error: unknown) =>
        logger.warn({
          event: 'heartbeat_failed',
          providerId: result.providerId,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  }, config.HEARTBEAT_INTERVAL_MS);

  // No mantener vivo el proceso solo por el timer.
  heartbeatTimer.unref?.();
}

async function main(): Promise<void> {
  logger.info({
    event: 'provider_starting',
    name: config.PROVIDER_NAME,
    modelKey: config.PROVIDER_MODEL_KEY,
    marketplaceDisabled: config.MARKETPLACE_DISABLED,
  });

  // --- PA-001: arrancar QVAC ---
  const allowed = config.QVAC_FIREWALL_ALLOWED_KEYS;
  const { publicKey } = await provider.start({ allowedConsumerKeys: allowed });

  logger.info({
    event: 'provider_started',
    firewall: allowed.length > 0 ? `allow:${allowed.length}` : 'open',
  });

  // --- PA-002: la public key debe verse en terminal ---
  // Es publica por diseno: el consumer la necesita para conectar.
  logger.banner('');
  logger.banner('  QVAC provider started');
  logger.banner(`  Public key: ${publicKey}`);
  logger.banner('');
  logger.info({ event: 'provider_public_key' });

  if (allowed.length === 0) {
    logger.warn({
      event: 'firewall_open',
      hint: 'QVAC_FIREWALL_ALLOWED_KEYS is empty: any consumer can delegate to this node.',
    });
  }

  // --- Visibilidad de jobs delegados: imprime lo que manda cada consumer ---
  // En este agente toda inferencia viene de un consumer remoto (el provider
  // no ejecuta completions propias), asi que el stream es 1:1 con los jobs.
  watchInferenceJobs((job) => {
    logger.banner('');
    logger.banner(`  Delegated job received (model ${job.modelId}):`);
    for (const message of job.messages) {
      const text =
        message.content.length > 300 ? `${message.content.slice(0, 300)}…` : message.content;
      logger.banner(`    [${message.role}] ${text}`);
    }
    logger.banner('');
    logger.info({ event: 'delegated_job_received', modelId: job.modelId });
  });

  // --- Warmup: evita que la primera inferencia delegada descargue el GGUF ---
  if (config.PROVIDER_WARMUP_MODEL) {
    const warmStart = Date.now();
    logger.info({ event: 'model_warmup_started', modelKey: config.PROVIDER_MODEL_KEY });
    try {
      await provider.warmup(config.PROVIDER_MODEL_KEY);
      logger.info({
        event: 'model_warmup_done',
        modelKey: config.PROVIDER_MODEL_KEY,
        durationMs: Date.now() - warmStart,
      });
    } catch (error) {
      // Un warmup fallido no impide servir: el modelo se cargara en la
      // primera peticion. Se avisa porque la demo se vera lenta.
      logger.warn({
        event: 'model_warmup_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // --- PA-003: registro en el marketplace ---
  const request: ProviderRegisterRequest = {
    name: config.PROVIDER_NAME,
    qvacPublicKey: publicKey,
    walletAddress: config.PROVIDER_WALLET,
    modelKey: config.PROVIDER_MODEL_KEY,
    modelLabel: config.PROVIDER_MODEL_LABEL,
    hardwareLabel: config.PROVIDER_HARDWARE,
    pricePer1kTokensAtomic: config.PROVIDER_PRICE_ATOMIC,
  };

  registration = await registerWithRetry(request);
  startHeartbeat(registration);

  logger.info({
    event: 'provider_ready',
    providerId: registration.providerId,
    heartbeatMs: config.HEARTBEAT_INTERVAL_MS,
  });
  logger.banner('  Waiting for delegated inference jobs. Ctrl+C to stop.');
  logger.banner('');
}

/** PA-008: apagado limpio. */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ event: 'provider_stopping', signal });
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  try {
    await provider.stop();
    logger.info({ event: 'provider_stopped' });
  } catch (error) {
    logger.error({
      event: 'provider_stop_failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await main();
} catch (error) {
  // PA-001 / doc 01 §19: si QVAC no inicia, NO registrar el provider como
  // online. Mostrar el error y salir.
  if (error instanceof QvacAdapterError) {
    logger.error({ event: 'provider_start_failed', code: error.code, error: error.message });
  } else {
    logger.error({
      event: 'provider_start_failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
  logger.banner('');
  logger.banner('  The QVAC provider did not start. This node was NOT registered.');
  logger.banner('  Run `pnpm qvac:doctor` to diagnose the runtime.');
  logger.banner('');
  process.exit(1);
}

// Mantener el proceso vivo esperando trabajos P2P (doc 01 §8).
setInterval(() => undefined, 1 << 30);
