import type { JobStatus } from '@meshcompute/contracts';
import { describe, expect, it } from 'vitest';
import { canTransition } from '../src/services/job-state-machine.js';

describe('job state machine', () => {
  const allowed: Array<[JobStatus, JobStatus]> = [
    ['CREATED', 'ASSIGNED'],
    ['ASSIGNED', 'CONNECTING'],
    ['CONNECTING', 'RUNNING'],
    ['RUNNING', 'VERIFYING'],
    ['VERIFYING', 'VERIFIED'],
    ['VERIFYING', 'VERIFICATION_FAILED'],
    ['VERIFIED', 'PAYMENT_PENDING'],
    ['PAYMENT_PENDING', 'PAID'],
    ['PAYMENT_PENDING', 'PAYMENT_FAILED'],
    ['CONNECTING', 'FAILED'],
    ['RUNNING', 'FAILED'],
  ];

  it.each(allowed)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['ASSIGNED', 'RUNNING'],
    ['PAID', 'RUNNING'],
    ['VERIFIED', 'CREATED'],
    ['FAILED', 'PAID'],
    ['PAYMENT_PENDING', 'VERIFIED'],
  ] as Array<[JobStatus, JobStatus]>)('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});
