/**
 * Tipos del portal web (cuentas proveedor/cliente y contratos).
 *
 * Extension posterior a H1: no toca los DTOs congelados de dto.ts.
 * Mantiene la regla de privacidad del doc 00 §1.3: aqui solo viajan
 * metadatos de cuenta y de contratacion, nunca contenido de inferencia.
 */

export const USER_ROLES = ['PROVIDER', 'CLIENT'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const CONTRACT_STATUSES = [
  'REQUESTED',
  'ACCEPTED',
  'REJECTED',
  'CANCELLED',
  'COMPLETED',
  'EXPIRED',
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export interface UserDTO {
  id: string;
  email: string;
  role: UserRole;
  displayName: string;
  createdAt: string;
}

export interface AuthRegisterRequest {
  email: string;
  password: string;
  role: UserRole;
  displayName: string;
}

export interface AuthLoginRequest {
  email: string;
  password: string;
}

export interface AuthSessionResponse {
  user: UserDTO;
  token: string;
  expiresAt: string;
}

/** Oferta que un proveedor publica manualmente desde su portal. */
export interface ProviderListingUpsertRequest {
  name: string;
  qvacPublicKey: string;
  description: string;
  modelKey: string;
  modelLabel: string;
  hardwareLabel: string;
  pricePer1kTokensAtomic: string;
  walletAddress: string;
}

export interface ContractCreateRequest {
  providerId: string;
  message?: string | undefined;
}

/** Saldo demo del cliente: credito inicial menos lo pagado en jobs. */
export interface ClientWalletSummary {
  role: 'CLIENT';
  initialCreditAtomic: string;
  spentAtomic: string;
  balanceAtomic: string;
  jobsPaid: number;
}

/** Saldo del proveedor: total cobrado por los jobs pagados de todas sus maquinas. */
export interface ProviderWalletSummary {
  role: 'PROVIDER';
  earnedAtomic: string;
  jobsPaid: number;
  /** Numero de maquinas publicadas por este usuario. */
  listings: number;
  walletAddress: string | null;
}

export type WalletSummaryDTO = ClientWalletSummary | ProviderWalletSummary;

export interface ContractDTO {
  id: string;
  providerId: string;
  clientUserId: string;
  status: ContractStatus;
  /** Snapshot del precio al momento de contratar. */
  pricePer1kTokensAtomic: string;
  modelLabel: string;
  message: string;
  /** Limite de vigencia: al vencer, el contrato pasa a EXPIRED. Null en filas legadas. */
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Datos denormalizados para render directo en ambos portales. */
  providerName: string;
  providerQvacPublicKey: string;
  providerWalletAddress: string;
  clientDisplayName: string;
}
