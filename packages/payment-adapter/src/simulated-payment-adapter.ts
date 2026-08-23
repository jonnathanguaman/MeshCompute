import { randomUUID } from 'node:crypto';
import { PaymentAdapterError } from './errors.js';
import type { PaymentAdapter, PaymentRequest, PaymentResult } from './types.js';

export class SimulatedPaymentAdapter implements PaymentAdapter {
  readonly mode = 'SIMULATED' as const;

  async settle(input: PaymentRequest): Promise<PaymentResult> {
    if (!/^\d+$/.test(input.amountAtomic) || BigInt(input.amountAtomic) <= 0n) {
      throw new PaymentAdapterError('INVALID_PAYMENT_AMOUNT', 'Payment amount must be positive.');
    }
    return {
      status: 'PAID',
      mode: this.mode,
      txHash: `sim_${input.jobId}_${randomUUID()}`,
    };
  }
}
