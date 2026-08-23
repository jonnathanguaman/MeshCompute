import { ArrowRight, Braces, CircleDollarSign, Network, ShieldCheck, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { PrivacyNotice } from '@/components/PrivacyNotice';

const flow = [
  { number: '01', label: 'Discover', text: 'Compare live providers, hardware, models and transparent pricing.' },
  { number: '02', label: 'Compute', text: 'Send the workload through your local agent over QVAC P2P.' },
  { number: '03', label: 'Verify', text: 'Validate tools, schema and grounding before accepting the result.' },
  { number: '04', label: 'Settle', text: 'Close the economic loop with an auditable demo or testnet payment.' },
];

export default function HomePage() {
  return (
    <div className="landing-page">
      <section className="hero page-shell">
        <div className="hero-copy">
          <div className="hero-kicker"><Sparkles size={15} /> Decentralized inference, made accountable</div>
          <h1>Idle compute becomes <span>trusted AI capacity.</span></h1>
          <p>MeshCompute adds discovery, reliability and settlement around real QVAC peer-to-peer inference—without collecting prompts or model outputs.</p>
          <div className="hero-actions">
            <Link href="/providers" className="button button-primary">Explore providers <ArrowRight size={17} /></Link>
            <Link href="/dashboard" className="button button-secondary">View reliability</Link>
          </div>
          <div className="hero-proof">
            <span><ShieldCheck size={16} /> Metadata-only control plane</span>
            <span><Network size={16} /> Real delegated inference</span>
          </div>
        </div>
        <div className="hero-visual" aria-label="MeshCompute execution flow">
          <div className="mesh-glow" />
          <div className="flow-node flow-consumer"><small>LOCAL</small><strong>Consumer Agent</strong><span>Your prompt starts here</span></div>
          <div className="flow-connection"><span>QVAC P2P</span></div>
          <div className="flow-node flow-provider"><small>REMOTE</small><strong>GPU Provider</strong><span>Delegated completion</span></div>
          <div className="flow-outcomes">
            <div><Braces size={17} /><span>Schema + grounding</span><strong>VERIFIED</strong></div>
            <div><CircleDollarSign size={17} /><span>Settlement</span><strong>PAID</strong></div>
          </div>
        </div>
      </section>
      <section className="flow-section page-shell">
        <div className="section-intro"><p className="eyebrow">One execution path</p><h2>From discovery to settlement</h2><p>No parallel demo. Reliability lives inside the same job that runs remotely.</p></div>
        <div className="flow-grid">{flow.map((item) => <article key={item.number}><span>{item.number}</span><h3>{item.label}</h3><p>{item.text}</p></article>)}</div>
      </section>
      <section className="page-shell landing-privacy"><PrivacyNotice /></section>
    </div>
  );
}
