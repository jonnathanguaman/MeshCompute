import { randomUUID } from 'node:crypto';
import type {
  JobCreateRequest,
  JobCreateResponse,
  JobMetadataDTO,
  JobProgressPatch,
  JobSettlementPort,
  JobSettlementView,
  JobStatus,
  PaymentMode,
  PricingService,
  ProviderPublicDTO,
} from '@meshcompute/contracts';
import { JobRepository, type JobProgressUpdate, type JobRecord } from '../db/core/job-repository.js';
import { AppError } from '../errors.js';
import { generateToken, hashToken, tokenMatches } from '../security/tokens.js';
import { canTransition, validNextStatuses } from './job-state-machine.js';
import { ProviderService } from './provider-service.js';

function metadata(record: JobRecord): JobMetadataDTO {
  const {
    providerWalletAddress: _providerWalletAddress,
    executionTokenHash: _executionTokenHash,
    clientUserId: _clientUserId,
    consumerWallet: _consumerWallet,
    reputationAppliedAt: _reputationAppliedAt,
    ...dto
  } = record;
  return dto;
}

function isTerminal(status: JobStatus): boolean {
  return ['PAID', 'PAYMENT_FAILED', 'VERIFICATION_FAILED', 'FAILED', 'CANCELLED'].includes(status);
}

export class JobService implements JobSettlementPort {
  private readonly now: () => Date;
  private readonly pricingTimeoutMs: number;

  constructor(
    private readonly repository: JobRepository,
    private readonly providerService: ProviderService,
    private readonly pricingService: PricingService,
    now?: () => Date,
    pricingTimeoutMs = 3_000,
  ) {
    this.now = now ?? (() => new Date());
    this.pricingTimeoutMs = pricingTimeoutMs;
  }

  async create(input: JobCreateRequest, clientUserId?: string): Promise<JobCreateResponse> {
    const providerRecord = this.providerService.getRecord(input.providerId);
    if (providerRecord.status !== 'ONLINE') {
      throw new AppError(409, 'PROVIDER_OFFLINE', 'The selected provider is not online.');
    }
    if (providerRecord.modelKey !== input.modelKey) {
      throw new AppError(
        409,
        'PROVIDER_MODEL_MISMATCH',
        'The selected provider does not expose the requested model.',
      );
    }

    let verifier: ProviderPublicDTO | undefined;
    if (input.verifierProviderId) {
      if (input.verifierProviderId === input.providerId) {
        throw new AppError(
          400,
          'VERIFIER_MUST_DIFFER',
          'The verifier must be a different provider.',
        );
      }
      const verifierRecord = this.providerService.getRecord(input.verifierProviderId);
      if (verifierRecord.status !== 'ONLINE') {
        throw new AppError(409, 'VERIFIER_OFFLINE', 'The selected verifier is not online.');
      }
      if (verifierRecord.modelKey !== input.modelKey) {
        throw new AppError(
          409,
          'VERIFIER_MODEL_MISMATCH',
          'The selected verifier does not expose the requested model.',
        );
      }
      verifier = this.providerService.get(input.verifierProviderId);
    }

    const quote = await this.quoteWithTimeout({
      providerId: providerRecord.id,
      priceAtomic: providerRecord.pricePer1kTokensAtomic,
      pricingMode: providerRecord.pricingMode,
    });
    if (!/^\d+$/.test(quote.quotedAmountAtomic)) {
      throw new AppError(500, 'INVALID_PRICING_RESULT', 'Pricing returned an invalid atomic amount.');
    }

    const executionToken = generateToken();
    const job = this.repository.createAndAssign({
      id: `job_${randomUUID()}`,
      providerId: providerRecord.id,
      providerWalletAddress: providerRecord.walletAddress,
      ...(input.verifierProviderId ? { verifierProviderId: input.verifierProviderId } : {}),
      modelKey: input.modelKey,
      promptHash: input.promptHash.toLowerCase(),
      quotedAmountAtomic: quote.quotedAmountAtomic,
      executionTokenHash: hashToken(executionToken),
      ...(clientUserId ? { clientUserId } : {}),
      ...(input.consumerWallet ? { consumerWallet: input.consumerWallet } : {}),
      now: this.now().toISOString(),
    });

    return {
      jobId: job.id,
      executionToken,
      provider: this.providerService.get(providerRecord.id),
      ...(verifier ? { verifier } : {}),
      status: 'ASSIGNED',
      quotedAmountAtomic: job.quotedAmountAtomic,
    };
  }

  get(id: string): JobMetadataDTO {
    return metadata(this.getRecord(id));
  }

  list(filters: { status?: JobStatus; providerId?: string } = {}): JobMetadataDTO[] {
    return this.repository.list(filters).map(metadata);
  }

  updateProgress(
    id: string,
    rawExecutionToken: string | undefined,
    patch: JobProgressPatch,
  ): JobMetadataDTO {
    const job = this.getRecord(id);
    if (!rawExecutionToken || !tokenMatches(rawExecutionToken, job.executionTokenHash)) {
      throw new AppError(401, 'INVALID_EXECUTION_TOKEN', 'The execution token is invalid.');
    }

    if (!patch.status && isTerminal(job.status)) {
      throw this.invalidTransition(job.status, job.status);
    }
    if (patch.status && patch.status !== job.status && !canTransition(job.status, patch.status)) {
      throw this.invalidTransition(job.status, patch.status);
    }

    const targetStatus = patch.status ?? job.status;
    const update: JobProgressUpdate = {};
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.outputHash !== undefined) update.outputHash = patch.outputHash.toLowerCase();
    if (patch.verifierOutputHash !== undefined) {
      update.verifierOutputHash = patch.verifierOutputHash.toLowerCase();
    }
    if (patch.inputTokens !== undefined) update.inputTokens = patch.inputTokens;
    if (patch.outputTokens !== undefined) update.outputTokens = patch.outputTokens;
    if (patch.durationMs !== undefined) update.durationMs = patch.durationMs;
    if (patch.verificationStatus !== undefined) {
      update.verificationStatus = patch.verificationStatus;
    }

    if (targetStatus === 'RUNNING' && !job.startedAt) {
      update.startedAt = this.now().toISOString();
    }
    if (targetStatus === 'VERIFYING' && patch.verificationStatus === undefined) {
      update.verificationStatus = 'PENDING';
    }
    if (targetStatus === 'VERIFIED') {
      const outputHash = patch.outputHash ?? job.outputHash;
      if (!outputHash) {
        throw new AppError(
          400,
          'OUTPUT_HASH_REQUIRED',
          'A verified job must include an output hash.',
        );
      }
      if (patch.verificationStatus && patch.verificationStatus !== 'PASSED') {
        throw new AppError(
          400,
          'INVALID_VERIFICATION_STATUS',
          'A verified job must have PASSED verification.',
        );
      }
      update.verificationStatus = 'PASSED';
    }
    if (targetStatus === 'VERIFICATION_FAILED') {
      if (patch.verificationStatus && patch.verificationStatus !== 'FAILED') {
        throw new AppError(
          400,
          'INVALID_VERIFICATION_STATUS',
          'A verification-failed job must have FAILED verification.',
        );
      }
      update.verificationStatus = 'FAILED';
    }
    if (isTerminal(targetStatus)) {
      update.completedAt = this.now().toISOString();
    }

    const updated = this.repository.updateIfStatus(
      id,
      job.status,
      update,
      this.now().toISOString(),
    );
    if (!updated) {
      const current = this.getRecord(id);
      throw this.invalidTransition(current.status, targetStatus);
    }
    // Doc 00 §8: BUSY mientras el provider computa; vuelve a ONLINE al terminar.
    if (updated.status === 'RUNNING') {
      this.providerService.markBusy(updated.providerId);
    } else if (updated.status === 'VERIFIED' || isTerminal(updated.status)) {
      this.providerService.markAvailable(updated.providerId);
    }
    return metadata(updated);
  }

  getForSettlement(jobId: string): JobSettlementView {
    const job = this.getRecord(jobId);
    const view: JobSettlementView = {
      jobId: job.id,
      providerId: job.providerId,
      status: job.status,
      walletAddress: job.providerWalletAddress,
      quotedAmountAtomic: job.quotedAmountAtomic,
      paymentStatus: job.paymentStatus,
    };
    if (job.paymentMode) view.paymentMode = job.paymentMode;
    if (job.paymentTxHash) view.paymentTxHash = job.paymentTxHash;
    if (job.inputTokens !== undefined) view.inputTokens = job.inputTokens;
    if (job.outputTokens !== undefined) view.outputTokens = job.outputTokens;
    return view;
  }

  markPaymentPending(jobId: string): JobMetadataDTO {
    const job = this.getRecord(jobId);
    this.assertTransition(job.status, 'PAYMENT_PENDING');
    return metadata(
      this.atomicUpdate(
        jobId,
        job.status,
        { status: 'PAYMENT_PENDING', paymentStatus: 'PENDING', paymentErrorCode: null },
      ),
    );
  }

  markPaid(
    jobId: string,
    txHash: string,
    mode: PaymentMode,
    settledAmountAtomic?: string,
  ): JobMetadataDTO {
    const job = this.getRecord(jobId);
    this.assertTransition(job.status, 'PAID');
    const now = this.now().toISOString();
    return metadata(
      this.atomicUpdate(
        jobId,
        job.status,
        {
          status: 'PAID',
          paymentStatus: 'PAID',
          paymentMode: mode,
          paymentTxHash: txHash,
          paymentErrorCode: null,
          settledAmountAtomic: settledAmountAtomic ?? job.quotedAmountAtomic,
          completedAt: now,
        },
      ),
    );
  }

  markPaymentFailed(jobId: string, code: string): JobMetadataDTO {
    const job = this.getRecord(jobId);
    this.assertTransition(job.status, 'PAYMENT_FAILED');
    const now = this.now().toISOString();
    return metadata(
      this.atomicUpdate(
        jobId,
        job.status,
        {
          status: 'PAYMENT_FAILED',
          paymentStatus: 'FAILED',
          paymentErrorCode: code,
          completedAt: now,
        },
      ),
    );
  }

  private getRecord(id: string): JobRecord {
    const job = this.repository.findById(id);
    if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'The requested job does not exist.');
    return job;
  }

  private atomicUpdate(
    id: string,
    expectedStatus: JobStatus,
    update: JobProgressUpdate,
  ): JobRecord {
    const targetStatus = update.status ?? expectedStatus;
    const updated = this.repository.updateIfStatus(
      id,
      expectedStatus,
      update,
      this.now().toISOString(),
    );
    if (updated) return updated;
    const current = this.getRecord(id);
    throw this.invalidTransition(current.status, targetStatus);
  }

  private async quoteWithTimeout(input: Parameters<PricingService['quote']>[0]) {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new AppError(
            504,
            'PRICING_TIMEOUT',
            'Pricing did not respond within the configured timeout.',
          ),
        );
      }, this.pricingTimeoutMs);
      timer.unref();
    });

    try {
      return await Promise.race([this.pricingService.quote(input), timeout]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(503, 'PRICING_UNAVAILABLE', 'Pricing is temporarily unavailable.');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private assertTransition(from: JobStatus, to: JobStatus): void {
    if (!canTransition(from, to)) throw this.invalidTransition(from, to);
  }

  private invalidTransition(from: JobStatus, to: JobStatus): AppError {
    return new AppError(409, 'INVALID_JOB_TRANSITION', `Cannot transition job from ${from} to ${to}.`, {
      from,
      to,
      allowed: validNextStatuses(from),
    });
  }
}
