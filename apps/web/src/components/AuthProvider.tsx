'use client';

import type { AuthSessionResponse, UserDTO } from '@meshcompute/contracts';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getCurrentUser, logoutAccount } from '@/lib/portal-api';

const STORAGE_KEY = 'meshcompute.session';

interface StoredSession {
  token: string;
  user: UserDTO;
}

interface AuthContextValue {
  user: UserDTO | null;
  token: string | null;
  ready: boolean;
  saveSession: (session: AuthSessionResponse) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  ready: false,
  saveSession: () => undefined,
  logout: () => undefined,
});

function readStoredSession(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed.token && parsed.user ? parsed : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = readStoredSession();
    if (!stored) {
      setReady(true);
      return;
    }
    setSession(stored);
    // Revalida en segundo plano: si el token expiro, limpia la sesion.
    getCurrentUser(stored.token)
      .then((user) => setSession({ token: stored.token, user }))
      .catch(() => {
        try {
          window.localStorage.removeItem(STORAGE_KEY);
        } catch {}
        setSession(null);
      })
      .finally(() => setReady(true));
  }, []);

  const saveSession = useCallback((next: AuthSessionResponse) => {
    const stored: StoredSession = { token: next.token, user: next.user };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {}
    setSession(stored);
  }, []);

  const logout = useCallback(() => {
    if (session) void logoutAccount(session.token).catch(() => undefined);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setSession(null);
  }, [session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      token: session?.token ?? null,
      ready,
      saveSession,
      logout,
    }),
    [session, ready, saveSession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
