import type {
  JobStatus,
  PaymentMode,
  PaymentStatus,
  PricingMode,
} from './enums.js';
import type { JobMetadataDTO } from './dto.js';

export interface JobSettlementView {
  jobId: string;
  providerId: string;
  status: JobStatus;
  walletAddress: string;
  quotedAmountAtomic: string;
  paymentStatus: PaymentStatus;
  paymentMode?: PaymentMode;
  paymentTxHash?: string;
  /** Metricas reales del job, para settle por tokens (doc B §19 "mejor"). */
  inputTokens?: number;
  outputTokens?: number;
}

export interface ProviderPricingSnapshot {
  providerId: string;
  priceAtomic: string;
  pricingMode: PricingMode;
}

export interface PricingService {
  quote(input: ProviderPricingSnapshot): Promise<{ quotedAmountAtomic: string }>;
}

export interface JobSettlementPort {
  getForSettlement(jobId: string): JobSettlementView;
  markPaymentPending(jobId: string): JobMetadataDTO;
  markPaid(
    jobId: string,
    txHash: string,
    mode: PaymentMode,
    settledAmountAtomic?: string,
  ): JobMetadataDTO;
  markPaymentFailed(jobId: string, code: string): JobMetadataDTO;
}
