'use client';

import { useCallback, useEffect, useState } from 'react';
import { getConsumerHealth } from '@/lib/consumer-agent';

export type AgentConnectionStatus = 'CHECKING' | 'READY' | 'UNAVAILABLE';

export function useConsumerAgent() {
  const [status, setStatus] = useState<AgentConnectionStatus>('CHECKING');
  const [qvacReady, setQvacReady] = useState(false);

  const check = useCallback(async () => {
    setStatus('CHECKING');
    try {
      const health = await getConsumerHealth();
      setQvacReady(health.qvacReady);
      setStatus('READY');
      return true;
    } catch {
      setQvacReady(false);
      setStatus('UNAVAILABLE');
      return false;
    }
  }, []);

  useEffect(() => void check(), [check]);
  return { status, qvacReady, check };
}
