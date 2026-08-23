import type { JobMetadataDTO } from '@meshcompute/contracts';
import { CircleDollarSign, ExternalLink, LoaderCircle, TriangleAlert } from 'lucide-react';
import { formatTokenAtomic, shortHash } from '@/lib/format-money';
import { StatusBadge } from './StatusBadge';

export function PaymentPanel({
  job,
  settling,
  error,
  onSettle,
}: {
  job: JobMetadataDTO;
  settling: boolean;
  error?: string | undefined;
  onSettle(): void;
}) {
  const canSettle = job.status === 'VERIFIED';
  return (
    <section className="panel payment-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">Settlement</p><h2>Provider payment</h2></div>
        {job.paymentMode === 'SIMULATED' ? <StatusBadge status="SIMULATED" /> : <StatusBadge status={job.status} />}
      </div>
      <div className="payment-amount">
        <CircleDollarSign size={25} />
        <div><span>Quoted amount</span><strong>{formatTokenAtomic(job.quotedAmountAtomic)} mUSDT</strong></div>
      </div>
      {job.paymentMode === 'SIMULATED' && <p className="payment-note">Demo settlement — no real funds were used.</p>}
      {job.paymentMode === 'WDK_TESTNET' && <p className="payment-note">Paid on EVM testnet through the WDK adapter.</p>}
      {job.status === 'PAID' && <p className="payment-note">Paid automatically after verification.</p>}
      {job.paymentTxHash && <div className="hash-row"><span>Transaction</span><code>{shortHash(job.paymentTxHash)}</code><ExternalLink size={14} /></div>}
      {error && <div className="inline-error"><TriangleAlert size={15} />{error}</div>}
      {canSettle && (
        <button className="button button-primary button-full" onClick={onSettle} disabled={settling}>
          {settling ? <><LoaderCircle className="spin" size={16} /> Settling…</> : 'Retry automatic payment'}
        </button>
      )}
    </section>
  );
}
