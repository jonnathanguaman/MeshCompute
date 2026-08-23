'use client';

import type { ProviderPublicDTO } from '@meshcompute/contracts';
import { Clock3, Cpu, FileKey2, Hash, RefreshCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { JobTimeline } from '@/components/JobTimeline';
import { LoadingState, ErrorState } from '@/components/LoadingState';
import { PaymentPanel } from '@/components/PaymentPanel';
import { PrivacyNotice } from '@/components/PrivacyNotice';
import { ReliabilityPanel } from '@/components/ReliabilityPanel';
import { StatusBadge } from '@/components/StatusBadge';
import { useLocalInference } from '@/components/LocalInferenceProvider';
import { useJob } from '@/hooks/useJob';
import { formatDuration, shortHash } from '@/lib/format-money';
import { getProvider, settleJob } from '@/lib/marketplace-api';

export function JobDetailClient({ jobId }: { jobId: string }) {
  const { job, setJob, loading, error, refresh } = useJob(jobId);
  const { getResult } = useLocalInference();
  const localResult = getResult(jobId);
  const [provider, setProvider] = useState<ProviderPublicDTO>();
  const [settling, setSettling] = useState(false);
  const [settlementError, setSettlementError] = useState<string>();

  useEffect(() => {
    if (job?.providerId) void getProvider(job.providerId).then(setProvider).catch(() => undefined);
  }, [job?.providerId]);

  const handleSettle = async () => {
    setSettling(true);
    setSettlementError(undefined);
    try {
      setJob(await settleJob(jobId));
    } catch (caught) {
      setSettlementError(
        caught instanceof Error
          ? caught.message
          : 'Settlement is not available until Persona 2B is connected.',
      );
    } finally {
      setSettling(false);
    }
  };

  if (loading && !job) return <div className="page-shell page-section"><LoadingState label="Loading job metadata…" /></div>;
  if (error && !job) return <div className="page-shell page-section"><ErrorState title="Job unavailable" message={error} onRetry={() => void refresh()} /></div>;
  if (!job) return null;

  return (
    <div className="page-shell page-section">
      <header className="job-detail-heading">
        <div><p className="eyebrow">Inference job</p><h1>{job.id}</h1><div className="job-provider-line"><Cpu size={15} /> Running on <strong>{provider?.name ?? job.providerId}</strong>{provider && <span>{provider.hardwareLabel} · via QVAC P2P</span>}</div></div>
        <div className="job-heading-actions"><StatusBadge status={job.status} /><button className="icon-button bordered" onClick={() => void refresh()} aria-label="Refresh job"><RefreshCw size={15} /></button></div>
      </header>
      <section className="panel timeline-panel"><JobTimeline status={job.status} /></section>
      <div className="job-detail-grid">
        <div className="job-main-column">
          <section className="panel result-panel">
            <div className="panel-heading"><div><p className="eyebrow">AI output</p><h2>Local result</h2></div>{localResult && <StatusBadge status={localResult.verification.status} />}</div>
            {localResult ? <pre className="result-output">{localResult.content}</pre> : <div className="local-result-missing"><FileKey2 size={24} /><div><strong>The AI response is not stored by MeshCompute.</strong><p>This page has no local result in memory. It may have been refreshed or opened on another device.</p><Link href={`/jobs/new?provider=${job.providerId}`} className="text-link">Run the inference again</Link></div></div>}
            <div className="result-metrics">
              <div><Clock3 size={15} /><span>Duration</span><strong>{formatDuration(localResult?.stats.durationMs ?? job.durationMs)}</strong></div>
              <div><Hash size={15} /><span>Output hash</span><code>{shortHash(localResult?.outputHash ?? job.outputHash)}</code></div>
              <div><FileKey2 size={15} /><span>Tokens</span><strong>{(job.inputTokens ?? localResult?.stats.inputTokens ?? 0) + (job.outputTokens ?? localResult?.stats.outputTokens ?? 0)}</strong></div>
            </div>
          </section>
          {localResult?.reliability && <ReliabilityPanel reliability={localResult.reliability} />}
          {!localResult?.reliability && job.status === 'VERIFIED' && <section className="panel muted-panel"><p className="eyebrow">Reliability trace</p><h2>Local trace unavailable</h2><p>Tool traces remain in browser memory and are never persisted by the marketplace.</p></section>}
        </div>
        <aside className="job-side-column">
          <PaymentPanel job={job} settling={settling} error={settlementError} onSettle={() => void handleSettle()} />
          <section className="panel metadata-panel"><div className="panel-heading"><div><p className="eyebrow">Control plane</p><h2>Safe metadata</h2></div></div><div className="metadata-list"><div><span>Prompt hash</span><code>{shortHash(job.promptHash)}</code></div><div><span>Output hash</span><code>{shortHash(job.outputHash)}</code></div>{job.verifierOutputHash && <div><span>Verifier hash</span><code>{shortHash(job.verifierOutputHash)}</code></div>}{job.verifierProviderId && <div><span>Verifier</span><strong>{job.verifierProviderId}</strong></div>}<div><span>Verification</span><strong>{job.verificationStatus}</strong></div><div><span>Provider</span><strong>{job.providerId}</strong></div></div></section>
          {error && <div className="inline-error"><TriangleAlert size={15} />Polling paused: {error}</div>}
          <PrivacyNotice compact />
        </aside>
      </div>
    </div>
  );
}
