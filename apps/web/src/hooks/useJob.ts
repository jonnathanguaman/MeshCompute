'use client';

import type { JobMetadataDTO } from '@meshcompute/contracts';
import { useCallback, useEffect, useState } from 'react';
import { getJob } from '@/lib/marketplace-api';

const terminalStatuses = new Set([
  'PAID',
  'PAYMENT_FAILED',
  'FAILED',
  'VERIFICATION_FAILED',
  'CANCELLED',
]);

export function useJob(jobId: string, pollIntervalMs = 1_000) {
  const [job, setJob] = useState<JobMetadataDTO>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const next = await getJob(jobId);
      setJob(next);
      setError(undefined);
      return next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load job.');
      return undefined;
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (!active) return;
      const next = await refresh();
      if (active && next && !terminalStatuses.has(next.status)) {
        timer = setTimeout(poll, pollIntervalMs);
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [pollIntervalMs, refresh]);

  return { job, setJob, loading, error, refresh };
}
