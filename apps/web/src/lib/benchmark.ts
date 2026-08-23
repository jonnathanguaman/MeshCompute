import type { BenchmarkResponse } from './types';
import { webConfig } from './config';
import { mockBenchmark } from '@/mocks/demo-data';

export async function getBenchmark(): Promise<BenchmarkResponse> {
  if (webConfig.useMocks) return mockBenchmark;
  const response = await fetch('/api/benchmark', { cache: 'no-store' });
  if (!response.ok) return { status: 'NOT_RUN', mock: false };
  return (await response.json()) as BenchmarkResponse;
}
