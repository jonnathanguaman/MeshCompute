import type { JobSettlementPort, JobSettlementView } from '@meshcompute/contracts';
import {
  PaymentAdapterError,
  type PaymentAdapter,
  type PaymentResult,
} from '@meshcompute/payment-adapter';
import type { SqliteDatabase } from '../db/connection.js';
import { PaymentAttemptRepository } from '../db/economy/payment-attempt-repository.js';
import { AppError } from '../errors.js';

export interface SettlementOutcome {
  idempotent: boolean;
  txHash?: string;
}

export class SettlementService {
  private readonly now: () => Date;

  constructor(
    database: SqliteDatabase,
    private readonly jobPort: JobSettlementPort,
    private readonly paymentAdapter: PaymentAdapter,
    private readonly attempts: PaymentAttemptRepository,
    now?: () => Date,
    settleByTokens = false,
  ) {
    this.database = database;
    this.now = now ?? (() => new Date());
    this.settleByTokens = settleByTokens;
  }

  private readonly database: SqliteDatabase;
  private readonly settleByTokens: boolean;

  /**
   * Doc B §19: por defecto se liquida el precio fijo PER_JOB cotizado. Con
   * SETTLE_BY_TOKENS=true, el monto es ceil(tokens/1000) * tarifa cotizada,
   * usando los tokens reales reportados por el Consumer Agent.
   */
  private settleAmount(view: JobSettlementView): string {
    if (!this.settleByTokens) return view.quotedAmountAtomic;
    const totalTokens = (view.inputTokens ?? 0) + (view.outputTokens ?? 0);
    if (totalTokens <= 0) return view.quotedAmountAtomic;
    const blocks = BigInt(Math.ceil(totalTokens / 1000));
    return (blocks * BigInt(view.quotedAmountAtomic)).toString();
  }

  async settle(jobId: string): Promise<SettlementOutcome> {
    const initial = this.jobPort.getForSettlement(jobId);
    if (initial.status === 'PAID' && initial.paymentStatus === 'PAID') {
      return { idempotent: true, ...(initial.paymentTxHash ? { txHash: initial.paymentTxHash } : {}) };
    }
    if (initial.status === 'PAYMENT_PENDING') {
      throw new AppError(409, 'PAYMENT_IN_PROGRESS', 'Settlement is already in progress.');
    }
    if (initial.status !== 'VERIFIED') {
      throw new AppError(409, 'JOB_NOT_VERIFIED', 'Only a verified job can be settled.');
    }

    const startedAt = this.now().toISOString();
    const amountAtomic = this.settleAmount(initial);
    const attempt = this.database.transaction(() => {
      const current = this.jobPort.getForSettlement(jobId);
      if (current.status !== 'VERIFIED') {
        throw new AppError(409, 'PAYMENT_IN_PROGRESS', 'Settlement is already in progress.');
      }
      this.jobPort.markPaymentPending(jobId);
      return this.attempts.create({
        jobId,
        providerId: current.providerId,
        recipientAddress: current.walletAddress,
        ...(this.paymentAdapter.tokenAddress
          ? { tokenAddress: this.paymentAdapter.tokenAddress }
          : {}),
        amountAtomic,
        mode: this.paymentAdapter.mode,
        now: startedAt,
      });
    })();

    let result: PaymentResult;
    try {
      result = await this.paymentAdapter.settle({
        jobId,
        recipient: initial.walletAddress,
        amountAtomic,
      });
    } catch (error) {
      const reasonCode = error instanceof PaymentAdapterError ? error.code : 'PAYMENT_BROADCAST_FAILED';
      this.database.transaction(() => {
        this.attempts.markFailed(attempt.id, reasonCode, this.now().toISOString());
        this.jobPort.markPaymentFailed(jobId, reasonCode);
      })();
      throw new AppError(502, 'PAYMENT_FAILED', 'The testnet settlement could not be completed.', {
        reasonCode,
      });
    }

    this.attempts.markSubmitted(attempt.id, result, this.now().toISOString());
    try {
      this.database.transaction(() => {
        this.jobPort.markPaid(jobId, result.txHash, result.mode, amountAtomic);
        this.attempts.markPaid(attempt.id, this.now().toISOString());
      })();
    } catch {
      throw new AppError(
        500,
        'PAYMENT_RECONCILIATION_REQUIRED',
        'The testnet transaction was submitted but local settlement finalization failed.',
        { txHash: result.txHash },
      );
    }
    return { idempotent: false, txHash: result.txHash };
  }
}
