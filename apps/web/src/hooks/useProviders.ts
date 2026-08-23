'use client';

import type { ProviderPublicDTO } from '@meshcompute/contracts';
import { useCallback, useEffect, useState } from 'react';
import { getProviders } from '@/lib/marketplace-api';

export function useProviders() {
  const [providers, setProviders] = useState<ProviderPublicDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setProviders(await getProviders());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Marketplace unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);
  return { providers, loading, error, refresh };
}
