import { randomUUID } from 'node:crypto';
import type {
  ProviderPublicDTO,
  ProviderRegisterRequest,
  ProviderRegisterResponse,
  ProviderStatus,
} from '@meshcompute/contracts';
import { ProviderRepository, type ProviderRecord } from '../db/core/provider-repository.js';
import { AppError } from '../errors.js';
import { generateToken, hashToken, tokenMatches } from '../security/tokens.js';

function publicProvider(record: ProviderRecord): ProviderPublicDTO {
  const {
    providerTokenHash: _providerTokenHash,
    ownerUserId: _ownerUserId,
    source: _source,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...dto
  } = record;
  return dto;
}

export interface ProviderServiceOptions {
  now?: () => Date;
  offlineAfterMs: number;
  sweepIntervalMs: number;
}

export class ProviderService {
  private readonly now: () => Date;
  private monitor: NodeJS.Timeout | undefined;

  constructor(
    private readonly repository: ProviderRepository,
    private readonly options: ProviderServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  register(input: ProviderRegisterRequest): ProviderRegisterResponse {
    const existing = this.repository.findByPublicKey(input.qvacPublicKey);
    const providerToken = generateToken();
    const now = this.now().toISOString();
    const record = this.repository.upsert({
      id: existing?.id ?? `p_${randomUUID()}`,
      name: input.name,
      qvacPublicKey: input.qvacPublicKey,
      walletAddress: input.walletAddress,
      modelKey: input.modelKey,
      modelLabel: input.modelLabel,
      hardwareLabel: input.hardwareLabel,
      pricePer1kTokensAtomic: input.pricePer1kTokensAtomic,
      providerTokenHash: hashToken(providerToken),
      now,
    });
    return { provider: publicProvider(record), providerToken };
  }

  list(status?: ProviderStatus): ProviderPublicDTO[] {
    return this.repository.list(status).map(publicProvider);
  }

  get(id: string): ProviderPublicDTO {
    return publicProvider(this.getRecord(id));
  }

  getRecord(id: string): ProviderRecord {
    const provider = this.repository.findById(id);
    if (!provider) {
      throw new AppError(404, 'PROVIDER_NOT_FOUND', 'The requested provider does not exist.');
    }
    return provider;
  }

  heartbeat(id: string, rawToken: string | undefined): ProviderPublicDTO {
    const provider = this.getRecord(id);
    if (!rawToken || !tokenMatches(rawToken, provider.providerTokenHash)) {
      throw new AppError(401, 'INVALID_PROVIDER_TOKEN', 'The provider token is invalid.');
    }
    this.repository.recordHeartbeat(id, this.now().toISOString());
    return this.get(id);
  }

  /** Un provider ONLINE pasa a BUSY mientras ejecuta un job (doc 00 §8). */
  markBusy(id: string): void {
    this.repository.updateStatusIf(id, 'ONLINE', 'BUSY', this.now().toISOString());
  }

  /** Al terminar el computo, un provider BUSY vuelve a ONLINE. */
  markAvailable(id: string): void {
    this.repository.updateStatusIf(id, 'BUSY', 'ONLINE', this.now().toISOString());
  }

  markStaleProvidersOffline(): number {
    const now = this.now();
    const cutoff = new Date(now.getTime() - this.options.offlineAfterMs).toISOString();
    return this.repository.markOfflineBefore(cutoff, now.toISOString());
  }

  startOfflineMonitor(
    onProvidersMarkedOffline?: (count: number) => void,
    onError?: (error: unknown) => void,
  ): void {
    if (this.monitor) return;
    this.monitor = setInterval(() => {
      try {
        const count = this.markStaleProvidersOffline();
        if (count > 0) onProvidersMarkedOffline?.(count);
      } catch (error) {
        onError?.(error);
      }
    }, this.options.sweepIntervalMs);
    this.monitor.unref();
  }

  stopOfflineMonitor(): void {
    if (!this.monitor) return;
    clearInterval(this.monitor);
    this.monitor = undefined;
  }
}
