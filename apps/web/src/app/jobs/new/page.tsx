'use client';

import type { ProviderPublicDTO } from '@meshcompute/contracts';
import { ArrowLeft, ArrowRight, Cpu, LoaderCircle, LockKeyhole, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { AgentStatus } from '@/components/AgentStatus';
import { useAuth } from '@/components/AuthProvider';
import { LoadingState } from '@/components/LoadingState';
import { PrivacyNotice } from '@/components/PrivacyNotice';
import { useLocalInference } from '@/components/LocalInferenceProvider';
import { useConsumerAgent } from '@/hooks/useConsumerAgent';
import { runInference } from '@/lib/consumer-agent';
import { formatTokenAtomic } from '@/lib/format-money';
import { sha256Hex } from '@/lib/hashing';
import { cancelJob, createJob, getProvider, getProviders } from '@/lib/marketplace-api';
import type { VerificationMode } from '@/lib/types';

type RunStage = 'IDLE' | 'HASHING' | 'CREATING' | 'CONNECTING' | 'RUNNING';

const stageCopy: Record<Exclude<RunStage, 'IDLE'>, string> = {
  HASHING: 'Hashing prompt locally…',
  CREATING: 'Creating metadata-only job…',
  CONNECTING: 'Connecting to provider over QVAC…',
  RUNNING: 'Running remotely and verifying…',
};

// LOCAL_SCHEMA exige que la respuesta sea un objeto JSON: se antepone la
// instruccion aqui para que el usuario escriba su pregunta en lenguaje natural.
const JSON_ANSWER_INSTRUCTION =
  'Responde únicamente con un JSON de la forma {"answer": <valor>}, sin ningún texto fuera del JSON. ';

function NewJobContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const providerId = searchParams.get('provider');
  const [provider, setProvider] = useState<ProviderPublicDTO>();
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState('¿Cuánto es 123 × 45?');
  const [verificationMode, setVerificationMode] = useState<VerificationMode>('LOCAL_SCHEMA');
  const [verifierId, setVerifierId] = useState('');
  const [verifierCandidates, setVerifierCandidates] = useState<ProviderPublicDTO[]>([]);
  const [stage, setStage] = useState<RunStage>('IDLE');
  const [error, setError] = useState<string>();
  const agent = useConsumerAgent();
  const { saveResult } = useLocalInference();
  const { token } = useAuth();
  const activeJob = useRef<{ jobId: string; executionToken: string } | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!providerId) {
      setLoading(false);
      return;
    }
    getProvider(providerId)
      .then(setProvider)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Provider not found.'))
      .finally(() => setLoading(false));
  }, [providerId]);

  // Verificacion redundante (doc 00 §24): otro provider ONLINE con el mismo modelo.
  useEffect(() => {
    if (!provider) return;
    getProviders('ONLINE')
      .then((online) => {
        const candidates = online.filter(
          (candidate) => candidate.id !== provider.id && candidate.modelKey === provider.modelKey,
        );
        setVerifierCandidates(candidates);
        setVerifierId((current) =>
          candidates.some((candidate) => candidate.id === current) ? current : (candidates[0]?.id ?? ''),
        );
      })
      .catch(() => setVerifierCandidates([]));
  }, [provider]);

  const running = stage !== 'IDLE';
  const canRun = useMemo(
    () =>
      Boolean(
        provider &&
          provider.status === 'ONLINE' &&
          prompt.trim() &&
          agent.status === 'READY' &&
          !running &&
          (verificationMode !== 'REDUNDANT_DETERMINISTIC' || verifierId),
      ),
    [agent.status, prompt, provider, running, verificationMode, verifierId],
  );

  const handleRun = async () => {
    if (!provider) return;
    setError(undefined);
    try {
      const ready = await agent.check();
      if (!ready) throw new Error('Local Consumer Agent is not running. Start it with pnpm consumer:start.');
      setStage('HASHING');
      const finalPrompt = `${JSON_ANSWER_INSTRUCTION}${prompt.trim()}`;
      const promptHash = await sha256Hex(finalPrompt);
      setStage('CREATING');
      const created = await createJob(
        {
          providerId: provider.id,
          modelKey: provider.modelKey,
          promptHash,
          ...(verificationMode === 'REDUNDANT_DETERMINISTIC' && verifierId
            ? { verifierProviderId: verifierId }
            : {}),
        },
        token ?? undefined,
      );
      activeJob.current = { jobId: created.jobId, executionToken: created.executionToken };
      cancelled.current = false;
      setStage('CONNECTING');
      const inferencePromise = runInference({
        jobId: created.jobId,
        executionToken: created.executionToken,
        provider: {
          id: created.provider.id,
          qvacPublicKey: created.provider.qvacPublicKey,
          modelKey: created.provider.modelKey,
        },
        ...(created.verifier
          ? { verifier: { id: created.verifier.id, qvacPublicKey: created.verifier.qvacPublicKey } }
          : {}),
        prompt: finalPrompt,
        verificationMode,
      });
      setStage('RUNNING');
      const result = await inferencePromise;
      if (cancelled.current) return;
      saveResult(result);
      setPrompt('');
      router.push(`/jobs/${created.jobId}`);
    } catch (caught) {
      if (cancelled.current) return;
      setStage('IDLE');
      setError(caught instanceof Error ? caught.message : 'Could not run remote inference.');
    } finally {
      activeJob.current = null;
    }
  };

  const handleCancel = async () => {
    const job = activeJob.current;
    if (!job) return;
    try {
      cancelled.current = true;
      await cancelJob(job.jobId, job.executionToken);
      setStage('IDLE');
      router.push(`/jobs/${job.jobId}`);
    } catch (caught) {
      // Demasiado tarde para cancelar (p.ej. ya esta VERIFYING): seguir normal.
      cancelled.current = false;
      setError(caught instanceof Error ? caught.message : 'Could not cancel the job.');
    }
  };

  if (loading) return <div className="page-shell page-section"><LoadingState label="Loading provider…" /></div>;
  if (!provider) return <div className="page-shell page-section"><div className="error-state"><TriangleAlert /><div><h2>Provider unavailable</h2><p>{error ?? 'Choose a provider before creating a job.'}</p><Link className="button button-secondary button-small" href="/providers">Back to providers</Link></div></div></div>;

  return (
    <div className="page-shell page-section">
      <Link href="/providers" className="back-link"><ArrowLeft size={15} /> Back to providers</Link>
      <header className="page-heading compact-heading"><div><p className="eyebrow">New inference job</p><h1>Delegate a private workload.</h1><p>The marketplace receives a SHA-256 hash. Your local agent receives the content.</p></div></header>
      <div className="new-job-layout">
        <section className="panel job-form-panel">
          <div className="selected-provider">
            <span className="selected-provider-icon"><Cpu size={21} /></span>
            <div><small>Selected provider</small><strong>{provider.name}</strong><span>{provider.hardwareLabel} · {provider.modelLabel}</span></div>
            <div className="selected-price"><small>Fixed quote</small><strong>{formatTokenAtomic(provider.pricePer1kTokensAtomic)} mUSDT</strong></div>
          </div>
          <label className="field-label" htmlFor="prompt">Workload prompt</label>
          <textarea id="prompt" className="prompt-input" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={9} disabled={running} />
          <div className="field-help"><LockKeyhole size={13} /> Sent only to <code>127.0.0.1:5050</code>, never to the marketplace API.</div>
          <div className="field-help">A JSON-output instruction is prepended automatically so verification can pass — just write your question.</div>
          <fieldset className="verification-options" disabled={running}>
            <legend>Verification mode</legend>
            <label><input type="radio" name="verification" checked={verificationMode === 'LOCAL_SCHEMA'} onChange={() => setVerificationMode('LOCAL_SCHEMA')} /><span><strong>Local schema</strong><small>Recommended · deterministic output validation</small></span></label>
            <label>
              <input
                type="radio"
                name="verification"
                checked={verificationMode === 'REDUNDANT_DETERMINISTIC'}
                disabled={verifierCandidates.length === 0}
                onChange={() => setVerificationMode('REDUNDANT_DETERMINISTIC')}
              />
              <span>
                <strong>Redundant deterministic</strong>
                <small>
                  {verifierCandidates.length === 0
                    ? 'No compatible verifier online (needs another provider with the same model)'
                    : 'Same prompt runs on a second provider; hashes must match'}
                </small>
              </span>
            </label>
            {verificationMode === 'REDUNDANT_DETERMINISTIC' && verifierCandidates.length > 0 && (
              <div className="verifier-select">
                <label className="field-label" htmlFor="verifier">Verifier provider</label>
                <select id="verifier" className="text-input" value={verifierId} onChange={(event) => setVerifierId(event.target.value)}>
                  {verifierCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name} · {candidate.modelLabel}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </fieldset>
          {error && <div className="inline-error"><TriangleAlert size={16} />{error}</div>}
          <button className="button button-primary button-full run-button" disabled={!canRun} onClick={() => void handleRun()}>
            {running ? <><LoaderCircle className="spin" size={17} /> {stageCopy[stage as Exclude<RunStage, 'IDLE'>]}</> : <>Run remote inference <ArrowRight size={17} /></>}
          </button>
          {running && (stage === 'CONNECTING' || stage === 'RUNNING') && (
            <button className="button button-secondary button-full" onClick={() => void handleCancel()}>
              Cancel job
            </button>
          )}
        </section>
        <aside className="job-sidebar">
          <AgentStatus status={agent.status} qvacReady={agent.qvacReady} onRetry={() => void agent.check()} />
          <PrivacyNotice />
          <div className="route-card"><p className="eyebrow">Network route</p><div><span>Browser</span><b>→</b><span>Local Agent</span><b>→</b><span>QVAC Provider</span></div><small>Only hashes and progress return to the control plane.</small></div>
        </aside>
      </div>
    </div>
  );
}

export default function NewJobPage() {
  return <Suspense fallback={<div className="page-shell page-section"><LoadingState /></div>}><NewJobContent /></Suspense>;
}
