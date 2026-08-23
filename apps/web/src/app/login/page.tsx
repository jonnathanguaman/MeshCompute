'use client';

import type { UserRole } from '@meshcompute/contracts';
import { Cpu, LoaderCircle, LogIn, TriangleAlert, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { loginAccount, registerAccount } from '@/lib/portal-api';

type Mode = 'LOGIN' | 'SIGNUP';

export default function LoginPage() {
  const router = useRouter();
  const { user, ready, saveSession } = useAuth();
  const [mode, setMode] = useState<Mode>('LOGIN');
  const [role, setRole] = useState<UserRole>('CLIENT');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (ready && user) {
      router.replace(user.role === 'PROVIDER' ? '/portal/provider' : '/portal/client');
    }
  }, [ready, user, router]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    try {
      const session =
        mode === 'LOGIN'
          ? await loginAccount({ email, password })
          : await registerAccount({ email, password, role, displayName: displayName || email });
      saveSession(session);
      router.replace(session.user.role === 'PROVIDER' ? '/portal/provider' : '/portal/client');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Authentication failed.');
      setSubmitting(false);
    }
  };

  return (
    <div className="page-shell page-section auth-layout">
      <div className="panel auth-card">
        <p className="eyebrow">{mode === 'LOGIN' ? 'Welcome back' : 'Create your account'}</p>
        <h1>{mode === 'LOGIN' ? 'Sign in to MeshCompute.' : 'Join the marketplace.'}</h1>
        <div className="filter-tabs auth-tabs" role="group" aria-label="Auth mode">
          <button type="button" className={mode === 'LOGIN' ? 'filter-active' : ''} onClick={() => setMode('LOGIN')}>SIGN IN</button>
          <button type="button" className={mode === 'SIGNUP' ? 'filter-active' : ''} onClick={() => setMode('SIGNUP')}>CREATE ACCOUNT</button>
        </div>
        <form onSubmit={(event) => void handleSubmit(event)} className="auth-form">
          {mode === 'SIGNUP' && (
            <>
              <span className="field-label">Account type</span>
              <div className="role-options">
                <button type="button" className={role === 'CLIENT' ? 'role-option role-active' : 'role-option'} onClick={() => setRole('CLIENT')}>
                  <UserRound size={18} /><strong>Client</strong><small>Hire compute providers</small>
                </button>
                <button type="button" className={role === 'PROVIDER' ? 'role-option role-active' : 'role-option'} onClick={() => setRole('PROVIDER')}>
                  <Cpu size={18} /><strong>Provider</strong><small>Publish your node and earn</small>
                </button>
              </div>
              <label className="field-label" htmlFor="displayName">Display name</label>
              <input id="displayName" className="text-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Gaming-PC-01 or Jane Doe" maxLength={120} required />
            </>
          )}
          <label className="field-label" htmlFor="email">Email</label>
          <input id="email" type="email" className="text-input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
          <label className="field-label" htmlFor="password">Password</label>
          <input id="password" type="password" className="text-input" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'SIGNUP' ? 'Minimum 8 characters' : '••••••••'} minLength={mode === 'SIGNUP' ? 8 : 1} required />
          {error && <div className="inline-error"><TriangleAlert size={16} />{error}</div>}
          <button className="button button-primary button-full" type="submit" disabled={submitting}>
            {submitting ? <><LoaderCircle className="spin" size={17} /> Please wait…</> : <><LogIn size={17} /> {mode === 'LOGIN' ? 'Sign in' : 'Create account'}</>}
          </button>
        </form>
        <p className="muted-copy auth-footnote">Accounts are stored in your local marketplace API. Providers publish an offer; clients hire it — no shared network required.</p>
      </div>
    </div>
  );
}
