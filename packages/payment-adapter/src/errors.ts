export type PaymentAdapterErrorCode =
  | 'INVALID_PAYMENT_AMOUNT'
  | 'INVALID_RECIPIENT_ADDRESS'
  | 'INVALID_TOKEN_ADDRESS'
  | 'INVALID_TREASURY_SEED'
  | 'INVALID_TESTNET_CHAIN'
  | 'RPC_UNAVAILABLE'
  | 'INSUFFICIENT_TOKEN_BALANCE'
  | 'INSUFFICIENT_GAS_BALANCE'
  | 'PAYMENT_FEE_QUOTE_FAILED'
  | 'PAYMENT_FEE_LIMIT_EXCEEDED'
  | 'PAYMENT_BROADCAST_FAILED';

export class PaymentAdapterError extends Error {
  constructor(
    readonly code: PaymentAdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentAdapterError';
  }
}
