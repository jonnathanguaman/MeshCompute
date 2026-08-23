/**
 * DTOs de la frontera entre integrantes.
 *
 * Doc 00 §8. CONGELADO despues de H1.
 *
 * REGLA DE PRIVACIDAD (doc 00 §1.3): ningun tipo de este archivo que viaje
 * hacia la API central puede contener prompt, respuesta generada, documentos
 * del usuario, historial ni contenido de inferencia.
 */

import type {
  JobStatus,
  PaymentMode,
  PaymentStatus,
  PricingMode,
  ProviderStatus,
  VerificationStatus,
} from './enums.js';

export interface ProviderPublicDTO {
  id: string;
  name: string;
  qvacPublicKey: string;
  walletAddress: string;
  modelKey: string;
  modelLabel: string;
  hardwareLabel: string;
  pricePer1kTokensAtomic: string;
  pricingMode: PricingMode;
  tokenSymbol: 'mUSDT';
  status: ProviderStatus;
  reputation: number;
  jobsCompleted: number;
  jobsFailed: number;
  lastSeen: string;
  /** Campo opcional agregado post-H1 para las ofertas publicadas via portal. */
  description?: string;
}

export interface ProviderRegisterRequest {
  name: string;
  qvacPublicKey: string;
  walletAddress: string;
  modelKey: string;
  modelLabel: string;
  hardwareLabel: string;
  pricePer1kTokensAtomic: string;
  pricingMode?: PricingMode;
}

export interface ProviderRegisterResponse {
  provider: ProviderPublicDTO;
  providerToken: string;
}

/** No contiene prompt. Doc 00 §8. */
export interface JobCreateRequest {
  providerId: string;
  verifierProviderId?: string;
  modelKey: string;
  promptHash: string;
  consumerWallet?: string;
}

export interface JobCreateResponse {
  jobId: string;
  executionToken: string;
  provider: ProviderPublicDTO;
  verifier?: ProviderPublicDTO;
  status: 'ASSIGNED';
  quotedAmountAtomic: string;
}

/** No contiene output. Doc 00 §8. */
export interface JobMetadataDTO {
  id: string;
  providerId: string;
  verifierProviderId?: string;
  modelKey: string;

  promptHash: string;
  outputHash?: string;
  verifierOutputHash?: string;

  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;

  quotedAmountAtomic: string;
  settledAmountAtomic?: string;

  status: JobStatus;
  verificationStatus: VerificationStatus;
  paymentStatus: PaymentStatus;
  paymentMode?: PaymentMode;
  paymentTxHash?: string;
  paymentErrorCode?: string;

  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface JobProgressPatch {
  status?: JobStatus;
  outputHash?: string;
  verifierOutputHash?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  verificationStatus?: VerificationStatus;
}

export interface ApiErrorDTO {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
