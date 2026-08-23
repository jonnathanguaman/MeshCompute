'use client';

import { RefreshCw, Server } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ErrorState, LoadingState } from '@/components/LoadingState';
import { ProviderCard } from '@/components/ProviderCard';
import { useProviders } from '@/hooks/useProviders';
import { webConfig } from '@/lib/config';

type Filter = 'ALL' | 'ONLINE' | 'OFFLINE';

export default function ProvidersPage() {
  const { providers, loading, error, refresh } = useProviders();
  const [filter, setFilter] = useState<Filter>('ALL');
  const visible = useMemo(
    () => providers.filter((provider) => filter === 'ALL' || provider.status === filter),
    [filter, providers],
  );

  return (
    <div className="page-shell page-section">
      {webConfig.useMocks && <div className="mock-banner">Mock mode enabled · integration fixtures are visible</div>}
      <header className="page-heading">
        <div><p className="eyebrow">Provider marketplace</p><h1>Choose where your inference runs.</h1><p>Live nodes advertise hardware, model capacity and a fixed demo quote.</p></div>
        <button className="button button-secondary button-small" onClick={() => void refresh()}><RefreshCw size={15} /> Refresh</button>
      </header>
      <div className="market-toolbar">
        <div className="filter-tabs" role="group" aria-label="Filter providers">
          {(['ALL', 'ONLINE', 'OFFLINE'] as const).map((item) => <button key={item} className={filter === item ? 'filter-active' : ''} onClick={() => setFilter(item)}>{item}</button>)}
        </div>
        <span><Server size={15} /> {providers.filter((provider) => provider.status === 'ONLINE').length} online nodes</span>
      </div>
      {loading && <LoadingState label="Discovering compute providers…" />}
      {error && <ErrorState title="Marketplace unavailable" message={error} onRetry={() => void refresh()} />}
      {!loading && !error && <div className="provider-grid">{visible.map((provider) => <ProviderCard key={provider.id} provider={provider} />)}</div>}
      {!loading && !error && visible.length === 0 && <div className="empty-state"><Server size={30} /><h2>No matching providers</h2><p>Try another availability filter.</p></div>}
    </div>
  );
}
