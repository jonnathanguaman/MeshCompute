'use client';

import type { JobMetadataDTO, ProviderPublicDTO } from '@meshcompute/contracts';
import { Activity, CircleCheckBig, Coins, Cpu, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { BenchmarkCard } from '@/components/BenchmarkCard';
import { ErrorState, LoadingState } from '@/components/LoadingState';
import { StatCard } from '@/components/StatCard';
import { StatusBadge } from '@/components/StatusBadge';
import { getBenchmark } from '@/lib/benchmark';
import { formatTokenAtomic } from '@/lib/format-money';
import { getJobs, getProviders, getStats } from '@/lib/marketplace-api';
import type { BenchmarkResponse, MarketplaceStats } from '@/lib/types';

export default function DashboardPage() {
  const [stats, setStats] = useState<MarketplaceStats>();
  const [providers, setProviders] = useState<ProviderPublicDTO[]>([]);
  const [jobs, setJobs] = useState<JobMetadataDTO[]>([]);
  const [benchmark, setBenchmark] = useState<BenchmarkResponse>({ status: 'NOT_RUN', mock: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    const [statsResult, providersResult, jobsResult, benchmarkResult] = await Promise.allSettled([
      getStats(),
      getProviders(),
      getJobs(),
      getBenchmark(),
    ]);
    if (statsResult.status === 'fulfilled') setStats(statsResult.value);
    if (providersResult.status === 'fulfilled') setProviders(providersResult.value);
    if (jobsResult.status === 'fulfilled') setJobs(jobsResult.value);
    if (benchmarkResult.status === 'fulfilled') setBenchmark(benchmarkResult.value);
    if (statsResult.status === 'rejected' && providersResult.status === 'rejected' && jobsResult.status === 'rejected') {
      setError('Dashboard sources are not available. Persona 2B may not be connected yet.');
    }
    setLoading(false);
  }, []);

  useEffect(() => void load(), [load]);
  if (loading) return <div className="page-shell page-section"><LoadingState label="Aggregating marketplace evidence…" /></div>;

  const online = stats?.providersOnline ?? providers.filter((provider) => provider.status === 'ONLINE').length;
  const total = stats?.jobsTotal ?? jobs.length;
  const verified = stats?.jobsVerified ?? jobs.filter((job) => ['VERIFIED', 'PAYMENT_PENDING', 'PAID'].includes(job.status)).length;
  const successRate = stats?.successRate ?? (total ? Number(((verified / total) * 100).toFixed(1)) : 0);

  return (
    <div className="page-shell page-section">
      <header className="page-heading"><div><p className="eyebrow">Network dashboard</p><h1>Proof of useful work.</h1><p>Operational health, verified jobs and measured small-model reliability.</p></div><button className="button button-secondary button-small" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button></header>
      {error && <ErrorState title="Partial dashboard" message={error} onRetry={() => void load()} />}
      <div className="stats-grid">
        <StatCard icon={Cpu} label="Online providers" value={String(online)} detail={`${providers.length} registered in view`} />
        <StatCard icon={Activity} label="Completed jobs" value={String(total)} detail="Metadata-only records" />
        <StatCard icon={CircleCheckBig} label="Verified jobs" value={String(verified)} detail={`${successRate}% success rate`} />
        <StatCard icon={Coins} label="Total demo paid" value={`${formatTokenAtomic(stats?.totalPaidAtomic ?? '0')} mUSDT`} detail="Simulated or testnet" />
      </div>
      <div className="dashboard-grid">
        <BenchmarkCard benchmark={benchmark} />
        <section className="panel recent-jobs"><div className="panel-heading"><div><p className="eyebrow">Recent activity</p><h2>Job ledger</h2></div></div>{jobs.slice(0, 6).map((job) => <div className="recent-job" key={job.id}><div><strong>{job.id}</strong><span>{job.providerId}</span></div><StatusBadge status={job.status} /></div>)}{jobs.length === 0 && <p className="muted-copy">No jobs have been recorded yet.</p>}</section>
      </div>
    </div>
  );
}
