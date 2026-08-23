import { randomUUID } from 'node:crypto';
import type { PaymentAdapterMode, PaymentResult } from '@meshcompute/payment-adapter';
import type { SqliteDatabase } from '../connection.js';

export type PaymentAttemptStatus = 'PENDING' | 'SUBMITTED' | 'PAID' | 'FAILED';

export interface PaymentAttemptRecord {
  id: string;
  jobId: string;
  providerId: string;
  recipientAddress: string;
  senderAddress?: string;
  tokenAddress?: string;
  amountAtomic: string;
  feeAtomic?: string;
  chainId?: number;
  mode: PaymentAdapterMode;
  status: PaymentAttemptStatus;
  txHash?: string;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
}

interface PaymentAttemptRow {
  id: string;
  job_id: string;
  provider_id: string;
  recipient_address: string;
  sender_address: string | null;
  token_address: string | null;
  amount_atomic: string;
  fee_atomic: string | null;
  chain_id: number | null;
  mode: PaymentAdapterMode;
  status: PaymentAttemptStatus;
  tx_hash: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: PaymentAttemptRow): PaymentAttemptRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    providerId: row.provider_id,
    recipientAddress: row.recipient_address,
    amountAtomic: row.amount_atomic,
    mode: row.mode,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.sender_address ? { senderAddress: row.sender_address } : {}),
    ...(row.token_address ? { tokenAddress: row.token_address } : {}),
    ...(row.fee_atomic ? { feeAtomic: row.fee_atomic } : {}),
    ...(row.chain_id !== null ? { chainId: row.chain_id } : {}),
    ...(row.tx_hash ? { txHash: row.tx_hash } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
  };
}

export class PaymentAttemptRepository {
  constructor(private readonly database: SqliteDatabase) {}

  create(input: {
    jobId: string;
    providerId: string;
    recipientAddress: string;
    tokenAddress?: string;
    amountAtomic: string;
    mode: PaymentAdapterMode;
    now: string;
  }): PaymentAttemptRecord {
    const id = `pay_${randomUUID()}`;
    this.database
      .prepare(
        `INSERT INTO payment_attempts (
          id, job_id, provider_id, recipient_address, token_address,
          amount_atomic, mode, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
      )
      .run(
        id,
        input.jobId,
        input.providerId,
        input.recipientAddress,
        input.tokenAddress ?? null,
        input.amountAtomic,
        input.mode,
        input.now,
        input.now,
      );
    return this.requireById(id);
  }

  markSubmitted(id: string, result: PaymentResult, now: string): PaymentAttemptRecord {
    this.database
      .prepare(
        `UPDATE payment_attempts
         SET status = 'SUBMITTED', tx_hash = ?, fee_atomic = ?, sender_address = ?,
             chain_id = ?, updated_at = ?
         WHERE id = ? AND status = 'PENDING'`,
      )
      .run(
        result.txHash,
        result.feeAtomic ?? null,
        result.senderAddress ?? null,
        result.chainId ?? null,
        now,
        id,
      );
    return this.requireById(id);
  }

  markPaid(id: string, now: string): PaymentAttemptRecord {
    this.database
      .prepare(
        `UPDATE payment_attempts
         SET status = 'PAID', error_code = NULL, updated_at = ?
         WHERE id = ? AND status = 'SUBMITTED'`,
      )
      .run(now, id);
    return this.requireById(id);
  }

  markFailed(id: string, errorCode: string, now: string): PaymentAttemptRecord {
    this.database
      .prepare(
        `UPDATE payment_attempts
         SET status = 'FAILED', error_code = ?, updated_at = ?
         WHERE id = ? AND status = 'PENDING'`,
      )
      .run(errorCode, now, id);
    return this.requireById(id);
  }

  findByJobId(jobId: string): PaymentAttemptRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM payment_attempts WHERE job_id = ?')
      .get(jobId) as PaymentAttemptRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  countForJob(jobId: string): number {
    const row = this.database
      .prepare('SELECT COUNT(*) AS count FROM payment_attempts WHERE job_id = ?')
      .get(jobId) as { count: number };
    return row.count;
  }

  private requireById(id: string): PaymentAttemptRecord {
    const row = this.database.prepare('SELECT * FROM payment_attempts WHERE id = ?').get(id) as
      | PaymentAttemptRow
      | undefined;
    if (!row) throw new Error('Payment attempt was not persisted.');
    return mapRow(row);
  }
}
