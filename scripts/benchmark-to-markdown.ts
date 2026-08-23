/**
 * Genera la tabla Markdown del benchmark desde artifacts/benchmark-results.json.
 * Regla §45A: los JSON no se editan a mano; la version legible se genera aqui.
 *
 *   pnpm benchmark:report            # imprime Markdown por stdout
 */

import fs from 'node:fs';
import path from 'node:path';

interface Rate {
  value: number | null;
  numerator: number;
  denominator: number;
}

interface ModeMetrics {
  taskSuccessRate: Rate;
  toolSelectionAccuracy: Rate;
  validArgumentRate: Rate;
  groundedAnswerRate: Rate;
  correctRefusalRate: Rate;
  retryRecoveryRate: Rate;
  hallucinatedResultRate: Rate;
  averageToolTurns: number;
  averageLatencyMs: number;
  failureCounts: Record<string, number>;
}

interface Report {
  generatedAt: string;
  environment: {
    adapter: string;
    simulatedModel: boolean;
    modelKey: string;
    seed: number;
    node: string;
    platform: string;
  };
  dataset: { totalTasks: number };
  modes: Record<string, ModeMetrics>;
}

const resultsPath = path.resolve('artifacts/benchmark-results.json');
if (!fs.existsSync(resultsPath)) {
  console.error('No existe artifacts/benchmark-results.json. Ejecuta `pnpm benchmark` primero.');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(resultsPath, 'utf8')) as Report;
const modes = Object.keys(report.modes);

function rate(metric: Rate | undefined): string {
  if (!metric || metric.value === null) return 'n/a';
  return `${(metric.value * 100).toFixed(1)}% (${metric.numerator}/${metric.denominator})`;
}

const METRICS: Array<[keyof ModeMetrics, string]> = [
  ['taskSuccessRate', 'Task success'],
  ['toolSelectionAccuracy', 'Tool selection accuracy'],
  ['validArgumentRate', 'Valid tool args'],
  ['groundedAnswerRate', 'Grounded answers'],
  ['correctRefusalRate', 'Correct refusal'],
  ['retryRecoveryRate', 'Retry recovery'],
  ['hallucinatedResultRate', 'Hallucinated results'],
];

const lines: string[] = [];
lines.push(`### Benchmark Track 2 — baseline vs hardened`);
lines.push('');
lines.push(`- Generado: ${report.generatedAt}`);
lines.push(`- Adapter: \`${report.environment.adapter}\`${report.environment.simulatedModel ? ' (modelo simulado — NO reportable)' : ' (modelo real por QVAC P2P)'}`);
lines.push(`- Modelo: \`${report.environment.modelKey}\` · seed ${report.environment.seed}`);
lines.push(`- Runs por modo: ${report.dataset.totalTasks} · Node ${report.environment.node} · ${report.environment.platform}`);
lines.push('');
lines.push(`| Métrica | ${modes.join(' | ')} |`);
lines.push(`|---|${modes.map(() => '---|').join('')}`);
for (const [key, label] of METRICS) {
  lines.push(`| ${label} | ${modes.map((m) => rate(report.modes[m]?.[key] as Rate)).join(' | ')} |`);
}
lines.push(`| Avg tool turns | ${modes.map((m) => String(report.modes[m]?.averageToolTurns ?? 'n/a')).join(' | ')} |`);
lines.push(`| Avg latency (ms) | ${modes.map((m) => String(report.modes[m]?.averageLatencyMs ?? 'n/a')).join(' | ')} |`);
lines.push('');
lines.push('**Fallos por categoría (F1–F9):**');
lines.push('');
const allCodes = [...new Set(modes.flatMap((m) => Object.keys(report.modes[m]?.failureCounts ?? {})))].sort();
lines.push(`| Código | ${modes.join(' | ')} |`);
lines.push(`|---|${modes.map(() => '---|').join('')}`);
for (const code of allCodes) {
  const counts = modes.map((m) => report.modes[m]?.failureCounts[code] ?? 0);
  if (counts.every((c) => c === 0)) continue;
  lines.push(`| ${code} | ${counts.join(' | ')} |`);
}

console.log(lines.join('\n'));
