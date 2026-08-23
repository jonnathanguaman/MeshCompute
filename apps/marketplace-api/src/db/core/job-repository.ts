import type {
  JobMetadataDTO,
  JobStatus,
  PaymentMode,
  PaymentStatus,
  VerificationStatus,
} from '@meshcompute/contracts';
import type { SqliteDatabase } from '../connection.js';

export interface JobRecord extends JobMetadataDTO {
  providerWalletAddress: string;
  executionTokenHash: string;
  clientUserId: string | null;
  consumerWallet: string | null;
  reputationAppliedAt: string | null;
}

interface JobRow {
  id: string;
  provider_id: string;
  provider_wallet_address: string;
  verifier_provider_id: string | null;
  model_key: string;
  prompt_hash: string;
  output_hash: string | null;
  verifier_output_hash: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  duration_ms: number | null;
  quoted_amount_atomic: string;
  settled_amount_atomic: string | null;
  status: JobStatus;
  verification_status: VerificationStatus;
  payment_status: PaymentStatus;
  payment_mode: PaymentMode | null;
  payment_tx_hash: string | null;
  payment_error_code: string | null;
  execution_token_hash: string;
  client_user_id: string | null;
  consumer_wallet: string | null;
  reputation_applied_at: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function mapRow(row: JobRow): JobRecord {
  const job: JobRecord = {
    id: row.id,
    providerId: row.provider_id,
    modelKey: row.model_key,
    promptHash: row.prompt_hash,
    quotedAmountAtomic: row.quoted_amount_atomic,
    status: row.status,
    verificationStatus: row.verification_status,
    paymentStatus: row.payment_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    providerWalletAddress: row.provider_wallet_address,
    executionTokenHash: row.execution_token_hash,
    clientUserId: row.client_user_id,
    consumerWallet: row.consumer_wallet,
    reputationAppliedAt: row.reputation_applied_at,
  };

  if (row.verifier_provider_id !== null) job.verifierProviderId = row.verifier_provider_id;
  if (row.output_hash !== null) job.outputHash = row.output_hash;
  if (row.verifier_output_hash !== null) job.verifierOutputHash = row.verifier_output_hash;
  if (row.input_tokens !== null) job.inputTokens = row.input_tokens;
  if (row.output_tokens !== null) job.outputTokens = row.output_tokens;
  if (row.duration_ms !== null) job.durationMs = row.duration_ms;
  if (row.settled_amount_atomic !== null) job.settledAmountAtomic = row.settled_amount_atomic;
  if (row.payment_mode !== null) job.paymentMode = row.payment_mode;
  if (row.payment_tx_hash !== null) job.paymentTxHash = row.payment_tx_hash;
  if (row.payment_error_code !== null) job.paymentErrorCode = row.payment_error_code;
  if (row.started_at !== null) job.startedAt = row.started_at;
  if (row.completed_at !== null) job.completedAt = row.completed_at;
  return job;
}

export interface JobProgressUpdate {
  status?: JobStatus;
  outputHash?: string;
  verifierOutputHash?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  verificationStatus?: VerificationStatus;
  paymentStatus?: PaymentStatus;
  paymentMode?: PaymentMode | null;
  paymentTxHash?: string | null;
  paymentErrorCode?: string | null;
  settledAmountAtomic?: string | null;
  startedAt?: string;
  completedAt?: string;
}

const columnByProperty: Record<keyof JobProgressUpdate, string> = {
  status: 'status',
  outputHash: 'output_hash',
  verifierOutputHash: 'verifier_output_hash',
  inputTokens: 'input_tokens',
  outputTokens: 'output_tokens',
  durationMs: 'duration_ms',
  verificationStatus: 'verification_status',
  paymentStatus: 'payment_status',
  paymentMode: 'payment_mode',
  paymentTxHash: 'payment_tx_hash',
  paymentErrorCode: 'payment_error_code',
  settledAmountAtomic: 'settled_amount_atomic',
  startedAt: 'started_at',
  completedAt: 'completed_at',
};

export class JobRepository {
  constructor(private readonly database: SqliteDatabase) {}

  createAndAssign(input: {
    id: string;
    providerId: string;
    providerWalletAddress: string;
    verifierProviderId?: string;
    modelKey: string;
    promptHash: string;
    quotedAmountAtomic: string;
    executionTokenHash: string;
    clientUserId?: string;
    consumerWallet?: string;
    now: string;
  }): JobRecord {
    const operation = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO jobs (
            id, provider_id, provider_wallet_address, verifier_provider_id, model_key,
            prompt_hash, quoted_amount_atomic, status, verification_status,
            payment_status, execution_token_hash, client_user_id, consumer_wallet,
            created_at, updated_at
          ) VALUES (
            @id, @providerId, @providerWalletAddress, @verifierProviderId, @modelKey,
            @promptHash, @quotedAmountAtomic, 'CREATED', 'NOT_REQUESTED',
            'NOT_STARTED', @executionTokenHash, @clientUserId, @consumerWallet,
            @now, @now
          )`,
        )
        .run({
          ...input,
          verifierProviderId: input.verifierProviderId ?? null,
          clientUserId: input.clientUserId ?? null,
          consumerWallet: input.consumerWallet ?? null,
        });

      this.database
        .prepare(`UPDATE jobs SET status = 'ASSIGNED', updated_at = ? WHERE id = ?`)
        .run(input.now, input.id);
    });

    operation();
    const job = this.findById(input.id);
    if (!job) throw new Error('Job insert did not return a record.');
    return job;
  }

  findById(id: string): JobRecord | undefined {
    const row = this.database.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as
      | JobRow
      | undefined;
    return row ? mapRow(row) : undefined;
  }

  list(filters: { status?: JobStatus; providerId?: string } = {}): JobRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.status) {
      clauses.push('status = ?');
      params.push(filters.status);
    }
    if (filters.providerId) {
      clauses.push('provider_id = ?');
      params.push(filters.providerId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.database
      .prepare(`SELECT * FROM jobs ${where} ORDER BY created_at DESC`)
      .all(...params) as JobRow[];
    return rows.map(mapRow);
  }

  /**
   * Marca el job como "reputacion ya aplicada". Devuelve false si otro llamado
   * llego primero: esa es la garantia de idempotencia de M6 (doc B §23).
   */
  markReputationApplied(id: string, now: string): boolean {
    const result = this.database
      .prepare(
        `UPDATE jobs SET reputation_applied_at = ?, updated_at = ?
         WHERE id = ? AND reputation_applied_at IS NULL`,
      )
      .run(now, now, id);
    return result.changes === 1;
  }

  /** Total pagado (settled) y numero de jobs PAID para un cliente o proveedor. */
  paidTotals(filter: { clientUserId?: string; providerId?: string }): {
    totalAtomic: string;
    jobsPaid: number;
  } {
    const clauses = ["payment_status = 'PAID'"];
    const params: unknown[] = [];
    if (filter.clientUserId) {
      clauses.push('client_user_id = ?');
      params.push(filter.clientUserId);
    }
    if (filter.providerId) {
      clauses.push('provider_id = ?');
      params.push(filter.providerId);
    }
    const row = this.database
      .prepare(
        `SELECT COALESCE(SUM(CAST(settled_amount_atomic AS INTEGER)), 0) AS total,
                COUNT(*) AS paid
         FROM jobs WHERE ${clauses.join(' AND ')}`,
      )
      .get(...params) as { total: number; paid: number };
    return { totalAtomic: String(row.total), jobsPaid: row.paid };
  }

  /** Total cobrado por todas las maquinas de un usuario proveedor. */
  paidTotalsByOwner(ownerUserId: string): { totalAtomic: string; jobsPaid: number } {
    const row = this.database
      .prepare(
        `SELECT COALESCE(SUM(CAST(jobs.settled_amount_atomic AS INTEGER)), 0) AS total,
                COUNT(*) AS paid
         FROM jobs
         JOIN providers ON providers.id = jobs.provider_id
         WHERE jobs.payment_status = 'PAID' AND providers.owner_user_id = ?`,
      )
      .get(ownerUserId) as { total: number; paid: number };
    return { totalAtomic: String(row.total), jobsPaid: row.paid };
  }

  updateIfStatus(
    id: string,
    expectedStatus: JobStatus,
    update: JobProgressUpdate,
    now: string,
  ): JobRecord | undefined {
    const entries = Object.entries(update).filter(([, value]) => value !== undefined) as Array<
      [keyof JobProgressUpdate, JobProgressUpdate[keyof JobProgressUpdate]]
    >;
    const assignments = entries.map(([property]) => `${columnByProperty[property]} = ?`);
    const values = entries.map(([, value]) => value);
    assignments.push('updated_at = ?');
    values.push(now);
    values.push(id);
    values.push(expectedStatus);

    const result = this.database
      .prepare(`UPDATE jobs SET ${assignments.join(', ')} WHERE id = ? AND status = ?`)
      .run(...values);

    if (result.changes !== 1) return undefined;

    const job = this.findById(id);
    if (!job) throw new Error('Job update did not return a record.');
    return job;
  }
}
