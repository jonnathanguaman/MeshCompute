import { buildMarketplaceApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const { app } = await buildMarketplaceApp({ config });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'marketplace_shutdown');
  await app.close();
  process.exitCode = 0;
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info({ port: config.PORT, host: config.HOST }, 'marketplace_started');
} catch (error) {
  app.log.error(
    {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : 'Unknown startup error',
    },
    'marketplace_start_failed',
  );
  process.exitCode = 1;
}
