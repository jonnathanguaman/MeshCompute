'use client';

import type { ContractDTO, ProviderPublicDTO, WalletSummaryDTO } from '@meshcompute/contracts';
import { ArrowUpRight, Cpu, Handshake, KeyRound, LoaderCircle, RefreshCw, Server, TriangleAlert, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { LoadingState } from '@/components/LoadingState';
import { StatusBadge } from '@/components/StatusBadge';
import { WalletCard } from '@/components/WalletCard';
import { formatTokenAtomic, shortHash } from '@/lib/format-money';
import { getProviders } from '@/lib/marketplace-api';
import { cancelContract, getClientContracts, getWallet, requestContract } from '@/lib/portal-api';

export default function ClientPortalPage() {
  const router = useRouter();
  const { user, token, ready } = useAuth();
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<ProviderPublicDTO[]>([]);
  const [contracts, setContracts] = useState<ContractDTO[]>([]);
  const [wallet, setWallet] = useState<WalletSummaryDTO>();
  const [error, setError] = useState<string>();
  const [busyProvider, setBusyProvider] = useState<string>();
  const [busyContract, setBusyContract] = useState<string>();

  const refresh = useCallback(async () => {
    if (!token) return;
    setError(undefined);
    try {
      const [available, mine, balance] = await Promise.all([
        getProviders(),
        getClientContracts(token),
        getWallet(token),
      ]);
      setProviders(available);
      setContracts(mine);
      setWallet(balance);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Portal unavailable.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!ready) return;
    if (!user || !token) {
      router.replace('/login');
      return;
    }
    if (user.role !== 'CLIENT') {
      router.replace('/portal/provider');
      return;
    }
    void refresh();
  }, [ready, user, token, router, refresh]);

  const openContractProviderIds = useMemo(
    () =>
      new Set(
        contracts
          .filter((contract) => contract.status === 'REQUESTED' || contract.status === 'ACCEPTED')
          .map((contract) => contract.providerId),
      ),
    [contracts],
  );

  const handleHire = async (provider: ProviderPublicDTO) => {
    if (!token) return;
    setBusyProvider(provider.id);
    setError(undefined);
    try {
      const contract = await requestContract(token, provider.id);
      setContracts((current) => [contract, ...current]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not request the contract.');
    } finally {
      setBusyProvider(undefined);
    }
  };

  const handleCancel = async (contract: ContractDTO) => {
    if (!token) return;
    setBusyContract(contract.id);
    setError(undefined);
    try {
      const updated = await cancelContract(token, contract.id);
      setContracts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not cancel the contract.');
    } finally {
      setBusyContract(undefined);
    }
  };

  if (!ready || loading) return <div className="page-shell page-section"><LoadingState label="Loading client portal…" /></div>;

  return (
    <div className="page-shell page-section">
      <header className="page-heading compact-heading">
        <div>
          <p className="eyebrow">Client portal</p>
          <h1>Hire a provider anywhere.</h1>
          <p>Browse published offers, request a contract and run inference once the provider accepts — no shared network needed.</p>
        </div>
        <button className="button button-secondary button-small" onClick={() => void refresh()}><RefreshCw size={15} /> Refresh</button>
      </header>
      {error && <div className="inline-error"><TriangleAlert size={16} />{error}</div>}
      {wallet && <WalletCard wallet={wallet} />}
      <div className="portal-layout">
        <section className="panel portal-panel">
          <div className="panel-heading"><h2>Published offers</h2><span className="subtle-line">{providers.length} providers</span></div>
          {providers.length === 0 ? (
            <div className="empty-state portal-empty"><Server size={28} /><h3>No offers yet</h3><p>Ask a provider to publish their node from the provider portal.</p></div>
          ) : (
            <ul className="contract-list">
              {providers.map((provider) => {
                const alreadyOpen = openContractProviderIds.has(provider.id);
                return (
                  <li key={provider.id} className="contract-item">
                    <div className="contract-main">
                      <strong><Cpu size={14} /> {provider.name}</strong>
                      <span>{provider.modelLabel} · {provider.hardwareLabel}</span>
                      {provider.description && <p className="contract-message">{provider.description}</p>}
                      <small className="mono-note"><KeyRound size={12} /> {shortHash(provider.qvacPublicKey)}</small>
                    </div>
                    <div className="contract-actions">
                      <StatusBadge status={provider.status} />
                      <strong className="price-tag">{formatTokenAtomic(provider.pricePer1kTokensAtomic)} mUSDT</strong>
                      <button
                        className="button button-primary button-small"
                        disabled={alreadyOpen || busyProvider === provider.id}
                        onClick={() => void handleHire(provider)}
                      >
                        {busyProvider === provider.id ? <LoaderCircle className="spin" size={15} /> : <Handshake size={15} />}
                        {alreadyOpen ? 'Contract open' : 'Hire'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="panel portal-panel">
          <div className="panel-heading"><h2>My contracts</h2><span className="subtle-line">{contracts.length} total</span></div>
          {contracts.length === 0 ? (
            <div className="empty-state portal-empty"><Handshake size={28} /><h3>No contracts yet</h3><p>Hire a provider from the list to get started.</p></div>
          ) : (
            <ul className="contract-list">
              {contracts.map((contract) => (
                <li key={contract.id} className="contract-item">
                  <div className="contract-main">
                    <strong>{contract.providerName}</strong>
                    <span>{contract.modelLabel} · {formatTokenAtomic(contract.pricePer1kTokensAtomic)} mUSDT</span>
                    {contract.status === 'ACCEPTED' && (
                      <small className="mono-note"><KeyRound size={12} /> {contract.providerQvacPublicKey}</small>
                    )}
                    <small>{new Date(contract.createdAt).toLocaleString()}</small>
                  </div>
                  <div className="contract-actions">
                    <StatusBadge status={contract.status} />
                    {contract.status === 'ACCEPTED' && (
                      <Link className="button button-primary button-small" href={`/jobs/new?provider=${contract.providerId}`}>
                        Run inference <ArrowUpRight size={15} />
                      </Link>
                    )}
                    {contract.status === 'REQUESTED' && (
                      <button className="button button-secondary button-small" disabled={busyContract === contract.id} onClick={() => void handleCancel(contract)}>
                        <X size={15} /> Cancel
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
