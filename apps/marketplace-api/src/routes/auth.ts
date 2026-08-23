import type { FastifyInstance } from 'fastify';
import { validationError } from '../errors.js';
import { AuthLoginSchema, AuthRegisterSchema, zodDetails } from '../schemas.js';
import { extractBearerToken } from '../security/tokens.js';
import type { AuthService } from '../services/auth-service.js';

export async function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService,
): Promise<void> {
  app.post('/v1/auth/register', async (request, reply) => {
    const parsed = AuthRegisterSchema.safeParse(request.body);
    if (!parsed.success) throw validationError(zodDetails(parsed.error));
    const session = authService.register(parsed.data);
    request.log.info(
      { requestId: request.id, userId: session.user.id, role: session.user.role },
      'user_registered',
    );
    return reply.code(201).send(session);
  });

  app.post('/v1/auth/login', async (request) => {
    const parsed = AuthLoginSchema.safeParse(request.body);
    if (!parsed.success) throw validationError(zodDetails(parsed.error));
    const session = authService.login(parsed.data);
    request.log.info({ requestId: request.id, userId: session.user.id }, 'user_logged_in');
    return session;
  });

  app.get('/v1/auth/me', async (request) => {
    const user = authService.authenticate(extractBearerToken(request.headers.authorization));
    return { user };
  });

  app.post('/v1/auth/logout', async (request) => {
    authService.logout(extractBearerToken(request.headers.authorization));
    return { ok: true };
  });
}
