/**
 * Servidor HTTP local del Consumer Agent. Doc 01 §15-§17.
 *
 * Reglas duras:
 *   CA-001  escucha SOLO en 127.0.0.1, nunca 0.0.0.0;
 *   CA-002  CORS unicamente desde WEB_ORIGIN, nunca '*';
 *   CA-008  los logs no imprimen el prompt (request logging desactivado).
 */

import cors from '@fastify/cors';
import type { Logger } from '@meshcompute/config';
import {
  LocalInferenceRequestSchema,
  type LocalHealthResponse,
} from '@meshcompute/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import type { QvacConsumerService } from '@meshcompute/qvac-adapter';
import type { ConsumerConfig } from './config.js';
import { ConsumerError } from './errors.js';
import type { InferenceService } from './inference-service.js';

export interface ServerDeps {
  config: ConsumerConfig;
  logger: Logger;
  qvac: QvacConsumerService;
  inference: InferenceService;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { config, logger, qvac, inference } = deps;

  const app = Fastify({
    // CA-008: Fastify no debe volcar el body en los logs. El prompt entra por
    // aqui y no puede aparecer en ningun sitio.
    disableRequestLogging: true,
    logger: false,
    bodyLimit: 1_000_000,
  });

  // CA-002: origen exacto. Un '*' aqui permitiria a cualquier pagina abierta
  // en el navegador usar el agente local del usuario.
  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: false,
  });

  // ------------------------------------------------------------------ health
  app.get('/health', async (): Promise<LocalHealthResponse> => {
    return {
      status: 'ok',
      service: 'consumer-agent',
      qvacReady: qvac.isReady(),
    };
  });

  // --------------------------------------------------------------- inference
  app.post('/v1/inference', async (request, reply) => {
    const parsed = LocalInferenceRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      const error = new ConsumerError('INVALID_REQUEST', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return reply.status(error.httpStatus).send(error.toDTO());
    }

    try {
      const response = await inference.run(parsed.data);
      return reply.status(200).send(response);
    } catch (error) {
      if (error instanceof ConsumerError) {
        // El mensaje ya es legible para la UI (CA-009).
        return reply.status(error.httpStatus).send(error.toDTO());
      }
      // Nunca devolver el error crudo: podria arrastrar fragmentos del body.
      logger.error({
        event: 'inference_unhandled_error',
        jobId: parsed.data.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      const fallback = new ConsumerError('PROVIDER_UNREACHABLE');
      return reply.status(fallback.httpStatus).send(fallback.toDTO());
    }
  });

  // ------------------------------------------------------------------ cancel
  // Opcional segun doc 00 §29.
  app.post<{ Params: { jobId: string } }>('/v1/inference/:jobId/cancel', async (request, reply) => {
    logger.info({ event: 'inference_cancel_requested', jobId: request.params.jobId });
    return reply.status(202).send({ jobId: request.params.jobId, accepted: true });
  });

  // Handler de errores global: garantiza que nunca se serialice el request.
  app.setErrorHandler((error: unknown, request, reply) => {
    logger.error({
      event: 'server_error',
      route: request.url,
      error: error instanceof Error ? error.message : String(error),
    });
    const fallback = new ConsumerError('INVALID_REQUEST');
    void reply.status(fallback.httpStatus).send(fallback.toDTO());
  });

  return app;
}
