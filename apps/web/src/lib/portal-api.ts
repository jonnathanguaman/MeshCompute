import type {
  AuthLoginRequest,
  AuthRegisterRequest,
  AuthSessionResponse,
  ContractDTO,
  ProviderListingUpsertRequest,
  ProviderPublicDTO,
  UserDTO,
  WalletSummaryDTO,
} from '@meshcompute/contracts';
import { webConfig } from './config';
import { MarketplaceApiError } from './marketplace-api';

async function portalRequest<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${webConfig.marketplaceApiUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  });
  const body = (await response.json().catch(() => ({}))) as {
    code?: string;
    message?: string;
  } & T;
  if (!response.ok) {
    throw new MarketplaceApiError(
      body.code ?? 'MARKETPLACE_UNAVAILABLE',
      body.message ?? 'Marketplace unavailable.',
      response.status,
    );
  }
  return body;
}

export async function registerAccount(input: AuthRegisterRequest): Promise<AuthSessionResponse> {
  return portalRequest<AuthSessionResponse>('/v1/auth/register', undefined, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function loginAccount(input: AuthLoginRequest): Promise<AuthSessionResponse> {
  return portalRequest<AuthSessionResponse>('/v1/auth/login', undefined, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function logoutAccount(token: string): Promise<void> {
  await portalRequest<{ ok: boolean }>('/v1/auth/logout', token, { method: 'POST' });
}

export async function getCurrentUser(token: string): Promise<UserDTO> {
  const result = await portalRequest<{ user: UserDTO }>('/v1/auth/me', token);
  return result.user;
}

export async function getWallet(token: string): Promise<WalletSummaryDTO> {
  const result = await portalRequest<{ wallet: WalletSummaryDTO }>('/v1/portal/wallet', token);
  return result.wallet;
}

export async function getMyListings(token: string): Promise<ProviderPublicDTO[]> {
  const result = await portalRequest<{ listings: ProviderPublicDTO[] }>(
    '/v1/portal/provider/listings',
    token,
  );
  return result.listings;
}

export async function createListing(
  token: string,
  input: ProviderListingUpsertRequest,
): Promise<ProviderPublicDTO> {
  const result = await portalRequest<{ listing: ProviderPublicDTO }>(
    '/v1/portal/provider/listings',
    token,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return result.listing;
}

export async function updateListing(
  token: string,
  listingId: string,
  input: ProviderListingUpsertRequest,
): Promise<ProviderPublicDTO> {
  const result = await portalRequest<{ listing: ProviderPublicDTO }>(
    `/v1/portal/provider/listings/${encodeURIComponent(listingId)}`,
    token,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return result.listing;
}

export async function getProviderContracts(token: string): Promise<ContractDTO[]> {
  const result = await portalRequest<{ contracts: ContractDTO[] }>(
    '/v1/portal/provider/contracts',
    token,
  );
  return result.contracts;
}

export async function getClientContracts(token: string): Promise<ContractDTO[]> {
  const result = await portalRequest<{ contracts: ContractDTO[] }>(
    '/v1/portal/client/contracts',
    token,
  );
  return result.contracts;
}

export async function requestContract(
  token: string,
  providerId: string,
  message?: string,
): Promise<ContractDTO> {
  const result = await portalRequest<{ contract: ContractDTO }>('/v1/portal/contracts', token, {
    method: 'POST',
    body: JSON.stringify({ providerId, ...(message ? { message } : {}) }),
  });
  return result.contract;
}

async function contractAction(token: string, id: string, action: string): Promise<ContractDTO> {
  const result = await portalRequest<{ contract: ContractDTO }>(
    `/v1/portal/contracts/${encodeURIComponent(id)}/${action}`,
    token,
    { method: 'POST' },
  );
  return result.contract;
}

export const acceptContract = (token: string, id: string) => contractAction(token, id, 'accept');
export const rejectContract = (token: string, id: string) => contractAction(token, id, 'reject');
export const cancelContract = (token: string, id: string) => contractAction(token, id, 'cancel');
