import type { ContractDTO, ContractStatus } from '@meshcompute/contracts';
import type { SqliteDatabase } from '../connection.js';

interface ContractRow {
  id: string;
  provider_id: string;
  client_user_id: string;
  status: ContractStatus;
  price_per_1k_tokens_atomic: string;
  model_label: string;
  message: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  provider_name: string;
  provider_qvac_public_key: string;
  provider_wallet_address: string;
  client_display_name: string;
}

const CONTRACT_SELECT = `
  SELECT contracts.*,
         providers.name AS provider_name,
         providers.qvac_public_key AS provider_qvac_public_key,
         providers.wallet_address AS provider_wallet_address,
         users.display_name AS client_display_name
  FROM contracts
  JOIN providers ON providers.id = contracts.provider_id
  JOIN users ON users.id = contracts.client_user_id
`;

function mapContract(row: ContractRow): ContractDTO {
  return {
    id: row.id,
    providerId: row.provider_id,
    clientUserId: row.client_user_id,
    status: row.status,
    pricePer1kTokensAtomic: row.price_per_1k_tokens_atomic,
    modelLabel: row.model_label,
    message: row.message,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    providerName: row.provider_name,
    providerQvacPublicKey: row.provider_qvac_public_key,
    providerWalletAddress: row.provider_wallet_address,
    clientDisplayName: row.client_display_name,
  };
}

export class ContractRepository {
  constructor(private readonly database: SqliteDatabase) {}

  findById(id: string): ContractDTO | undefined {
    const row = this.database
      .prepare(`${CONTRACT_SELECT} WHERE contracts.id = ?`)
      .get(id) as ContractRow | undefined;
    return row ? mapContract(row) : undefined;
  }

  listByProvider(providerId: string): ContractDTO[] {
    const rows = this.database
      .prepare(`${CONTRACT_SELECT} WHERE contracts.provider_id = ? ORDER BY contracts.created_at DESC`)
      .all(providerId) as ContractRow[];
    return rows.map(mapContract);
  }

  /** Contratos recibidos por todas las maquinas de un usuario proveedor. */
  listByOwner(ownerUserId: string): ContractDTO[] {
    const rows = this.database
      .prepare(`${CONTRACT_SELECT} WHERE providers.owner_user_id = ? ORDER BY contracts.created_at DESC`)
      .all(ownerUserId) as ContractRow[];
    return rows.map(mapContract);
  }

  listByClient(clientUserId: string): ContractDTO[] {
    const rows = this.database
      .prepare(`${CONTRACT_SELECT} WHERE contracts.client_user_id = ? ORDER BY contracts.created_at DESC`)
      .all(clientUserId) as ContractRow[];
    return rows.map(mapContract);
  }

  findOpenContract(clientUserId: string, providerId: string): ContractDTO | undefined {
    const row = this.database
      .prepare(
        `${CONTRACT_SELECT}
         WHERE contracts.client_user_id = ? AND contracts.provider_id = ?
           AND contracts.status IN ('REQUESTED', 'ACCEPTED')
         LIMIT 1`,
      )
      .get(clientUserId, providerId) as ContractRow | undefined;
    return row ? mapContract(row) : undefined;
  }

  create(input: {
    id: string;
    providerId: string;
    clientUserId: string;
    pricePer1kTokensAtomic: string;
    modelLabel: string;
    message: string;
    expiresAt: string;
    now: string;
  }): ContractDTO {
    this.database
      .prepare(
        `INSERT INTO contracts (
          id, provider_id, client_user_id, status, price_per_1k_tokens_atomic,
          model_label, message, expires_at, created_at, updated_at
        ) VALUES (
          @id, @providerId, @clientUserId, 'REQUESTED', @pricePer1kTokensAtomic,
          @modelLabel, @message, @expiresAt, @now, @now
        )`,
      )
      .run(input);
    const contract = this.findById(input.id);
    if (!contract) throw new Error('Contract insert did not return a record.');
    return contract;
  }

  updateStatus(id: string, status: ContractStatus, now: string, expiresAt?: string): ContractDTO {
    if (expiresAt !== undefined) {
      this.database
        .prepare('UPDATE contracts SET status = ?, expires_at = ?, updated_at = ? WHERE id = ?')
        .run(status, expiresAt, now, id);
    } else {
      this.database
        .prepare('UPDATE contracts SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, now, id);
    }
    const contract = this.findById(id);
    if (!contract) throw new Error('Contract update did not return a record.');
    return contract;
  }

  /**
   * Cierra los contratos que ya terminaron su vida util. Se ejecuta de forma
   * perezosa antes de cada lectura/creacion en el portal:
   *  - ACCEPTED con un job PAID del mismo cliente y provider -> COMPLETED.
   *  - REQUESTED/ACCEPTED con expires_at vencido -> EXPIRED.
   */
  sweep(now: string): void {
    this.database
      .prepare(
        `UPDATE contracts SET status = 'COMPLETED', updated_at = @now
         WHERE status = 'ACCEPTED'
           AND EXISTS (
             SELECT 1 FROM jobs
             WHERE jobs.client_user_id = contracts.client_user_id
               AND jobs.provider_id = contracts.provider_id
               AND jobs.status = 'PAID'
               AND jobs.created_at >= contracts.created_at
           )`,
      )
      .run({ now });
    this.database
      .prepare(
        `UPDATE contracts SET status = 'EXPIRED', updated_at = @now
         WHERE status IN ('REQUESTED', 'ACCEPTED')
           AND expires_at IS NOT NULL
           AND expires_at <= @now`,
      )
      .run({ now });
  }
}
