import type { JobStatus } from '@meshcompute/contracts';
import type { SqliteDatabase } from '../db/connection.js';
import { JobRepository } from '../db/core/job-repository.js';
import { ProviderRepository } from '../db/core/provider-repository.js';

/**
 * M6 — Reputacion (doc 00 §15, doc B §22-§23).
 *
 * Eventos por estado terminal del job:
 *   PAID                 -> +1  y jobs_completed+1
 *   FAILED               -> -5  y jobs_failed+1
 *   VERIFICATION_FAILED  -> -10 y jobs_failed+1
 *
 * Idempotente por job via `reputation_applied_at`: llamar dos veces (doble
 * settle, doble PATCH, auto-settle + settle manual) aplica el evento una vez.
 */
const REPUTATION_EVENTS: Partial<Record<JobStatus, { delta: number; outcome: 'COMPLETED' | 'FAILED' }>> = {
  PAID: { delta: 1, outcome: 'COMPLETED' },
  FAILED: { delta: -5, outcome: 'FAILED' },
  VERIFICATION_FAILED: { delta: -10, outcome: 'FAILED' },
};

export interface ReputationOutcome {
  applied: boolean;
  delta?: number;
  providerId?: string;
}

export class ReputationService {
  private readonly now: () => Date;

  constructor(
    private readonly database: SqliteDatabase,
    private readonly jobs: JobRepository,
    private readonly providers: ProviderRepository,
    now?: () => Date,
  ) {
    this.now = now ?? (() => new Date());
  }

  /** Aplica (una sola vez) el evento de reputacion que corresponde al estado actual del job. */
  applyForJob(jobId: string): ReputationOutcome {
    const job = this.jobs.findById(jobId);
    if (!job) return { applied: false };
    const event = REPUTATION_EVENTS[job.status];
    if (!event) return { applied: false };

    const apply = this.database.transaction((): boolean => {
      if (!this.jobs.markReputationApplied(jobId, this.now().toISOString())) return false;
      this.providers.applyReputationEvent(
        job.providerId,
        event.delta,
        event.outcome,
        this.now().toISOString(),
      );
      return true;
    });

    return apply()
      ? { applied: true, delta: event.delta, providerId: job.providerId }
      : { applied: false };
  }
}
