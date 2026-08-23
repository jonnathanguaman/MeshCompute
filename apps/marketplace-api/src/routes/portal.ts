import type { UserDTO } from '@meshcompute/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { validationError } from '../errors.js';
import {
  ContractCreateSchema,
  IdParamsSchema,
  ProviderListingUpsertSchema,
  zodDetails,
} from '../schemas.js';
import { extractBearerToken } from '../security/tokens.js';
import type { AuthService } from '../services/auth-service.js';
import type { PortalService } from '../services/portal-service.js';

export async function registerPortalRoutes(
  app: FastifyInstance,
  authService: AuthService,
  portalService: PortalService,
): Promise<void> {
  function requireUser(request: FastifyRequest): UserDTO {
    return authService.authenticate(extractBearerToken(request.headers.authorization));
  }

  function parseContractId(request: FastifyRequest): string {
    const parsed = IdParamsSchema.safeParse(request.params);
    if (!parsed.success) throw validationError(zodDetails(parsed.error));
    return parsed.data.id;
  }

  app.get('/v1/portal/wallet', async (request) => {
    const user = requireUser(request);
    return { wallet: portalService.getWallet(user) };
  });

  app.get('/v1/portal/provider/listings', async (request) => {
    const user = requireUser(request);
    return { listings: portalService.getOwnListings(user) };
  });

  app.post('/v1/portal/provider/listings', async (request, reply) => {
    const user = requireUser(request);
    const parsed = ProviderListingUpsertSchema.safeParse(request.body);
    if (!parsed.success) throw validationError(zodDetails(parsed.error));
    const listing = portalService.createListing(user, parsed.data);
    request.log.info(
      { requestId: request.id, userId: user.id, providerId: listing.id },
      'portal_listing_published',
    );
    return reply.code(201).send({ listing });
  });

  app.post('/v1/portal/provider/listings/:id', async (request) => {
    const user = requireUser(request);
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success) throw validationError(zodDetails(params.error));
    const parsed = ProviderListingUpsertSchema.safeParse(request.body);
    if (!parsed.success) throw validationError(zodDetails(parsed.error));
    const listing = portalService.updateListing(user, params.data.id, parsed.data);
    request.log.info(
      { requestId: request.id, userId: user.id, providerId: listing.id },
      'portal_listing_updated',
    );
    return { listing };
  });

  app.get('/v1/portal/provider/contracts', async (request) => {
    const user = requireUser(request);
    return { contracts: portalService.listProviderContracts(user) };
  });

  app.get('/v1/portal/client/contracts', async (request) => {
    const user = requireUser(request);
    return { contracts: portalService.listClientContracts(user) };
  });

  app.post('/v1/portal/contracts', async (request, reply) => {
    const user = requireUser(request);
    const parsed = ContractCreateSchema.safeParse(request.body);
    if (!parsed.success) throw validationError(zodDetails(parsed.error));
    const contract = portalService.createContract(user, parsed.data);
    request.log.info(
      { requestId: request.id, userId: user.id, contractId: contract.id },
      'contract_requested',
    );
    return reply.code(201).send({ contract });
  });

  app.post('/v1/portal/contracts/:id/accept', async (request) => {
    const user = requireUser(request);
    const contract = portalService.resolveContract(user, parseContractId(request), true);
    request.log.info({ requestId: request.id, contractId: contract.id }, 'contract_accepted');
    return { contract };
  });

  app.post('/v1/portal/contracts/:id/reject', async (request) => {
    const user = requireUser(request);
    const contract = portalService.resolveContract(user, parseContractId(request), false);
    request.log.info({ requestId: request.id, contractId: contract.id }, 'contract_rejected');
    return { contract };
  });

  app.post('/v1/portal/contracts/:id/cancel', async (request) => {
    const user = requireUser(request);
    const contract = portalService.cancelContract(user, parseContractId(request));
    request.log.info({ requestId: request.id, contractId: contract.id }, 'contract_cancelled');
    return { contract };
  });
}
