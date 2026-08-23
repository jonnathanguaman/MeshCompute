/**
 * Seed de demo (doc 00 §31, doc B §31).
 *
 *   pnpm demo:seed    # inserta/actualiza 2 providers y 3 jobs (RUNNING/VERIFIED/PAID)
 *   pnpm demo:reset   # borra la base y vuelve a sembrar
 *
 * Idempotente: los providers se upsertean por qvacPublicKey y los jobs de
 * seed usan IDs fijos (se recrean solo si no existen). No toca datos reales.
 */

import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  databaseDirectory,
  openDatabase,
  runMigrations,
} from '../apps/marketplace-api/src/db/connection.js';
import { JobRepository } from '../apps/marketplace-api/src/db/core/job-repository.js';
import { ProviderRepository } from '../apps/marketplace-api/src/db/core/provider-repository.js';
import { hashToken } from '../apps/marketplace-api/src/security/tokens.js';

const reset = process.argv.includes('--reset');
const databaseUrl =
  process.env.DATABASE_URL ?? path.resolve('apps/marketplace-api/meshcompute.db');

if (reset && databaseUrl !== ':memory:' && existsSync(databaseUrl)) {
  try {
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${databaseUrl}${suffix}`, { force: true });
    console.log(`base eliminada: ${databaseUrl}`);
  } catch (error) {
    console.error(
      'No se pudo borrar la base (¿API corriendo?). Detén `pnpm api:dev` y reintenta.\n' +
        `  ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

void databaseDirectory(databaseUrl);
const database = openDatabase(databaseUrl);
runMigrations(database);

const providers = new ProviderRepository(database);
const jobs = new JobRepository(database);
const now = (): string => new Date().toISOString();

// ------------------------------------------------------------ providers
const seedProviders = [
  {
    id: 'p_seed_gaming_pc_01',
    name: 'Gaming-PC-01 (seed)',
    qvacPublicKey: 'seed-demo-public-key-gaming-pc-01',
    walletAddress: '0x00000000000000000000000000000000000000A1',
    modelKey: 'demo-llm',
    modelLabel: 'Llama-3.2-1B-Instruct-Q4_0',
    hardwareLabel: 'RTX-4070 (seed)',
    pricePer1kTokensAtomic: '2000',
  },
  {
    id: 'p_seed_gaming_pc_02',
    name: 'Gaming-PC-02 (seed)',
    qvacPublicKey: 'seed-demo-public-key-gaming-pc-02',
    walletAddress: '0x00000000000000000000000000000000000000A2',
    modelKey: 'demo-llm',
    modelLabel: 'Llama-3.2-1B-Instruct-Q4_0',
    hardwareLabel: 'RX-6700XT (seed)',
    pricePer1kTokensAtomic: '2500',
  },
];

const seeded = seedProviders.map((input) =>
  providers.upsert({ ...input, providerTokenHash: hashToken(`seed-token-${input.id}`), now: now() }),
);
console.log(`providers: ${seeded.map((p) => `${p.name} [${p.status}]`).join(', ')}`);

// ----------------------------------------------------------------- jobs
type SeedTarget = 'RUNNING' | 'VERIFIED' | 'PAID';

function seedJob(id: string, providerId: string, target: SeedTarget): void {
  if (jobs.findById(id)) {
    console.log(`job ${id}: ya existe, sin cambios`);
    return;
  }
  const provider = seeded.find((p) => p.id === providerId);
  if (!provider) throw new Error(`Seed provider ${providerId} missing`);

  jobs.createAndAssign({
    id,
    providerId,
    providerWalletAddress: provider.walletAddress,
    modelKey: provider.modelKey,
    promptHash: 'd'.repeat(64),
    quotedAmountAtomic: provider.pricePer1kTokensAtomic,
    executionTokenHash: hashToken(`seed-execution-${id}`),
    now: now(),
  });

  const advance = (from: string, update: Record<string, unknown>): void => {
    const updated = jobs.updateIfStatus(id, from as never, update as never, now());
    if (!updated) throw new Error(`Seed transition failed for ${id} from ${from}`);
  };

  advance('ASSIGNED', { status: 'CONNECTING' });
  advance('CONNECTING', { status: 'RUNNING', startedAt: now() });
  if (target === 'RUNNING') return;

  advance('RUNNING', {
    status: 'VERIFYING',
    outputHash: 'e'.repeat(64),
    inputTokens: 42,
    outputTokens: 17,
    durationMs: 1180,
  });
  advance('VERIFYING', { status: 'VERIFIED', verificationStatus: 'PASSED' });
  if (target === 'VERIFIED') return;

  advance('VERIFIED', { status: 'PAYMENT_PENDING', paymentStatus: 'PENDING' });
  advance('PAYMENT_PENDING', {
    status: 'PAID',
    paymentStatus: 'PAID',
    paymentMode: 'SIMULATED',
    paymentTxHash: `sim_${id}_seed`,
    settledAmountAtomic: provider.pricePer1kTokensAtomic,
    completedAt: now(),
  });
}

seedJob('job_seed_running_01', 'p_seed_gaming_pc_01', 'RUNNING');
seedJob('job_seed_verified_01', 'p_seed_gaming_pc_01', 'VERIFIED');
seedJob('job_seed_paid_01', 'p_seed_gaming_pc_02', 'PAID');
console.log('jobs: job_seed_running_01 [RUNNING], job_seed_verified_01 [VERIFIED], job_seed_paid_01 [PAID]');

database.close();
console.log(`\nSeed listo en ${databaseUrl}. Arranca la API y abre /providers.`);
