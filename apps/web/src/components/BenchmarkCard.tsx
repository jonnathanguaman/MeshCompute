'use client';

import { FlaskConical, Gauge, ShieldAlert } from 'lucide-react';
import type { BenchmarkResponse } from '@/lib/types';
import { StatusBadge } from './StatusBadge';

const rows: Array<{ key: 'taskSuccessRate' | 'validArgumentRate' | 'groundedAnswerRate' | 'correctRefusalRate' | 'hallucinatedResultRate'; label: string; inverse?: boolean }> = [
  { key: 'taskSuccessRate', label: 'Task success' },
  { key: 'validArgumentRate', label: 'Valid tool args' },
  { key: 'groundedAnswerRate', label: 'Grounded answers' },
  { key: 'correctRefusalRate', label: 'Correct refusal' },
  { key: 'hallucinatedResultRate', label: 'Hallucinated results', inverse: true },
];

export function BenchmarkCard({ benchmark }: { benchmark: BenchmarkResponse }) {
  if (benchmark.status === 'NOT_RUN') {
    return <section className="panel benchmark-empty"><FlaskConical size={25} /><div><p className="eyebrow">Small-model reliability</p><h2>Benchmark not run</h2><p>Run the reproducible benchmark before presenting reliability metrics.</p></div><StatusBadge status="NOT_RUN" /></section>;
  }
  return (
    <section className="panel benchmark-card">
      <div className="panel-heading">
        <div><p className="eyebrow">Small-model reliability</p><h2>{benchmark.model} · {benchmark.quantization}</h2><span className="subtle-line">Dataset {benchmark.datasetVersion} · {benchmark.hardened.runs} matched runs</span></div>
        {benchmark.mock ? <span className="mock-label">MOCK PREVIEW</span> : <StatusBadge status="PASSED" />}
      </div>
      <div className="benchmark-head"><span>Metric</span><strong>Baseline</strong><strong>Hardened</strong></div>
      {rows.map((row) => (
        <div className="benchmark-row" key={row.key}><span>{row.label}</span><strong>{benchmark.baseline[row.key]}%</strong><strong className={row.inverse ? 'metric-lower' : 'metric-higher'}>{benchmark.hardened[row.key]}%</strong></div>
      ))}
      <div className="benchmark-foot"><span><Gauge size={15} /> Avg latency: {benchmark.hardened.averageLatencyMs} ms</span><span><ShieldAlert size={15} /> {Object.values(benchmark.failures).reduce((sum, count) => sum + count, 0)} captured failures</span></div>
      {Object.keys(benchmark.failures).length > 0 && (
        <div className="benchmark-failures">
          <span className="metric-label">Captured failures by category</span>
          <ul>
            {Object.entries(benchmark.failures)
              .sort(([, a], [, b]) => b - a)
              .map(([code, count]) => (
                <li key={code}><code>{code}</code><strong>{count}</strong></li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}
