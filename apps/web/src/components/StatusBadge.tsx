import type { ContractStatus, JobStatus, ProviderStatus } from '@meshcompute/contracts';

type BadgeStatus =
  | JobStatus
  | ProviderStatus
  | ContractStatus
  | 'PASSED'
  | 'REFUSED'
  | 'SIMULATED'
  | 'NOT_RUN'
  | 'NOT_REQUESTED';

const positive = new Set<BadgeStatus>(['ONLINE', 'VERIFIED', 'PAID', 'PASSED', 'ACCEPTED', 'COMPLETED']);
const warning = new Set<BadgeStatus>([
  'BUSY',
  'CONNECTING',
  'RUNNING',
  'VERIFYING',
  'PAYMENT_PENDING',
  'SIMULATED',
  'REQUESTED',
]);
const negative = new Set<BadgeStatus>([
  'OFFLINE',
  'FAILED',
  'VERIFICATION_FAILED',
  'PAYMENT_FAILED',
  'CANCELLED',
  'REFUSED',
  'REJECTED',
  'EXPIRED',
]);

export function StatusBadge({ status }: { status: BadgeStatus }) {
  const tone = positive.has(status)
    ? 'positive'
    : warning.has(status)
      ? 'warning'
      : negative.has(status)
        ? 'negative'
        : 'neutral';
  return <span className={`status-badge status-${tone}`}><span className="status-dot" />{status.replaceAll('_', ' ')}</span>;
}
