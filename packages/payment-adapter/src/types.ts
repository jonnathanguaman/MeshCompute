export type PaymentAdapterMode = 'SIMULATED' | 'WDK_TESTNET';

export interface PaymentRequest {
  jobId: string;
  recipient: string;
  amountAtomic: string;
}

export interface PaymentResult {
  status: 'PAID';
  mode: PaymentAdapterMode;
  txHash: string;
  feeAtomic?: string;
  senderAddress?: string;
  chainId?: number;
}

export interface PaymentAdapter {
  readonly mode: PaymentAdapterMode;
  readonly tokenAddress?: string;
  settle(input: PaymentRequest): Promise<PaymentResult>;
  dispose?(): void | Promise<void>;
}
