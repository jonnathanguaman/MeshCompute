import type { ProviderPublicDTO, ProviderStatus } from '@meshcompute/contracts';
import type { SqliteDatabase } from '../connection.js';

export type ProviderSource = 'AGENT' | 'PORTAL';

export interface ProviderRecord extends ProviderPublicDTO {
  providerTokenHash: string;
  ownerUserId: string | null;
  source: ProviderSource;
  createdAt: string;
  updatedAt: string;
}

interface ProviderRow {
  id: string;
  name: string;
  qvac_public_key: string;
  wallet_address: string;
  model_key: string;
  model_label: string;
  hardware_label: string;
  price_per_1k_tokens_atomic: string;
  pricing_mode: 'PER_JOB';
  token_symbol: 'mUSDT';
  status: ProviderStatus;
  reputation: number;
  jobs_completed: number;
  jobs_failed: number;
  provider_token_hash: string;
  owner_user_id: string | null;
  description: string;
  source: ProviderSource;
  last_seen: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: ProviderRow): ProviderRecord {
  return {
    id: row.id,
    name: row.name,
    qvacPublicKey: row.qvac_public_key,
    walletAddress: row.wallet_address,
    modelKey: row.model_key,
    modelLabel: row.model_label,
    hardwareLabel: row.hardware_label,
    pricePer1kTokensAtomic: row.price_per_1k_tokens_atomic,
    pricingMode: row.pricing_mode,
    tokenSymbol: row.token_symbol,
    status: row.status,
    reputation: row.reputation,
    jobsCompleted: row.jobs_completed,
    jobsFailed: row.jobs_failed,
    providerTokenHash: row.provider_token_hash,
    ownerUserId: row.owner_user_id,
    description: row.description,
    source: row.source,
    lastSeen: row.last_seen,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ProviderRepository {
  constructor(private readonly database: SqliteDatabase) {}

  findById(id: string): ProviderRecord | undefined {
    const row = this.database.prepare('SELECT * FROM providers WHERE id = ?').get(id) as
      | ProviderRow
      | undefined;
    return row ? mapRow(row) : undefined;
  }

  findByPublicKey(publicKey: string): ProviderRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM providers WHERE qvac_public_key = ?')
      .get(publicKey) as ProviderRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  listByOwner(ownerUserId: string): ProviderRecord[] {
    const rows = this.database
      .prepare('SELECT * FROM providers WHERE owner_user_id = ? ORDER BY created_at ASC')
      .all(ownerUserId) as ProviderRow[];
    return rows.map(mapRow);
  }

  list(status?: ProviderStatus): ProviderRecord[] {
    const rows = status
      ? (this.database
          .prepare(
            `SELECT * FROM providers WHERE status = ?
             ORDER BY reputation DESC, CAST(price_per_1k_tokens_atomic AS INTEGER) ASC, name ASC`,
          )
          .all(status) as ProviderRow[])
      : (this.database
          .prepare(
            `SELECT * FROM providers
             ORDER BY CASE status WHEN 'ONLINE' THEN 0 WHEN 'BUSY' THEN 1 ELSE 2 END,
                      reputation DESC, CAST(price_per_1k_tokens_atomic AS INTEGER) ASC, name ASC`,
          )
          .all() as ProviderRow[]);
    return rows.map(mapRow);
  }

  upsert(input: {
    id: string;
    name: string;
    qvacPublicKey: string;
    walletAddress: string;
    modelKey: string;
    modelLabel: string;
    hardwareLabel: string;
    pricePer1kTokensAtomic: string;
    providerTokenHash: string;
    now: string;
  }): ProviderRecord {
    this.database
      .prepare(
        `INSERT INTO providers (
          id, name, qvac_public_key, wallet_address, model_key, model_label,
          hardware_label, price_per_1k_tokens_atomic, pricing_mode, token_symbol,
          status, reputation, jobs_completed, jobs_failed, provider_token_hash,
          last_seen, created_at, updated_at
        ) VALUES (
          @id, @name, @qvacPublicKey, @walletAddress, @modelKey, @modelLabel,
          @hardwareLabel, @pricePer1kTokensAtomic, 'PER_JOB', 'mUSDT',
          'ONLINE', 95, 0, 0, @providerTokenHash, @now, @now, @now
        )
        ON CONFLICT(qvac_public_key) DO UPDATE SET
          name = excluded.name,
          wallet_address = excluded.wallet_address,
          model_key = excluded.model_key,
          model_label = excluded.model_label,
          hardware_label = excluded.hardware_label,
          price_per_1k_tokens_atomic = excluded.price_per_1k_tokens_atomic,
          pricing_mode = excluded.pricing_mode,
          status = 'ONLINE',
          source = 'AGENT',
          provider_token_hash = excluded.provider_token_hash,
          last_seen = excluded.last_seen,
          updated_at = excluded.updated_at`,
      )
      .run(input);

    const provider = this.findByPublicKey(input.qvacPublicKey);
    if (!provider) throw new Error('Provider upsert did not return a record.');
    return provider;
  }

  insertPortalListing(input: {
    id: string;
    ownerUserId: string;
    name: string;
    qvacPublicKey: string;
    description: string;
    walletAddress: string;
    modelKey: string;
    modelLabel: string;
    hardwareLabel: string;
    pricePer1kTokensAtomic: string;
    providerTokenHash: string;
    now: string;
  }): ProviderRecord {
    this.database
      .prepare(
        `INSERT INTO providers (
          id, name, qvac_public_key, wallet_address, model_key, model_label,
          hardware_label, price_per_1k_tokens_atomic, pricing_mode, token_symbol,
          status, reputation, jobs_completed, jobs_failed, provider_token_hash,
          owner_user_id, description, source, last_seen, created_at, updated_at
        ) VALUES (
          @id, @name, @qvacPublicKey, @walletAddress, @modelKey, @modelLabel,
          @hardwareLabel, @pricePer1kTokensAtomic, 'PER_JOB', 'mUSDT',
          'ONLINE', 95, 0, 0, @providerTokenHash,
          @ownerUserId, @description, 'PORTAL', @now, @now, @now
        )`,
      )
      .run(input);
    const provider = this.findById(input.id);
    if (!provider) throw new Error('Portal listing insert did not return a record.');
    return provider;
  }

  updatePortalListing(input: {
    targetId: string;
    name: string;
    qvacPublicKey: string;
    description: string;
    walletAddress: string;
    modelKey: string;
    modelLabel: string;
    hardwareLabel: string;
    pricePer1kTokensAtomic: string;
    now: string;
  }): ProviderRecord {
    this.database
      .prepare(
        `UPDATE providers SET
          name = @name,
          qvac_public_key = @qvacPublicKey,
          description = @description,
          wallet_address = @walletAddress,
          model_key = @modelKey,
          model_label = @modelLabel,
          hardware_label = @hardwareLabel,
          price_per_1k_tokens_atomic = @pricePer1kTokensAtomic,
          status = 'ONLINE',
          source = 'PORTAL',
          last_seen = @now,
          updated_at = @now
        WHERE id = @targetId`,
      )
      .run(input);
    const provider = this.findById(input.targetId);
    if (!provider) throw new Error('Portal listing update did not return a record.');
    return provider;
  }

  /** Transicion condicional de status: solo aplica si el estado actual coincide. */
  updateStatusIf(id: string, from: ProviderStatus, to: ProviderStatus, now: string): boolean {
    const result = this.database
      .prepare('UPDATE providers SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
      .run(to, now, id, from);
    return result.changes === 1;
  }

  /** M6: aplica un delta de reputacion con clamp 0..100 y actualiza contadores. */
  applyReputationEvent(
    id: string,
    delta: number,
    outcome: 'COMPLETED' | 'FAILED',
    now: string,
  ): void {
    this.database
      .prepare(
        `UPDATE providers SET
          reputation = MAX(0, MIN(100, reputation + @delta)),
          jobs_completed = jobs_completed + @completed,
          jobs_failed = jobs_failed + @failed,
          updated_at = @now
        WHERE id = @id`,
      )
      .run({
        id,
        delta,
        completed: outcome === 'COMPLETED' ? 1 : 0,
        failed: outcome === 'FAILED' ? 1 : 0,
        now,
      });
  }

  claimOwnership(id: string, ownerUserId: string, now: string): void {
    this.database
      .prepare('UPDATE providers SET owner_user_id = ?, updated_at = ? WHERE id = ?')
      .run(ownerUserId, now, id);
  }

  recordHeartbeat(id: string, now: string): void {
    // Un heartbeat no debe pisar BUSY: el provider sigue vivo pero ocupado.
    this.database
      .prepare(
        `UPDATE providers
         SET last_seen = ?,
             status = CASE WHEN status = 'BUSY' THEN 'BUSY' ELSE 'ONLINE' END,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(now, now, id);
  }

  markOfflineBefore(cutoff: string, now: string): number {
    const result = this.database
      .prepare(
        `UPDATE providers
         SET status = 'OFFLINE', updated_at = ?
         WHERE status != 'OFFLINE' AND last_seen < ? AND source = 'AGENT'`,
      )
      .run(now, cutoff);
    return result.changes;
  }
}
