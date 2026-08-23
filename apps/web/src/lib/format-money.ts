export function formatTokenAtomic(value: string, decimals = 6): string {
  if (!/^\d+$/.test(value)) return '—';
  const padded = value.padStart(decimals + 1, '0');
  const integer = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${integer}.${fraction}` : integer;
}

export function formatDuration(durationMs?: number): string {
  if (durationMs === undefined) return '—';
  if (durationMs < 1_000) return `${durationMs} ms`;
  return `${(durationMs / 1_000).toFixed(2)} s`;
}

export function shortHash(hash?: string): string {
  if (!hash) return '—';
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}
