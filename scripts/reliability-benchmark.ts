/**
 * Benchmark Track 2 — baseline vs hardened.
 *
 * Doc 01 §18B / doc 00 §11A.
 *
 *   pnpm benchmark                          # ambos modos, adapter mock
 *   pnpm benchmark --adapter real --key <providerPublicKey>
 *   pnpm benchmark --mode hardened
 *
 * Reglas que este script respeta:
 *   T-18  ambos modos usan el MISMO dataset, el MISMO modelo y los MISMOS
 *         fixtures/inyecciones de fallo.
 *   T-17  las tasas se calculan desde los runs; no hay porcentajes escritos a mano.
 *   RNF-11 si el benchmark no corrio, no hay numeros que ensenar.
 *
 * Detalle que hace comparables los dos modos: en AMBOS se registran los
 * resultados reales de las tools y se aplica el MISMO evaluador determinista.
 * En baseline el evaluador solo mide; en hardened ademas decide. Sin esto,
 * `hallucinatedResultRate` no seria comparable.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '@meshcompute/config';
import {
  MOCK_PROVIDER_PUBLIC_KEY,
  MockQvacConsumer,
  QvacConsumer,
  isValidPublicKey,
  resolveModel,
  type QvacConsumerService,
} from '@meshcompute/qvac-adapter';
import {
  DisabledConsumerMarketplaceClient,
  type ConsumerMarketplaceClient,
} from '../apps/consumer-agent/src/marketplace-client.js';
import {
  FIXTURE_JOB_ID,
  FIXTURE_PROVIDER_ID,
  fixtureJobs,
  fixtureProviders,
} from '../apps/consumer-agent/src/fixtures/demo-fixtures.js';
import { ReliabilityOrchestrator } from '../apps/consumer-agent/src/reliability/orchestrator.js';
import type { RetryPolicy } from '../apps/consumer-agent/src/reliability/retry-policy.js';
import type { ToolContext } from '../apps/consumer-agent/src/reliability/tool-registry.js';
import { GROUNDING_CONFLICT_TRUTH, buildDataset, type BenchmarkTask } from './benchmark/dataset.js';
import { computeMetrics, type RunRecord } from './benchmark/metrics.js';

// ----------------------------------------------------------------- CLI
interface Args {
  mode: 'baseline' | 'hardened' | 'both';
  adapter: 'mock' | 'real';
  providerKey: string;
  modelKey: string;
  limit: number | undefined;
  seed: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const mode = (get('--mode') ?? 'both') as Args['mode'];
  const adapter = (get('--adapter') ?? 'mock') as Args['adapter'];
  const limitRaw = get('--limit');

  return {
    mode,
    adapter,
    providerKey: get('--key') ?? MOCK_PROVIDER_PUBLIC_KEY,
    modelKey: get('--model') ?? 'local-tooluse-llm',
    limit: limitRaw ? Number(limitRaw) : undefined,
    seed: Number(get('--seed') ?? 42),
  };
}

const args = parseArgs(process.argv.slice(2));
const logger = createLogger('benchmark', 'error');

const POLICY: RetryPolicy = {
  maxToolTurns: 4,
  maxToolRetries: 1,
  maxFinalSchemaRetries: 1,
  toolTimeoutMs: args.adapter === 'real' ? 15_000 : 500,
};

// ------------------------------------------------------------- evaluador
/**
 * Evaluador determinista, IDENTICO en los dos modos.
 *
 * Vive fuera del sistema bajo prueba: el orchestrator no sabe que se le
 * esta puntuando, y el modo baseline se mide con la misma vara que el
 * hardened aunque no bloquee nada.
 */
function isCorrect(task: BenchmarkTask, record: Omit<RunRecord, 'correct'>): boolean {
  if (task.expected === 'ANSWER') {
    // Solo cuenta si respondio Y la respuesta estaba fundamentada.
    return record.status === 'PASSED' && record.groundingPassed && record.schemaPassed;
  }
  // Debia rehusar: cualquier cosa que no sea dar una respuesta buena por valida.
  return record.status !== 'PASSED';
}

async function runTask(
  task: BenchmarkTask,
  hardened: boolean,
  marketplace: ConsumerMarketplaceClient,
): Promise<RunRecord> {
  const startedAt = Date.now();

  const consumer: QvacConsumerService =
    args.adapter === 'mock'
      ? new MockQvacConsumer({ behavior: task.mockBehavior() })
      : new QvacConsumer();

  const ctx: ToolContext = {
    jobId: FIXTURE_JOB_ID,
    providerId: FIXTURE_PROVIDER_ID,
    marketplace,
    timeoutMs: POLICY.toolTimeoutMs,
    ...(task.injection ? { injection: task.injection } : {}),
  };

  try {
    const session = await consumer.openSession({
      providerPublicKey: args.providerKey,
      modelKey: args.modelKey,
      timeoutMs: args.adapter === 'real' ? 120_000 : 5_000,
      fallbackToLocal: false,
      enableTools: true,
      forceNewConnection: false,
    });

    const result = await new ReliabilityOrchestrator().run({
      session,
      ctx,
      policy: POLICY,
      prompt: task.prompt,
      logger,
      hardened,
      seed: args.seed,
    });

    const trace = result.summary.trace;
    const partial: Omit<RunRecord, 'correct'> = {
      taskId: task.id,
      scenario: task.scenario,
      expected: task.expected,
      expectedTools: task.expectedTools,
      status: result.summary.status,
      schemaPassed: result.summary.schemaPassed,
      groundingPassed: result.summary.groundingPassed,
      toolCallsAttempted: trace.length,
      toolCallsValidArgs: trace.filter((t) => t.argsValid).length,
      toolCallsInWhitelist: trace.filter((t) => t.errorCode !== 'WRONG_TOOL').length,
      toolCallsSucceeded: trace.filter((t) => t.executionStatus === 'SUCCESS').length,
      toolsRetried: trace.filter((t) => t.retryCount > 0).length,
      toolsRecoveredAfterRetry: trace.filter(
        (t) => t.retryCount > 0 && t.executionStatus === 'SUCCESS',
      ).length,
      toolTurns: trace.length > 0 ? Math.max(...trace.map((t) => t.turn)) : 0,
      failures: result.failures,
      latencyMs: Date.now() - startedAt,
    };

    return { ...partial, correct: isCorrect(task, partial) };
  } catch (error) {
    // Un run que revienta cuenta como fallo, no se descarta: descartarlo
    // inflaria artificialmente las tasas.
    const partial: Omit<RunRecord, 'correct'> = {
      taskId: task.id,
      scenario: task.scenario,
      expected: task.expected,
      expectedTools: task.expectedTools,
      status: 'FAILED',
      schemaPassed: false,
      groundingPassed: false,
      toolCallsAttempted: 0,
      toolCallsValidArgs: 0,
      toolCallsInWhitelist: 0,
      toolCallsSucceeded: 0,
      toolsRetried: 0,
      toolsRecoveredAfterRetry: 0,
      toolTurns: 0,
      failures: [],
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
    return { ...partial, correct: isCorrect(partial as unknown as BenchmarkTask & typeof partial, partial) };
  } finally {
    await consumer.closeAll();
  }
}

async function runMode(
  mode: 'baseline' | 'hardened',
  tasks: BenchmarkTask[],
): Promise<RunRecord[]> {
  const marketplace = new DisabledConsumerMarketplaceClient(logger, {
    providers: fixtureProviders(),
    jobs: fixtureJobs(),
  });

  const records: RunRecord[] = [];
  process.stdout.write(`\n[${mode}] `);

  for (const task of tasks) {
    const record = await runTask(task, mode === 'hardened', marketplace);
    records.push(record);
    process.stdout.write(record.correct ? '.' : 'x');
  }
  process.stdout.write(` ${records.filter((r) => r.correct).length}/${records.length}\n`);

  return records;
}

// ------------------------------------------------------------------ main
async function main(): Promise<void> {
  if (args.adapter === 'real' && !isValidPublicKey(args.providerKey)) {
    console.error(
      'ERROR: --adapter real requires --key <providerPublicKey> (64-char hex).\n' +
        '       Start the provider with `pnpm provider:start` and copy its public key.',
    );
    process.exit(1);
  }

  const all = buildDataset();
  const tasks = args.limit ? all.slice(0, args.limit) : all;

  console.log('MeshCompute — Reliability benchmark (Track 2)');
  console.log(`  adapter : ${args.adapter}${args.adapter === 'mock' ? '  (SIMULATED MODEL — not reportable)' : ''}`);
  console.log(`  model   : ${args.modelKey}`);
  console.log(`  tasks   : ${tasks.length}`);
  console.log(`  seed    : ${args.seed}`);
  console.log(`  policy  : turns=${POLICY.maxToolTurns} retries=${POLICY.maxToolRetries} toolTimeout=${POLICY.toolTimeoutMs}ms`);

  if (tasks.length < 20) {
    console.warn(
      `\n  WARNING: ${tasks.length} runs. Doc 01 §18B sets the minimum at 20 real runs.`,
    );
  }

  const modes: Array<'baseline' | 'hardened'> =
    args.mode === 'both' ? ['baseline', 'hardened'] : [args.mode];

  const results: Record<string, { records: RunRecord[]; metrics: ReturnType<typeof computeMetrics> }> = {};

  for (const mode of modes) {
    const records = await runMode(mode, tasks);
    results[mode] = { records, metrics: computeMetrics(records) };
  }

  // ------------------------------------------------------------- artifacts
  const outDir = path.resolve('artifacts');
  fs.mkdirSync(outDir, { recursive: true });

  const generatedAt = new Date().toISOString();
  const report = {
    generatedAt,
    // Que se ejecuto exactamente. Sin esto, los numeros no son reproducibles.
    environment: {
      adapter: args.adapter,
      simulatedModel: args.adapter === 'mock',
      modelKey: args.modelKey,
      modelLabel: resolveModel(args.modelKey).label,
      quantization: resolveModel(args.modelKey).quantization,
      seed: args.seed,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      policy: POLICY,
    },
    dataset: {
      totalTasks: tasks.length,
      groundingConflictTruth: GROUNDING_CONFLICT_TRUTH,
    },
    modes: Object.fromEntries(
      Object.entries(results).map(([mode, data]) => [mode, data.metrics]),
    ),
  };

  const failures = {
    generatedAt,
    byMode: Object.fromEntries(
      Object.entries(results).map(([mode, data]) => [
        mode,
        {
          failureCounts: data.metrics.failureCounts,
          incorrectRuns: data.records
            .filter((r) => !r.correct)
            .map((r) => ({
              taskId: r.taskId,
              scenario: r.scenario,
              expected: r.expected,
              status: r.status,
              schemaPassed: r.schemaPassed,
              groundingPassed: r.groundingPassed,
              failures: r.failures,
              ...(r.error ? { error: r.error } : {}),
            })),
        },
      ]),
    ),
  };

  const resultsPath = path.join(outDir, 'benchmark-results.json');
  const failuresPath = path.join(outDir, 'benchmark-failures.json');
  fs.writeFileSync(resultsPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(failuresPath, `${JSON.stringify(failures, null, 2)}\n`);

  // ---------------------------------------------------------------- resumen
  console.log('\n=== results ===');
  const rows = [
    ['metric', ...modes],
    ...(
      [
        'taskSuccessRate',
        'toolSelectionAccuracy',
        'validArgumentRate',
        'groundedAnswerRate',
        'correctRefusalRate',
        'retryRecoveryRate',
        'hallucinatedResultRate',
      ] as const
    ).map((key) => [
      key,
      ...modes.map((mode) => {
        const r = results[mode]?.metrics[key];
        return r?.value === null || r === undefined
          ? 'n/a'
          : `${(r.value * 100).toFixed(1)}% (${r.numerator}/${r.denominator})`;
      }),
    ]),
    [
      'averageToolTurns',
      ...modes.map((mode) => String(results[mode]?.metrics.averageToolTurns ?? 'n/a')),
    ],
    [
      'averageLatencyMs',
      ...modes.map((mode) => String(results[mode]?.metrics.averageLatencyMs ?? 'n/a')),
    ],
  ];

  const widths = rows[0]!.map((_col, i) => Math.max(...rows.map((r) => String(r[i] ?? '').length)));
  for (const row of rows) {
    console.log(row.map((cell, i) => String(cell ?? '').padEnd(widths[i]!)).join('  '));
  }

  console.log('\n=== failure counts (F1-F9) ===');
  for (const mode of modes) {
    const counts = results[mode]!.metrics.failureCounts;
    const nonZero = Object.entries(counts).filter(([, value]) => value > 0);
    console.log(
      `  ${mode.padEnd(9)} ${nonZero.length > 0 ? nonZero.map(([k, v]) => `${k}=${v}`).join(' ') : '(none)'}`,
    );
  }

  console.log(`\n  -> ${resultsPath}`);
  console.log(`  -> ${failuresPath}`);
  if (args.adapter === 'mock') {
    console.log(
      '\n  NOTE: adapter=mock uses a scripted model. These numbers validate the\n' +
        '        harness, NOT the model. Do not report them (RNF-11).\n' +
        '        Run with --adapter real --key <providerPublicKey> for reportable results.',
    );
  }
}

await main();
