import { describe, expect, it } from 'vitest';
import { formatDuration, formatTokenAtomic, shortHash } from '@/lib/format-money';
import { sha256Hex } from '@/lib/hashing';

describe('browser utilities', () => {
  it('creates a stable SHA-256 prompt hash', async () => {
    await expect(sha256Hex('MeshCompute')).resolves.toBe(
      '3b93fd9e21152af2a91af9b4cd378999b6adbd1365692c2ed7904601a5471a0d',
    );
  });

  it('formats atomic token values without floating point rounding', () => {
    expect(formatTokenAtomic('2000')).toBe('0.002');
    expect(formatTokenAtomic('1000000')).toBe('1');
    expect(formatTokenAtomic('1200500')).toBe('1.2005');
    expect(formatTokenAtomic('invalid')).toBe('—');
  });

  it('formats durations and safely abbreviates hashes', () => {
    expect(formatDuration(480)).toBe('480 ms');
    expect(formatDuration(1240)).toBe('1.24 s');
    expect(shortHash('a'.repeat(64))).toBe(`${'a'.repeat(10)}…${'a'.repeat(8)}`);
  });
});
