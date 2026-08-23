import type { JobMetadataDTO, ReliabilitySummary } from '@meshcompute/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaymentPanel } from '@/components/PaymentPanel';
import { PrivacyNotice } from '@/components/PrivacyNotice';
import { ProviderCard } from '@/components/ProviderCard';
import { ReliabilityPanel } from '@/components/ReliabilityPanel';
import { mockProviders } from '@/mocks/demo-data';

describe('Persona C interface states', () => {
  it('prevents selection of an offline provider', () => {
    const offlineProvider = mockProviders.find((provider) => provider.status === 'OFFLINE');
    expect(offlineProvider).toBeDefined();
    render(<ProviderCard provider={offlineProvider!} />);

    const button = screen.getByRole('button', { name: 'Unavailable' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('OFFLINE')).toBeTruthy();
  });

  it('marks simulated settlements without implying real funds', () => {
    const job: JobMetadataDTO = {
      id: 'job_paid',
      providerId: 'provider_01',
      modelKey: 'qwen3-1.7b-q4',
      promptHash: 'a'.repeat(64),
      outputHash: 'b'.repeat(64),
      quotedAmountAtomic: '2000',
      settledAmountAtomic: '2000',
      status: 'PAID',
      verificationStatus: 'PASSED',
      paymentStatus: 'PAID',
      paymentMode: 'SIMULATED',
      paymentTxHash: 'sim_job_paid',
      createdAt: '2026-08-22T15:00:00.000Z',
      updatedAt: '2026-08-22T15:01:00.000Z',
    };
    render(<PaymentPanel job={job} settling={false} onSettle={vi.fn()} />);

    expect(screen.getByText('SIMULATED')).toBeTruthy();
    expect(screen.getByText(/no real funds were used/i)).toBeTruthy();
  });

  it('shows a refusal as a reliability outcome, not a tool result', () => {
    const refusal: ReliabilitySummary = {
      status: 'REFUSED',
      successfulTools: 0,
      failedTools: 0,
      retries: 0,
      schemaPassed: true,
      groundingPassed: true,
      refusalReason: 'The requested action is outside the approved tool policy.',
      trace: [],
    };
    render(<ReliabilityPanel reliability={refusal} />);

    expect(screen.getAllByText('REFUSED').length).toBeGreaterThan(0);
    expect(screen.getByText(refusal.refusalReason!)).toBeTruthy();
    expect(screen.getByText(/No tool calls were required/i)).toBeTruthy();
  });

  it('states the marketplace privacy boundary explicitly', () => {
    render(<PrivacyNotice />);
    expect(screen.getByText(/Prompt and response are never stored centrally/i)).toBeTruthy();
    expect(screen.getByText(/selected provider processes and may access/i)).toBeTruthy();
  });
});
