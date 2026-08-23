import type { FastifyInstance } from 'fastify';
import { validationError } from '../errors.js';
import { IdParamsSchema, zodDetails } from '../schemas.js';
import type { JobService } from '../services/job-service.js';
import type { ReputationService } from '../services/reputation-service.js';
import type { SettlementService } from '../services/settlement-service.js';
import type { StatsService } from '../services/stats-service.js';

export async function registerEconomyRoutes(
  app: FastifyInstance,
  jobService: JobService,
  settlementService: SettlementService,
  statsService: StatsService,
  reputationService: ReputationService,
): Promise<void> {
  app.post('/v1/jobs/:id/settle', async (request) => {
    const parsed = IdParamsSchema.safeParse(request.params);
    if (!parsed.success) throw validationError(zodDetails(parsed.error));
    const outcome = await settlementService.settle(parsed.data.id);
    const job = jobService.get(parsed.data.id);
    // M6: idempotente — el settle repetido no vuelve a sumar reputacion.
    reputationService.applyForJob(job.id);
    request.log.info(
      {
        requestId: request.id,
        jobId: job.id,
        providerId: job.providerId,
        paymentMode: job.paymentMode,
        paymentTxHash: job.paymentTxHash,
        idempotent: outcome.idempotent,
      },
      'job_settled',
    );
    return { job };
  });

  app.get('/v1/stats', async () => statsService.get());
}
