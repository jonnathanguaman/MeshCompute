import { CircleCheck, CircleDashed, CircleX, RotateCw } from 'lucide-react';
import type { AgentConnectionStatus } from '@/hooks/useConsumerAgent';

export function AgentStatus({
  status,
  qvacReady,
  onRetry,
}: {
  status: AgentConnectionStatus;
  qvacReady: boolean;
  onRetry(): void;
}) {
  if (status === 'CHECKING') {
    return <div className="agent-status agent-checking"><CircleDashed className="spin" size={18} /> Checking local agent…</div>;
  }
  if (status === 'UNAVAILABLE') {
    return (
      <div className="agent-status agent-error">
        <CircleX size={18} />
        <div><strong>Consumer Agent not running</strong><span>Start it with <code>pnpm consumer:start</code></span></div>
        <button className="icon-button" onClick={onRetry} aria-label="Retry agent connection"><RotateCw size={16} /></button>
      </div>
    );
  }
  return (
    <div className="agent-status agent-ready">
      <CircleCheck size={18} />
      <div><strong>Local Consumer Agent ready</strong><span>{qvacReady ? 'QVAC runtime available' : 'QVAC runtime warming up'}</span></div>
    </div>
  );
}
