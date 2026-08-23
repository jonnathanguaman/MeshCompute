import type { SqliteDatabase } from '../db/connection.js';

export interface MarketplaceStats {
  providersOnline: number;
  jobsTotal: number;
  jobsVerified: number;
  successRate: number;
  totalPaidAtomic: string;
}

function count(database: SqliteDatabase, sql: string): number {
  return (database.prepare(sql).get() as { count: number }).count;
}

export class StatsService {
  constructor(private readonly database: SqliteDatabase) {}

  get(): MarketplaceStats {
    const providersOnline = count(
      this.database,
      `SELECT COUNT(*) AS count FROM providers WHERE status = 'ONLINE'`,
    );
    const jobsTotal = count(this.database, 'SELECT COUNT(*) AS count FROM jobs');
    const jobsVerified = count(
      this.database,
      `SELECT COUNT(*) AS count FROM jobs
       WHERE status IN ('VERIFIED', 'PAYMENT_PENDING', 'PAID')`,
    );
    const paidAmounts = this.database
      .prepare(
        `SELECT settled_amount_atomic AS amount FROM jobs
         WHERE payment_status = 'PAID' AND settled_amount_atomic IS NOT NULL`,
      )
      .all() as Array<{ amount: string }>;
    const totalPaidAtomic = paidAmounts
      .reduce((total, row) => total + BigInt(row.amount), 0n)
      .toString();
    return {
      providersOnline,
      jobsTotal,
      jobsVerified,
      successRate: jobsTotal === 0 ? 0 : Number(((jobsVerified / jobsTotal) * 100).toFixed(1)),
      totalPaidAtomic,
    };
  }
}
