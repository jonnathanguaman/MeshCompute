import type { ProviderPublicDTO } from '@meshcompute/contracts';
import { ArrowUpRight, Cpu, Gauge, MemoryStick, Star } from 'lucide-react';
import Link from 'next/link';
import { formatTokenAtomic } from '@/lib/format-money';
import { StatusBadge } from './StatusBadge';

export function ProviderCard({ provider }: { provider: ProviderPublicDTO }) {
  const available = provider.status === 'ONLINE';
  return (
    <article className={`provider-card ${available ? '' : 'provider-card-disabled'}`}>
      <div className="provider-card-top">
        <div>
          <p className="eyebrow">Compute node</p>
          <h2>{provider.name}</h2>
        </div>
        <StatusBadge status={provider.status} />
      </div>
      <div className="provider-specs">
        <div><MemoryStick size={17} /><span>{provider.hardwareLabel}</span></div>
        <div><Cpu size={17} /><span>{provider.modelLabel}</span></div>
      </div>
      <div className="provider-metrics">
        <div>
          <span className="metric-label"><Star size={14} /> Reputation</span>
          <strong>{provider.reputation}<small>/100</small></strong>
        </div>
        <div>
          <span className="metric-label"><Gauge size={14} /> Completed</span>
          <strong>{provider.jobsCompleted}</strong>
        </div>
      </div>
      <div className="provider-card-footer">
        <div>
          <span className="metric-label">PER JOB</span>
          <strong>{formatTokenAtomic(provider.pricePer1kTokensAtomic)} <small>mUSDT</small></strong>
        </div>
        {available ? (
          <Link className="button button-primary button-small" href={`/jobs/new?provider=${provider.id}`}>
            Run inference <ArrowUpRight size={16} />
          </Link>
        ) : (
          <button className="button button-disabled button-small" disabled>Unavailable</button>
        )}
      </div>
    </article>
  );
}
