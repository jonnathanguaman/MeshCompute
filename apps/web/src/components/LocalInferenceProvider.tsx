'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { LocalInferenceResponse } from '@/lib/types';

export interface StoredLocalInference extends LocalInferenceResponse {
  storedAt: string;
}

interface LocalInferenceContextValue {
  getResult(jobId: string): StoredLocalInference | undefined;
  saveResult(result: LocalInferenceResponse): void;
  clearResult(jobId: string): void;
}

const LocalInferenceContext = createContext<LocalInferenceContextValue | undefined>(undefined);

export function LocalInferenceProvider({ children }: { children: ReactNode }) {
  const [results, setResults] = useState<Record<string, StoredLocalInference>>({});

  const saveResult = useCallback((result: LocalInferenceResponse) => {
    setResults((current) => ({
      ...current,
      [result.jobId]: { ...result, storedAt: new Date().toISOString() },
    }));
  }, []);

  const clearResult = useCallback((jobId: string) => {
    setResults((current) => {
      const next = { ...current };
      delete next[jobId];
      return next;
    });
  }, []);

  const value = useMemo<LocalInferenceContextValue>(
    () => ({ getResult: (jobId) => results[jobId], saveResult, clearResult }),
    [clearResult, results, saveResult],
  );

  return <LocalInferenceContext.Provider value={value}>{children}</LocalInferenceContext.Provider>;
}

export function useLocalInference() {
  const context = useContext(LocalInferenceContext);
  if (!context) throw new Error('useLocalInference must be used inside LocalInferenceProvider.');
  return context;
}
