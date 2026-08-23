import type { JobStatus } from '@meshcompute/contracts';
import { Check, Circle, X } from 'lucide-react';

const normalFlow: Array<{ status: JobStatus; label: string }> = [
  { status: 'ASSIGNED', label: 'Provider selected' },
  { status: 'CONNECTING', label: 'Connecting P2P' },
  { status: 'RUNNING', label: 'Running remotely' },
  { status: 'VERIFYING', label: 'Verifying result' },
  { status: 'VERIFIED', label: 'Verified' },
  { status: 'PAYMENT_PENDING', label: 'Settling payment' },
  { status: 'PAID', label: 'Paid' },
];

const failureStatuses = new Set<JobStatus>([
  'FAILED',
  'VERIFICATION_FAILED',
  'PAYMENT_FAILED',
  'CANCELLED',
]);

export function JobTimeline({ status }: { status: JobStatus }) {
  const currentIndex = normalFlow.findIndex((step) => step.status === status);
  const failed = failureStatuses.has(status);
  return (
    <div className="timeline" aria-label={`Job status: ${status}`}>
      {normalFlow.map((step, index) => {
        const complete = currentIndex >= index || status === 'PAID';
        const active = currentIndex === index;
        return (
          <div key={step.status} className={`timeline-step ${complete ? 'timeline-complete' : ''} ${active ? 'timeline-active' : ''}`}>
            <span className="timeline-marker">{complete ? <Check size={13} /> : <Circle size={10} />}</span>
            <span>{step.label}</span>
          </div>
        );
      })}
      {failed && <div className="timeline-failure"><X size={14} /> {status.replaceAll('_', ' ')}</div>}
    </div>
  );
}
