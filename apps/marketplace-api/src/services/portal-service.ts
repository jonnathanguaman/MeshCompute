import { randomUUID } from 'node:crypto';
import type {
  ContractCreateRequest,
  ContractDTO,
  ProviderListingUpsertRequest,
  ProviderPublicDTO,
  UserDTO,
  WalletSummaryDTO,
} from '@meshcompute/contracts';
import { ContractRepository } from '../db/core/contract-repository.js';
import { JobRepository } from '../db/core/job-repository.js';
import { ProviderRepository, type ProviderRecord } from '../db/core/provider-repository.js';
import { AppError } from '../errors.js';
import { generateToken, hashToken } from '../security/tokens.js';

function listingDto(record: ProviderRecord): ProviderPublicDTO {
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

function requireRole(user: UserDTO, role: UserDTO['role']): void {
  if (user.role !== role) {
    throw new AppError(403, 'FORBIDDEN_ROLE', `This action requires a ${role} account.`);
  }
}

/** Credito demo con el que arranca cada cuenta de cliente (100 mUSDT). */
export const CLIENT_INITIAL_CREDIT_ATOMIC = 100_000_000n;

export class PortalService {
  private readonly now: () => Date;

  constructor(
    private readonly providers: ProviderRepository,
    private readonly contracts: ContractRepository,
    private readonly jobs: JobRepository,
    now?: () => Date,
    private readonly contractTtlMs = 3_600_000,
  ) {
    this.now = now ?? (() => new Date());
  }

  /** Cierra COMPLETED/EXPIRED pendientes y devuelve el instante usado. */
  private sweepContracts(): Date {
    const now = this.now();
    this.contracts.sweep(now.toISOString());
    return now;
  }

  private contractExpiry(from: Date): string {
    return new Date(from.getTime() + this.contractTtlMs).toISOString();
  }

  getWallet(user: UserDTO): WalletSummaryDTO {
    if (user.role === 'CLIENT') {
      const totals = this.jobs.paidTotals({ clientUserId: user.id });
      const spent = BigInt(totals.totalAtomic);
      const balance =
        spent >= CLIENT_INITIAL_CREDIT_ATOMIC ? 0n : CLIENT_INITIAL_CREDIT_ATOMIC - spent;
      return {
        role: 'CLIENT',
        initialCreditAtomic: CLIENT_INITIAL_CREDIT_ATOMIC.toString(),
        spentAtomic: totals.totalAtomic,
        balanceAtomic: balance.toString(),
        jobsPaid: totals.jobsPaid,
      };
    }
    const listings = this.providers.listByOwner(user.id);
    const totals = this.jobs.paidTotalsByOwner(user.id);
    return {
      role: 'PROVIDER',
      earnedAtomic: totals.totalAtomic,
      jobsPaid: totals.jobsPaid,
      listings: listings.length,
      walletAddress: listings[0]?.walletAddress ?? null,
    };
  }

  getOwnListings(user: UserDTO): ProviderPublicDTO[] {
    requireRole(user, 'PROVIDER');
    return this.providers.listByOwner(user.id).map(listingDto);
  }

  createListing(user: UserDTO, input: ProviderListingUpsertRequest): ProviderPublicDTO {
    requireRole(user, 'PROVIDER');
    const now = this.now().toISOString();
    const byKey = this.providers.findByPublicKey(input.qvacPublicKey);
    if (byKey && byKey.ownerUserId !== null && byKey.ownerUserId !== user.id) {
      throw new AppError(
        409,
        'PUBLIC_KEY_TAKEN',
        'Another provider already published this QVAC public key.',
      );
    }
    if (byKey) {
      // La clave ya existe (el agente se registro solo, o es una maquina propia):
      // se reclama/actualiza esa fila en lugar de duplicarla.
      if (byKey.ownerUserId === null) this.providers.claimOwnership(byKey.id, user.id, now);
      return listingDto(this.applyListingUpdate(byKey.id, input, now));
    }
    const record = this.providers.insertPortalListing({
      id: `p_${randomUUID()}`,
      ownerUserId: user.id,
      name: input.name,
      qvacPublicKey: input.qvacPublicKey,
      description: input.description,
      walletAddress: input.walletAddress,
      modelKey: input.modelKey,
      modelLabel: input.modelLabel,
      hardwareLabel: input.hardwareLabel,
      pricePer1kTokensAtomic: input.pricePer1kTokensAtomic,
      providerTokenHash: hashToken(generateToken()),
      now,
    });
    return listingDto(record);
  }

  updateListing(
    user: UserDTO,
    listingId: string,
    input: ProviderListingUpsertRequest,
  ): ProviderPublicDTO {
    requireRole(user, 'PROVIDER');
    const listing = this.providers.findById(listingId);
    if (!listing) {
      throw new AppError(404, 'LISTING_NOT_FOUND', 'The requested machine does not exist.');
    }
    if (listing.ownerUserId !== user.id) {
      throw new AppError(403, 'NOT_LISTING_OWNER', 'This machine belongs to another provider.');
    }
    const byKey = this.providers.findByPublicKey(input.qvacPublicKey);
    if (byKey && byKey.id !== listingId) {
      throw new AppError(
        409,
        'PUBLIC_KEY_TAKEN',
        'Another machine already uses this QVAC public key.',
      );
    }
    return listingDto(this.applyListingUpdate(listingId, input, this.now().toISOString()));
  }

  private applyListingUpdate(
    targetId: string,
    input: ProviderListingUpsertRequest,
    now: string,
  ): ProviderRecord {
    return this.providers.updatePortalListing({
      targetId,
      name: input.name,
      qvacPublicKey: input.qvacPublicKey,
      description: input.description,
      walletAddress: input.walletAddress,
      modelKey: input.modelKey,
      modelLabel: input.modelLabel,
      hardwareLabel: input.hardwareLabel,
      pricePer1kTokensAtomic: input.pricePer1kTokensAtomic,
      now,
    });
  }

  listProviderContracts(user: UserDTO): ContractDTO[] {
    requireRole(user, 'PROVIDER');
    this.sweepContracts();
    return this.contracts.listByOwner(user.id);
  }

  listClientContracts(user: UserDTO): ContractDTO[] {
    requireRole(user, 'CLIENT');
    this.sweepContracts();
    return this.contracts.listByClient(user.id);
  }

  createContract(user: UserDTO, input: ContractCreateRequest): ContractDTO {
    requireRole(user, 'CLIENT');
    const provider = this.providers.findById(input.providerId);
    if (!provider) {
      throw new AppError(404, 'PROVIDER_NOT_FOUND', 'The requested provider does not exist.');
    }
    const now = this.sweepContracts();
    if (this.contracts.findOpenContract(user.id, provider.id)) {
      throw new AppError(
        409,
        'CONTRACT_ALREADY_OPEN',
        'You already have a pending or accepted contract with this provider.',
      );
    }
    return this.contracts.create({
      id: `c_${randomUUID()}`,
      providerId: provider.id,
      clientUserId: user.id,
      pricePer1kTokensAtomic: provider.pricePer1kTokensAtomic,
      modelLabel: provider.modelLabel,
      message: input.message ?? '',
      expiresAt: this.contractExpiry(now),
      now: now.toISOString(),
    });
  }

  resolveContract(user: UserDTO, contractId: string, accept: boolean): ContractDTO {
    requireRole(user, 'PROVIDER');
    const now = this.sweepContracts();
    const contract = this.getContract(contractId);
    const listing = this.providers.findById(contract.providerId);
    if (!listing || listing.ownerUserId !== user.id) {
      throw new AppError(403, 'NOT_CONTRACT_OWNER', 'This contract belongs to another provider.');
    }
    if (contract.status !== 'REQUESTED') {
      throw new AppError(409, 'CONTRACT_NOT_PENDING', 'Only pending contracts can be resolved.');
    }
    // Al aceptar arranca una vigencia nueva; al vencer pasa a EXPIRED.
    return accept
      ? this.contracts.updateStatus(contract.id, 'ACCEPTED', now.toISOString(), this.contractExpiry(now))
      : this.contracts.updateStatus(contract.id, 'REJECTED', now.toISOString());
  }

  cancelContract(user: UserDTO, contractId: string): ContractDTO {
    requireRole(user, 'CLIENT');
    this.sweepContracts();
    const contract = this.getContract(contractId);
    if (contract.clientUserId !== user.id) {
      throw new AppError(403, 'NOT_CONTRACT_OWNER', 'This contract belongs to another client.');
    }
    if (contract.status !== 'REQUESTED') {
      throw new AppError(409, 'CONTRACT_NOT_PENDING', 'Only pending contracts can be cancelled.');
    }
    return this.contracts.updateStatus(contract.id, 'CANCELLED', this.now().toISOString());
  }

  private getContract(contractId: string): ContractDTO {
    const contract = this.contracts.findById(contractId);
    if (!contract) {
      throw new AppError(404, 'CONTRACT_NOT_FOUND', 'The requested contract does not exist.');
    }
    return contract;
  }
}
