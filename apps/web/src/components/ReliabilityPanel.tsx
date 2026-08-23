import type { ReliabilitySummary } from '@meshcompute/contracts';
import { Braces, DatabaseZap, GitBranch, RefreshCw } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import { ToolTrace } from './ToolTrace';

export function ReliabilityPanel({ reliability }: { reliability: ReliabilitySummary }) {
  return (
    <section className="panel reliability-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">Reliability orchestrator</p><h2>Evidence, not assumptions</h2></div>
        <StatusBadge status={reliability.status} />
      </div>
      <div className="reliability-grid">
        <div><GitBranch size={17} /><span>Tool calls</span><strong>{reliability.successfulTools}/{reliability.requiredTools ?? reliability.successfulTools}</strong></div>
        <div><Braces size={17} /><span>Schema</span><strong>{reliability.schemaPassed ? 'PASSED' : 'FAILED'}</strong></div>
        <div><DatabaseZap size={17} /><span>Grounding</span><strong>{reliability.groundingPassed ? 'PASSED' : 'FAILED'}</strong></div>
        <div><RefreshCw size={17} /><span>Retries</span><strong>{reliability.retries}</strong></div>
      </div>
      {reliability.refusalReason && <div className="refusal-box"><strong>REFUSED</strong><span>{reliability.refusalReason}</span></div>}
      <div className="trace-heading"><span>Sanitized tool trace</span><small>No prompt or raw tool results</small></div>
      <ToolTrace trace={reliability.trace} />
    </section>
  );
}
