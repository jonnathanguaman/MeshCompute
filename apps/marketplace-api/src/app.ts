import { mkdirSync } from 'node:fs';
import cors from '@fastify/cors';
import type { PricingService } from '@meshcompute/contracts';
import type { PaymentAdapter } from '@meshcompute/payment-adapter';
import Fastify, { type FastifyInstance } from 'fastify';
import type { MarketplaceConfig } from './config.js';
import { databaseDirectory, openDatabase, runMigrations, type SqliteDatabase } from './db/connection.js';
import { ContractRepository } from './db/core/contract-repository.js';
import { JobRepository } from './db/core/job-repository.js';
import { ProviderRepository } from './db/core/provider-repository.js';
import { UserRepository } from './db/core/user-repository.js';
import { PaymentAttemptRepository } from './db/economy/payment-attempt-repository.js';
import { AppError } from './errors.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerEconomyRoutes } from './routes/economy.js';
import { registerPortalRoutes } from './routes/portal.js';
import { registerProviderRoutes } from './routes/providers.js';
import { AuthService } from './services/auth-service.js';
import { JobService } from './services/job-service.js';
import { PortalService } from './services/portal-service.js';
import { ReputationService } from './services/reputation-service.js';
import { createPaymentAdapter } from './services/payment-adapter.factory.js';
import { providerSnapshotPricing } from './services/pricing-service.port.js';
import { ProviderService } from './services/provider-service.js';
import { SettlementService } from './services/settlement-service.js';
import { StatsService } from './services/stats-service.js';

export interface MarketplaceContext {
  database: SqliteDatabase;
  providerService: ProviderService;
  authService: AuthService;
  portalService: PortalService;
  jobService: JobService;
  reputationService: ReputationService;
  paymentAttemptRepository: PaymentAttemptRepository;
  settlementService: SettlementService;
  statsService: StatsService;
}

export const SENSITIVE_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.x-execution-token',
] as const;

export interface BuildMarketplaceAppOptions {
  config: MarketplaceConfig;
  database?: SqliteDatabase;
  pricingService?: PricingService;
  paymentAdapter?: PaymentAdapter;
  now?: () => Date;
  logger?: boolean;
  startOfflineMonitor?: boolean;
}

export async function buildMarketplaceApp(
  options: BuildMarketplaceAppOptions,
): Promise<{ app: FastifyInstance; context: MarketplaceContext }> {
  const databasePath = databaseDirectory(options.config.DATABASE_URL);
  if (!options.database && databasePath) mkdirSync(databasePath, { recursive: true });
  const database = options.database ?? openDatabase(options.config.DATABASE_URL);
  runMigrations(database);

  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: options.config.LOG_LEVEL,
            redact: {
              paths: [...SENSITIVE_LOG_PATHS],
              censor: '[REDACTED]',
            },
          },
    bodyLimit: 64 * 1024,
    requestIdHeader: false,
  });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || origin === options.config.WEB_URL) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Execution-Token'],
  });

  const providerRepository = new ProviderRepository(database);
  const providerService = new ProviderService(providerRepository, {
    ...(options.now ? { now: options.now } : {}),
    offlineAfterMs: options.config.PROVIDER_OFFLINE_AFTER_MS,
    sweepIntervalMs: options.config.PROVIDER_SWEEP_INTERVAL_MS,
  });
  const userRepository = new UserRepository(database);
  const authService = new AuthService(userRepository, options.now);
  const contractRepository = new ContractRepository(database);
  const jobRepository = new JobRepository(database);
  const portalService = new PortalService(
    providerRepository,
    contractRepository,
    jobRepository,
    options.now,
    options.config.CONTRACT_TTL_MS,
  );
  const jobService = new JobService(
    jobRepository,
    providerService,
    options.pricingService ?? providerSnapshotPricing,
    options.now,
    options.config.PRICING_TIMEOUT_MS,
  );
  const reputationService = new ReputationService(
    database,
    jobRepository,
    providerRepository,
    options.now,
  );
  const paymentAdapter = options.paymentAdapter ?? createPaymentAdapter(options.config);
  const paymentAttemptRepository = new PaymentAttemptRepository(database);
  const settlementService = new SettlementService(
    database,
    jobService,
    paymentAdapter,
    paymentAttemptRepository,
    options.now,
    options.config.SETTLE_BY_TOKENS,
  );
  const statsService = new StatsService(database);

  app.get('/health', async (request, reply) => {
    try {
      database.prepare('SELECT 1 AS ready').get();
      return { status: 'ok', service: 'marketplace-api', database: 'ready' };
    } catch {
      request.log.error({ requestId: request.id }, 'database_readiness_failed');
      return reply.code(503).send({
        status: 'error',
        service: 'marketplace-api',
        database: 'unavailable',
      });
    }
  });
  await registerProviderRoutes(app, providerService);
  await registerAuthRoutes(app, authService);
  await registerPortalRoutes(app, authService, portalService);
  await registerJobRoutes(
    app,
    jobService,
    authService,
    settlementService,
    reputationService,
    options.config.AUTO_SETTLE,
  );
  await registerEconomyRoutes(app, jobService, settlementService, statsService, reputationService);

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send({ code: 'NOT_FOUND', message: 'Route not found.' });
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn(
        { requestId: request.id, code: error.code, statusCode: error.statusCode },
        'marketplace_request_rejected',
      );
      return reply.code(error.statusCode).send({
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    }

    const safeError = error instanceof Error ? error : new Error('Unknown marketplace error');
    const possibleStatus = (safeError as Error & { statusCode?: unknown }).statusCode;
    const statusCode = typeof possibleStatus === 'number' && possibleStatus < 500 ? possibleStatus : 500;
    if (statusCode >= 500) {
      request.log.error(
        { errorName: safeError.name, errorMessage: safeError.message },
        'unhandled_marketplace_error',
      );
    }
    return reply.code(statusCode).send({
      code: statusCode === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
      message: statusCode === 400 ? 'The request payload is invalid.' : 'An internal error occurred.',
    });
  });

  if (options.startOfflineMonitor !== false) {
    providerService.startOfflineMonitor(
      (count) => app.log.info({ count }, 'providers_marked_offline'),
      (error) => {
        app.log.error(
          {
            errorName: error instanceof Error ? error.name : 'UnknownError',
            errorMessage: error instanceof Error ? error.message : 'Unknown provider sweep error',
          },
          'provider_offline_sweep_failed',
        );
      },
    );
  }

  app.addHook('onClose', async () => {
    providerService.stopOfflineMonitor();
    await paymentAdapter.dispose?.();
    if (!options.database) database.close();
  });

  return {
    app,
    context: {
      database,
      providerService,
      authService,
      portalService,
      jobService,
      reputationService,
      paymentAttemptRepository,
      settlementService,
      statsService,
    },
  };
}
