import type { JobCreateRequest, JobProgressPatch, JobStatus } from '@meshcompute/contracts';
import type { FastifyInstance } from 'fastify';
import { validationError } from '../errors.js';
import { extractBearerToken } from '../security/tokens.js';
import {
  IdParamsSchema,
  JobCreateSchema,
  JobListQuerySchema,
  JobProgressSchema,
  zodDetails,
} from '../schemas.js';
import type { AuthService } from '../services/auth-service.js';
import type { JobService } from '../services/job-service.js';
import type { ReputationService } from '../services/reputation-service.js';
import type { SettlementService } from '../services/settlement-service.js';

function executionToken(headers: Record<string, string | string[] | undefined>): string | undefined {
  const explicit = headers['x-execution-token'];
  if (typeof explicit === 'string') return explicit;
  const authorization = headers.authorization;
  return typeof authorization === 'string' ? extractBearerToken(authorization) : undefined;
}

export async function registerJobRoutes(
  app: FastifyInstance,
  jobService: JobService,
  authService: AuthService,
  settlementService: SettlementService,
  reputationService: ReputationService,
  autoSettle = true,
): Promise<void> {
  app.post('/v1/jobs', async (request, reply) => {
    const parsed = JobCreateSchema.safeParse(request.body);
    if (!parsed.success) throw validationError(zodDetails(parsed.error));
    const input: JobCreateRequest = {
      providerId: parsed.data.providerId,
      modelKey: parsed.data.modelKey,
      promptHash: parsed.data.promptHash,
      ...(parsed.data.verifierProviderId
        ? { verifierProviderId: parsed.data.verifierProviderId }
        : {}),
      ...(parsed.data.consumerWallet ? { consumerWallet: parsed.data.consumerWallet } : {}),
    };
    // Si viene una sesion de portal valida, el job queda ligado a ese cliente
    // para su saldo. Sin sesion el flujo invitado sigue funcionando igual.
    let clientUserId: string | undefined;
    const sessionToken = extractBearerToken(request.headers.authorization);
    if (sessionToken) {
      try {
        const user = authService.authenticate(sessionToken);
        if (user.role === 'CLIENT') clientUserId = user.id;
      } catch {
        // Token invalido o expirado: se trata como job de invitado.
      }
    }
    const result = await jobService.create(input, clientUserId);
    request.log.info(
      { requestId: request.id, jobId: result.jobId, providerId: result.provider.id },
      'job_created',
    );
    return reply.code(201).send(result);
  });

  app.get('/v1/jobs', async (request) => {
    const parsed = JobListQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError(zodDetails(parsed.error));
    const filters: { status?: JobStatus; providerId?: string } = {
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.providerId ? { providerId: parsed.data.providerId } : {}),
    };
    return { jobs: jobService.list(filters) };
  });

  app.get('/v1/jobs/:id', async (request) => {
    const parsed = IdParamsSchema.safeParse(request.params);
    if (!parsed.success) throw validationError(zodDetails(parsed.error));
    return { job: jobService.get(parsed.data.id) };
  });

  app.patch('/v1/jobs/:id/progress', async (request) => {
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success) throw validationError(zodDetails(params.error));
    const body = JobProgressSchema.safeParse(request.body);
    if (!body.success) throw validationError(zodDetails(body.error));
    const patch: JobProgressPatch = {
      ...(body.data.status ? { status: body.data.status } : {}),
      ...(body.data.outputHash ? { outputHash: body.data.outputHash } : {}),
      ...(body.data.verifierOutputHash
        ? { verifierOutputHash: body.data.verifierOutputHash }
        : {}),
      ...(body.data.inputTokens !== undefined ? { inputTokens: body.data.inputTokens } : {}),
      ...(body.data.outputTokens !== undefined ? { outputTokens: body.data.outputTokens } : {}),
      ...(body.data.durationMs !== undefined ? { durationMs: body.data.durationMs } : {}),
      ...(body.data.verificationStatus
        ? { verificationStatus: body.data.verificationStatus }
        : {}),
    };
    const previousStatus = jobService.get(params.data.id).status;
    let job = jobService.updateProgress(params.data.id, executionToken(request.headers), patch);
    request.log.info(
      {
        requestId: request.id,
        jobId: job.id,
        fromStatus: previousStatus,
        toStatus: job.status,
      },
      'job_status_changed',
    );
    // Pago automatico: un job VERIFIED se liquida sin intervencion del usuario.
    // Si el pago falla, el job queda VERIFIED/PAYMENT_FAILED y la UI conserva
    // el boton de reintento manual.
    if (autoSettle && job.status === 'VERIFIED') {
      try {
        const outcome = await settlementService.settle(job.id);
        job = jobService.get(job.id);
        request.log.info(
          { requestId: request.id, jobId: job.id, txHash: outcome.txHash },
          'job_auto_settled',
        );
      } catch (error) {
        job = jobService.get(job.id);
        request.log.warn(
          {
            requestId: request.id,
            jobId: job.id,
            error: error instanceof Error ? error.message : String(error),
          },
          'job_auto_settle_failed',
        );
      }
    }
    // M6: los estados terminales aplican su evento de reputacion (una sola vez).
    const reputation = reputationService.applyForJob(job.id);
    if (reputation.applied) {
      request.log.info(
        {
          requestId: request.id,
          jobId: job.id,
          providerId: reputation.providerId,
          delta: reputation.delta,
        },
        'reputation_applied',
      );
    }
    return { job };
  });
}
