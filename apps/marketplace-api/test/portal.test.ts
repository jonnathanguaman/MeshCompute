import type {
  AuthSessionResponse,
  ClientWalletSummary,
  ContractDTO,
  JobMetadataDTO,
  ProviderPublicDTO,
  ProviderWalletSummary,
} from '@meshcompute/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMarketplaceApp, type MarketplaceContext } from '../src/app.js';
import { loadConfig, type MarketplaceConfig } from '../src/config.js';
import { openDatabase, type SqliteDatabase } from '../src/db/connection.js';

const config: MarketplaceConfig = {
  ...loadConfig({}),
  DATABASE_URL: ':memory:',
  LOG_LEVEL: 'silent',
};

const listingPayload = {
  name: 'PC remota QVAC',
  qvacPublicKey: 'portal-public-key-0000000001',
  description: 'Llama 1B instruct, ideal para resumenes.',
  modelKey: 'demo-llm',
  modelLabel: 'Llama-3.2-1B-Instruct',
  hardwareLabel: 'RTX-4070',
  pricePer1kTokensAtomic: '2000',
  walletAddress: '0x0000000000000000000000000000000000000001',
};

describe('Portal accounts and contracts', () => {
  let app: FastifyInstance;
  let context: MarketplaceContext;
  let database: SqliteDatabase;
  let clock: Date;

  beforeEach(async () => {
    clock = new Date('2026-08-22T10:00:00.000Z');
    database = openDatabase(':memory:');
    const built = await buildMarketplaceApp({
      config,
      database,
      now: () => new Date(clock),
      logger: false,
      startOfflineMonitor: false,
    });
    app = built.app;
    context = built.context;
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  async function signUp(role: 'PROVIDER' | 'CLIENT', email: string): Promise<AuthSessionResponse> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email, password: 'super-secret-1', role, displayName: `${role} user` },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as AuthSessionResponse;
  }

  function bearer(session: AuthSessionResponse): Record<string, string> {
    return { authorization: `Bearer ${session.token}` };
  }

  it('registers, logs in and resolves the session user', async () => {
    const session = await signUp('CLIENT', 'client@example.com');
    expect(session.user.role).toBe('CLIENT');
    expect(session.token.length).toBeGreaterThan(20);

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'client@example.com', password: 'super-secret-1' },
    });
    expect(login.statusCode).toBe(200);

    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(session) });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { user: { email: string } }).user.email).toBe('client@example.com');

    const badLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'client@example.com', password: 'wrong-password' },
    });
    expect(badLogin.statusCode).toBe(401);
  });

  it('rejects duplicate emails and unauthenticated portal access', async () => {
    await signUp('CLIENT', 'dup@example.com');
    const duplicate = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        email: 'dup@example.com',
        password: 'super-secret-1',
        role: 'CLIENT',
        displayName: 'Duplicate',
      },
    });
    expect(duplicate.statusCode).toBe(409);

    const anonymous = await app.inject({ method: 'GET', url: '/v1/portal/provider/listings' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('publishes a portal listing visible in the public marketplace and immune to the offline sweep', async () => {
    const provider = await signUp('PROVIDER', 'provider@example.com');
    const publish = await app.inject({
      method: 'POST',
      url: '/v1/portal/provider/listings',
      headers: bearer(provider),
      payload: listingPayload,
    });
    expect(publish.statusCode).toBe(201);
    const { listing } = publish.json() as { listing: ProviderPublicDTO };
    expect(listing.status).toBe('ONLINE');
    expect(listing.description).toBe(listingPayload.description);

    const list = await app.inject({ method: 'GET', url: '/v1/providers' });
    const { providers } = list.json() as { providers: ProviderPublicDTO[] };
    expect(providers.map((item) => item.id)).toContain(listing.id);

    // El sweep de OFFLINE no debe tocar ofertas publicadas via portal.
    clock = new Date(clock.getTime() + 10 * 60_000);
    context.providerService.markStaleProvidersOffline();
    const after = await app.inject({ method: 'GET', url: `/v1/providers/${listing.id}` });
    expect((after.json() as { provider: ProviderPublicDTO }).provider.status).toBe('ONLINE');

    // Re-publicar actualiza la misma fila en lugar de duplicarla.
    const update = await app.inject({
      method: 'POST',
      url: '/v1/portal/provider/listings',
      headers: bearer(provider),
      payload: { ...listingPayload, pricePer1kTokensAtomic: '3000' },
    });
    expect((update.json() as { listing: ProviderPublicDTO }).listing.id).toBe(listing.id);
    const relisted = await app.inject({ method: 'GET', url: '/v1/providers' });
    const rows = (relisted.json() as { providers: ProviderPublicDTO[] }).providers;
    expect(rows.filter((item) => item.qvacPublicKey === listingPayload.qvacPublicKey)).toHaveLength(1);
  });

  it('runs the full hire flow: request, provider accepts, client sees it', async () => {
    const provider = await signUp('PROVIDER', 'provider@example.com');
    const client = await signUp('CLIENT', 'client@example.com');
    const publish = await app.inject({
      method: 'POST',
      url: '/v1/portal/provider/listings',
      headers: bearer(provider),
      payload: listingPayload,
    });
    const { listing } = publish.json() as { listing: ProviderPublicDTO };

    const hire = await app.inject({
      method: 'POST',
      url: '/v1/portal/contracts',
      headers: bearer(client),
      payload: { providerId: listing.id, message: 'Necesito resumenes diarios.' },
    });
    expect(hire.statusCode).toBe(201);
    const { contract } = hire.json() as { contract: ContractDTO };
    expect(contract.status).toBe('REQUESTED');
    expect(contract.pricePer1kTokensAtomic).toBe(listingPayload.pricePer1kTokensAtomic);

    // Un segundo contrato abierto con el mismo proveedor se rechaza.
    const dupHire = await app.inject({
      method: 'POST',
      url: '/v1/portal/contracts',
      headers: bearer(client),
      payload: { providerId: listing.id },
    });
    expect(dupHire.statusCode).toBe(409);

    // El cliente no puede aceptar; solo el proveedor dueno.
    const clientAccept = await app.inject({
      method: 'POST',
      url: `/v1/portal/contracts/${contract.id}/accept`,
      headers: bearer(client),
    });
    expect(clientAccept.statusCode).toBe(403);

    const accept = await app.inject({
      method: 'POST',
      url: `/v1/portal/contracts/${contract.id}/accept`,
      headers: bearer(provider),
    });
    expect(accept.statusCode).toBe(200);
    expect((accept.json() as { contract: ContractDTO }).contract.status).toBe('ACCEPTED');

    const clientView = await app.inject({
      method: 'GET',
      url: '/v1/portal/client/contracts',
      headers: bearer(client),
    });
    const clientContracts = (clientView.json() as { contracts: ContractDTO[] }).contracts;
    expect(clientContracts).toHaveLength(1);
    expect(clientContracts[0]?.status).toBe('ACCEPTED');
    expect(clientContracts[0]?.providerQvacPublicKey).toBe(listingPayload.qvacPublicKey);

    const providerView = await app.inject({
      method: 'GET',
      url: '/v1/portal/provider/contracts',
      headers: bearer(provider),
    });
    expect((providerView.json() as { contracts: ContractDTO[] }).contracts).toHaveLength(1);

    // Aceptado ya no es cancelable por el cliente.
    const cancel = await app.inject({
      method: 'POST',
      url: `/v1/portal/contracts/${contract.id}/cancel`,
      headers: bearer(client),
    });
    expect(cancel.statusCode).toBe(409);
  });

  it('auto-settles a verified job and reflects it in both wallets', async () => {
    const provider = await signUp('PROVIDER', 'provider@example.com');
    const client = await signUp('CLIENT', 'client@example.com');
    const publish = await app.inject({
      method: 'POST',
      url: '/v1/portal/provider/listings',
      headers: bearer(provider),
      payload: listingPayload,
    });
    const { listing } = publish.json() as { listing: ProviderPublicDTO };

    // El job se crea con la sesion del cliente: queda ligado a su saldo.
    const creation = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: bearer(client),
      payload: { providerId: listing.id, modelKey: listing.modelKey, promptHash: 'a'.repeat(64) },
    });
    expect(creation.statusCode).toBe(201);
    const created = creation.json() as { jobId: string; executionToken: string };

    for (const payload of [
      { status: 'CONNECTING' },
      { status: 'RUNNING' },
      { status: 'VERIFYING', outputHash: 'b'.repeat(64) },
    ]) {
      const progress = await app.inject({
        method: 'PATCH',
        url: `/v1/jobs/${created.jobId}/progress`,
        headers: { 'x-execution-token': created.executionToken },
        payload,
      });
      expect(progress.statusCode).toBe(200);
    }

    // Al marcar VERIFIED, la liquidacion corre sola (adapter SIMULATED).
    const verified = await app.inject({
      method: 'PATCH',
      url: `/v1/jobs/${created.jobId}/progress`,
      headers: { 'x-execution-token': created.executionToken },
      payload: { status: 'VERIFIED' },
    });
    expect(verified.statusCode).toBe(200);
    const settledJob = (verified.json() as { job: JobMetadataDTO }).job;
    expect(settledJob.status).toBe('PAID');
    expect(settledJob.paymentStatus).toBe('PAID');
    expect(settledJob.settledAmountAtomic).toBe(listingPayload.pricePer1kTokensAtomic);

    const clientWallet = await app.inject({
      method: 'GET',
      url: '/v1/portal/wallet',
      headers: bearer(client),
    });
    const clientSummary = (clientWallet.json() as { wallet: ClientWalletSummary }).wallet;
    expect(clientSummary).toMatchObject({
      role: 'CLIENT',
      spentAtomic: '2000',
      balanceAtomic: '99998000',
      jobsPaid: 1,
    });

    const providerWallet = await app.inject({
      method: 'GET',
      url: '/v1/portal/wallet',
      headers: bearer(provider),
    });
    const providerSummary = (providerWallet.json() as { wallet: ProviderWalletSummary }).wallet;
    expect(providerSummary).toMatchObject({
      role: 'PROVIDER',
      earnedAtomic: '2000',
      jobsPaid: 1,
      listings: 1,
      walletAddress: listingPayload.walletAddress,
    });
  });

  it('rejects toy wallet addresses on registration and portal listings', async () => {
    const badWallets = ['0xProviderWalletOne', '0x123', 'not-a-wallet', `0x${'g'.repeat(40)}`];
    const { description: _description, ...registerPayload } = listingPayload;

    for (const walletAddress of badWallets) {
      const register = await app.inject({
        method: 'POST',
        url: '/v1/providers/register',
        payload: { ...registerPayload, walletAddress },
      });
      expect(register.statusCode).toBe(400);
      expect((register.json() as { code: string }).code).toBe('VALIDATION_ERROR');
    }

    const provider = await signUp('PROVIDER', 'wallets@example.com');
    const listing = await app.inject({
      method: 'POST',
      url: '/v1/portal/provider/listings',
      headers: bearer(provider),
      payload: { ...listingPayload, walletAddress: '0xProviderWalletOne' },
    });
    expect(listing.statusCode).toBe(400);

    // Una direccion EVM real (0x + 40 hex) si pasa.
    const valid = await app.inject({
      method: 'POST',
      url: '/v1/portal/provider/listings',
      headers: bearer(provider),
      payload: listingPayload,
    });
    expect(valid.statusCode).toBe(201);
  });

  it('lets a provider publish and manage several machines', async () => {
    const provider = await signUp('PROVIDER', 'provider@example.com');
    const other = await signUp('PROVIDER', 'other@example.com');

    const first = await app.inject({
      method: 'POST',
      url: '/v1/portal/provider/listings',
      headers: bearer(provider),
      payload: listingPayload,
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: 'POST',
      url: '/v1/portal/provider/listings',
      headers: bearer(provider),
      payload: {
        ...listingPayload,
        name: 'Servidor GPU 2',
        qvacPublicKey: 'portal-public-key-0000000002',
        pricePer1kTokensAtomic: '5000',
      },
    });
    expect(second.statusCode).toBe(201);
    const secondListing = (second.json() as { listing: ProviderPublicDTO }).listing;

    // Ambas maquinas del mismo usuario, visibles en su portal y en el publico.
    const mine = await app.inject({
      method: 'GET',
      url: '/v1/portal/provider/listings',
      headers: bearer(provider),
    });
    expect((mine.json() as { listings: ProviderPublicDTO[] }).listings).toHaveLength(2);
    const publicList = await app.inject({ method: 'GET', url: '/v1/providers' });
    expect((publicList.json() as { providers: ProviderPublicDTO[] }).providers).toHaveLength(2);

    // Otro usuario no puede publicar una clave ya reclamada.
    const stolen = await app.inject({
      method: 'POST',
      url: '/v1/portal/provider/listings',
      headers: bearer(other),
      payload: listingPayload,
    });
    expect(stolen.statusCode).toBe(409);

    // Edicion por id de una maquina concreta.
    const updated = await app.inject({
      method: 'POST',
      url: `/v1/portal/provider/listings/${secondListing.id}`,
      headers: bearer(provider),
      payload: {
        ...listingPayload,
        name: 'Servidor GPU 2 (rebajado)',
        qvacPublicKey: 'portal-public-key-0000000002',
        pricePer1kTokensAtomic: '4000',
      },
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { listing: ProviderPublicDTO }).listing).toMatchObject({
      id: secondListing.id,
      name: 'Servidor GPU 2 (rebajado)',
      pricePer1kTokensAtomic: '4000',
    });

    // No se puede editar la maquina de otro, ni pisar la clave de otra maquina.
    const foreign = await app.inject({
      method: 'POST',
      url: `/v1/portal/provider/listings/${secondListing.id}`,
      headers: bearer(other),
      payload: listingPayload,
    });
    expect(foreign.statusCode).toBe(403);
    const keyClash = await app.inject({
      method: 'POST',
      url: `/v1/portal/provider/listings/${secondListing.id}`,
      headers: bearer(provider),
      payload: listingPayload,
    });
    expect(keyClash.statusCode).toBe(409);

    const wallet = await app.inject({
      method: 'GET',
      url: '/v1/portal/wallet',
      headers: bearer(provider),
    });
    expect((wallet.json() as { wallet: ProviderWalletSummary }).wallet).toMatchObject({
      role: 'PROVIDER',
      listings: 2,
    });
  });
});
