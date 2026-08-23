import { Eye, LockKeyhole, ShieldCheck } from 'lucide-react';

export function PrivacyNotice({ compact = false }: { compact?: boolean }) {
  return (
    <aside className={compact ? 'privacy-notice privacy-compact' : 'privacy-notice'}>
      <div className="privacy-icon"><ShieldCheck size={21} /></div>
      <div>
        <p className="eyebrow">Privacy boundary</p>
        <h3>Content stays off the marketplace.</h3>
        {!compact && (
          <div className="privacy-points">
            <span><LockKeyhole size={15} /> Prompt and response are never stored centrally.</span>
            <span><ShieldCheck size={15} /> Only hashes, metrics and status reach port 4000.</span>
            <span className="privacy-warning"><Eye size={15} /> The selected provider processes and may access the workload.</span>
          </div>
        )}
      </div>
    </aside>
  );
}
