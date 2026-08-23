import type { JobStatus } from '@meshcompute/contracts';

const transitions: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  CREATED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['CONNECTING', 'CANCELLED'],
  CONNECTING: ['RUNNING', 'FAILED', 'CANCELLED'],
  RUNNING: ['VERIFYING', 'FAILED', 'CANCELLED'],
  VERIFYING: ['VERIFIED', 'VERIFICATION_FAILED', 'FAILED'],
  VERIFIED: ['PAYMENT_PENDING'],
  VERIFICATION_FAILED: [],
  PAYMENT_PENDING: ['PAID', 'PAYMENT_FAILED'],
  PAID: [],
  PAYMENT_FAILED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return transitions[from].includes(to);
}

export function validNextStatuses(status: JobStatus): readonly JobStatus[] {
  return transitions[status];
}
