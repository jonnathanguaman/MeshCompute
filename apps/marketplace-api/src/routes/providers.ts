import type { FastifyInstance } from 'fastify';
import { validationError } from '../errors.js';
import { extractBearerToken } from '../security/tokens.js';
import {
  IdParamsSchema,
  ProviderListQuerySchema,
  ProviderRegisterSchema,
  zodDetails,
} from '../schemas.js';
import type { ProviderService } from '../services/provider-service.js';

export async function registerProviderRoutes(
  app: FastifyInstance,
  providerService: ProviderService,
): Promise<void> {
  app.get('/v1/providers', async (request) => {
    const parsed = ProviderListQuerySchema.safeParse(request.query);
    if (!parsed.success) throw validationError(zodDetails(parsed.error));
    return { providers: providerService.list(parsed.data.status) };
  });

  app.get('/v1/providers/:id', async (request) => {
    const parsed = IdParamsSchema.safeParse(request.params);
    if (!parsed.success) throw validationError(zodDetails(parsed.error));
    return { provider: providerService.get(parsed.data.id) };
  });

  app.post('/v1/providers/register', async (request, reply) => {
    const parsed = ProviderRegisterSchema.safeParse(request.body);
    if (!parsed.success) throw validationError(zodDetails(parsed.error));
    const result = providerService.register(parsed.data);
    request.log.info(
      { requestId: request.id, providerId: result.provider.id },
      'provider_registered',
    );
    return reply.code(201).send(result);
  });

  app.post('/v1/providers/:id/heartbeat', async (request) => {
    const parsed = IdParamsSchema.safeParse(request.params);
    if (!parsed.success) throw validationError(zodDetails(parsed.error));
    const token = extractBearerToken(request.headers.authorization);
    const provider = providerService.heartbeat(parsed.data.id, token);
    request.log.info(
      { requestId: request.id, providerId: provider.id },
      'provider_heartbeat',
    );
    return { provider };
  });
}
