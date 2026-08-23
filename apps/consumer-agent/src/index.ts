/**
 * Consumer Agent — M2 + M2R. Doc 00 §11 / doc 01 §14-§18A.
 *
 *   pnpm consumer:start
 *
 * Expone en 127.0.0.1:5050:
 *   GET  /health
 *   POST /v1/inference
 *
 * El prompt entra por loopback, viaja por QVAC P2P al provider remoto y el
 * resultado vuelve a la UI. La API central solo ve hashes, metricas y estados.
 */

import { createLogger } from '@meshcompute/config';
import { MockQvacConsumer, QvacConsumer, type QvacConsumerService } from '@meshcompute/qvac-adapter';
import { BIND_HOST, loadConsumerConfig } from './config.js';
import {
  FIXTURE_JOB_ID,
  FIXTURE_PROVIDER_ID,
  fixtureJobs,
  fixtureProviders,
} from './fixtures/demo-fixtures.js';
import { InferenceService } from './inference-service.js';
import {
  DisabledConsumerMarketplaceClient,
  HttpConsumerMarketplaceClient,
  type ConsumerMarketplaceClient,
} from './marketplace-client.js';
import { buildServer } from './server.js';

const config = loadConsumerConfig();
const logger = createLogger('consumer-agent', config.LOG_LEVEL);

const qvac: QvacConsumerService =
  config.QVAC_ADAPTER === 'mock'
    ? new MockQvacConsumer({ ids: { jobId: FIXTURE_JOB_ID, providerId: FIXTURE_PROVIDER_ID } })
    : new QvacConsumer();

// Doc 01 §24 / doc 00 §31: sin la API de B, las tools leen fixtures
// deterministas y los estados se imprimen en local.
const marketplace: ConsumerMarketplaceClient = config.MARKETPLACE_DISABLED
  ? new DisabledConsumerMarketplaceClient(logger, {
      providers: fixtureProviders(),
      jobs: fixtureJobs(),
    })
  : new HttpConsumerMarketplaceClient(config.MARKETPLACE_API_URL, logger);

const inference = new InferenceService({ config, logger, qvac, marketplace });

const app = await buildServer({ config, logger, qvac, inference });

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ event: 'consumer_stopping', signal });
  try {
    await app.close();
    await qvac.closeAll();
    logger.info({ event: 'consumer_stopped' });
  } catch (error) {
    logger.error({
      event: 'consumer_stop_failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  // CA-001: loopback. `BIND_HOST` es una constante, no configurable: exponer
  // el agente en 0.0.0.0 daria a la red local acceso al modelo del usuario.
  await app.listen({ host: BIND_HOST, port: config.port });

  logger.banner('');
  logger.banner(`  Consumer Agent listening on http://${BIND_HOST}:${config.port}`);
  logger.banner(`  CORS origin        : ${config.WEB_ORIGIN}`);
  logger.banner(`  QVAC adapter       : ${config.QVAC_ADAPTER}`);
  logger.banner(`  fallbackToLocal    : ${config.QVAC_FALLBACK_TO_LOCAL}`);
  logger.banner(`  reliability        : ${config.RELIABILITY_ENABLED ? 'enabled' : 'disabled'}`);
  logger.banner(`  marketplace        : ${config.MARKETPLACE_DISABLED ? 'disabled (fixtures)' : config.MARKETPLACE_API_URL}`);
  logger.banner('');

  if (config.QVAC_FALLBACK_TO_LOCAL) {
    // CA-005 / DoD A: con fallback activo no se puede demostrar que el trabajo
    // se ejecuto en la otra maquina.
    logger.warn({
      event: 'fallback_to_local_enabled',
      hint: 'Set QVAC_FALLBACK_TO_LOCAL=false for the demo: otherwise a failed remote job runs locally and looks like a success.',
    });
  }
} catch (error) {
  logger.error({
    event: 'consumer_start_failed',
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}
