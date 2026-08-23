import type { LucideIcon } from 'lucide-react';

export function StatCard({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: LucideIcon }) {
  return <article className="stat-card"><span className="stat-icon"><Icon size={18} /></span><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></article>;
}
