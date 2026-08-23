export type {
  LocalInferenceRequest,
  LocalInferenceResponse,
  VerificationMode,
} from '@meshcompute/contracts';
export type { LocalHealthResponse as ConsumerHealth } from '@meshcompute/contracts';

export interface MarketplaceStats {
  providersOnline: number;
  jobsTotal: number;
  jobsVerified: number;
  successRate: number;
  totalPaidAtomic: string;
}

export interface BenchmarkModeResult {
  runs: number;
  taskSuccessRate: number;
  validArgumentRate: number;
  groundedAnswerRate: number;
  correctRefusalRate: number;
  hallucinatedResultRate: number;
  averageLatencyMs: number;
}

export interface BenchmarkResult {
  status: 'READY';
  mock: boolean;
  model: string;
  quantization: string;
  datasetVersion: string;
  baseline: BenchmarkModeResult;
  hardened: BenchmarkModeResult;
  failures: Record<string, number>;
  generatedAt: string;
}

export interface BenchmarkNotRun {
  status: 'NOT_RUN';
  mock: false;
}

export type BenchmarkResponse = BenchmarkResult | BenchmarkNotRun;
