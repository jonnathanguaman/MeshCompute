'use client';

import type { ContractDTO, ProviderPublicDTO, WalletSummaryDTO } from '@meshcompute/contracts';
import { Check, Cpu, Inbox, KeyRound, LoaderCircle, Pencil, Plus, Save, Server, TriangleAlert, Wallet, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import { useAuth } from '@/components/AuthProvider';
import { LoadingState } from '@/components/LoadingState';
import { StatusBadge } from '@/components/StatusBadge';
import { WalletCard } from '@/components/WalletCard';
import { formatTokenAtomic, shortHash } from '@/lib/format-money';
import { acceptContract, createListing, getMyListings, getProviderContracts, getWallet, rejectContract, updateListing } from '@/lib/portal-api';

const EMPTY_FORM = {
  name: '',
  publicKey: '',
  description: '',
  modelLabel: '',
  hardwareLabel: '',
  price: '2000',
  wallet: '',
};

type MachineForm = typeof EMPTY_FORM;

export default function ProviderPortalPage() {
  const router = useRouter();
  const { user, token, ready } = useAuth();
  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState<ProviderPublicDTO[]>([]);
  const [contracts, setContracts] = useState<ContractDTO[]>([]);
  const [walletSummary, setWalletSummary] = useState<WalletSummaryDTO>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyContract, setBusyContract] = useState<string>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MachineForm>(EMPTY_FORM);

  const setField = (field: keyof MachineForm) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  const refresh = useCallback(async () => {
    if (!token) return;
    setError(undefined);
    try {
      const [machines, incoming, balance] = await Promise.all([
        getMyListings(token),
        getProviderContracts(token),
        getWallet(token),
      ]);
      setListings(machines);
      setContracts(incoming);
      setWalletSummary(balance);
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
    if (user.role !== 'PROVIDER') {
      router.replace('/portal/client');
      return;
    }
    void refresh();
  }, [ready, user, token, router, refresh]);

  const startNewMachine = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSaved(false);
  };

  const startEdit = (machine: ProviderPublicDTO) => {
    setEditingId(machine.id);
    setForm({
      name: machine.name,
      publicKey: machine.qvacPublicKey,
      description: machine.description ?? '',
      modelLabel: machine.modelLabel,
      hardwareLabel: machine.hardwareLabel,
      price: machine.pricePer1kTokensAtomic,
      wallet: machine.walletAddress,
    });
    setSaved(false);
  };

  const handlePublish = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token) return;
    // Confirmacion antes de publicar: la wallet es el destino real de los pagos.
    const confirmation = await Swal.fire({
      title: editingId ? '¿Actualizar máquina?' : '¿Publicar máquina?',
      html:
        `<p style="margin:0 0 10px">Se ${editingId ? 'actualizará' : 'publicará'} <strong>${form.name || 'esta máquina'}</strong>.</p>` +
        '<p style="margin:0 0 6px">Wallet de cobro:</p>' +
        `<code style="display:block;word-break:break-all;background:#eeede4;border-radius:8px;padding:8px 10px;font-size:13px">${form.wallet}</code>` +
        '<p style="margin:10px 0 0;font-size:13px;color:#55645b">Los pagos de cada job se enviarán a esa dirección.</p>',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: editingId ? 'Actualizar' : 'Publicar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#175239',
      reverseButtons: true,
    });
    if (!confirmation.isConfirmed) return;
    setSaving(true);
    setSaved(false);
    setError(undefined);
    const payload = {
      name: form.name,
      qvacPublicKey: form.publicKey,
      description: form.description,
      modelKey: 'demo-llm',
      modelLabel: form.modelLabel,
      hardwareLabel: form.hardwareLabel || 'Portal listing',
      pricePer1kTokensAtomic: form.price,
      walletAddress: form.wallet,
    };
    try {
      const next = editingId
        ? await updateListing(token, editingId, payload)
        : await createListing(token, payload);
      setEditingId(next.id);
      setSaved(true);
      await Swal.fire({
        title: editingId ? 'Máquina actualizada' : 'Máquina publicada',
        text: `"${next.name}" ya es visible para los clientes.`,
        icon: 'success',
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#175239',
        timer: 3500,
        timerProgressBar: true,
      });
      await refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not publish the machine.';
      setError(message);
      await Swal.fire({
        title: 'No se pudo publicar',
        text: message,
        icon: 'error',
        confirmButtonText: 'Revisar',
        confirmButtonColor: '#a03b33',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResolve = async (contract: ContractDTO, accept: boolean) => {
    if (!token) return;
    setBusyContract(contract.id);
    setError(undefined);
    try {
      const updated = accept ? await acceptContract(token, contract.id) : await rejectContract(token, contract.id);
      setContracts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update the contract.');
    } finally {
      setBusyContract(undefined);
    }
  };

  if (!ready || loading) return <div className="page-shell page-section"><LoadingState label="Loading provider portal…" /></div>;

  return (
    <div className="page-shell page-section">
      <header className="page-heading compact-heading">
        <div>
          <p className="eyebrow">Provider portal</p>
          <h1>Publish your machines. Receive contracts.</h1>
          <p>Every machine you publish stays visible to clients worldwide — no shared network or live QVAC session required to appear here.</p>
        </div>
      </header>
      {error && <div className="inline-error"><TriangleAlert size={16} />{error}</div>}
      {walletSummary && <WalletCard wallet={walletSummary} />}
      <div className="portal-layout">
        <div className="portal-column">
          <section className="panel portal-panel">
            <div className="panel-heading">
              <h2>Your machines</h2>
              <button className="button button-secondary button-small" onClick={startNewMachine}><Plus size={15} /> New machine</button>
            </div>
            {listings.length === 0 ? (
              <div className="empty-state portal-empty"><Server size={28} /><h3>No machines yet</h3><p>Publish your first machine with the form below.</p></div>
            ) : (
              <ul className="contract-list">
                {listings.map((machine) => (
                  <li key={machine.id} className={editingId === machine.id ? 'contract-item machine-selected' : 'contract-item'}>
                    <div className="contract-main">
                      <strong><Cpu size={14} /> {machine.name}</strong>
                      <span>{machine.modelLabel} · {machine.hardwareLabel}</span>
                      <small className="mono-note"><KeyRound size={12} /> {shortHash(machine.qvacPublicKey)}</small>
                    </div>
                    <div className="contract-actions">
                      <StatusBadge status={machine.status} />
                      <strong className="price-tag">{formatTokenAtomic(machine.pricePer1kTokensAtomic)} mUSDT</strong>
                      <button className="button button-secondary button-small" onClick={() => startEdit(machine)}><Pencil size={14} /> Edit</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="panel portal-panel">
            <div className="panel-heading">
              <h2>{editingId ? 'Edit machine' : 'Publish a new machine'}</h2>
              {saved && <span className="saved-note"><Check size={14} /> Published</span>}
            </div>
            <form onSubmit={(event) => void handlePublish(event)} className="portal-form">
              <label className="field-label" htmlFor="name">Machine name</label>
              <input id="name" className="text-input" value={form.name} onChange={(event) => setField('name')(event.target.value)} placeholder="PC remota QVAC" maxLength={120} required />
              <label className="field-label" htmlFor="publicKey"><KeyRound size={13} /> QVAC public key</label>
              <input id="publicKey" className="text-input mono-input" value={form.publicKey} onChange={(event) => setField('publicKey')(event.target.value)} placeholder="Printed by pnpm provider:start / spike:provider" minLength={16} required />
              <label className="field-label" htmlFor="modelLabel">Model</label>
              <input id="modelLabel" className="text-input" value={form.modelLabel} onChange={(event) => setField('modelLabel')(event.target.value)} placeholder="Llama-3.2-1B-Instruct" maxLength={200} required />
              <label className="field-label" htmlFor="description">Model description</label>
              <textarea id="description" className="prompt-input" rows={3} value={form.description} onChange={(event) => setField('description')(event.target.value)} placeholder="Instruction-tuned 1B model, good for summaries and short structured tasks." maxLength={1000} />
              <div className="field-row">
                <div>
                  <label className="field-label" htmlFor="hardware">Hardware</label>
                  <input id="hardware" className="text-input" value={form.hardwareLabel} onChange={(event) => setField('hardwareLabel')(event.target.value)} placeholder="RTX-4070 · 32GB" maxLength={200} />
                </div>
                <div>
                  <label className="field-label" htmlFor="price">Price per job (atomic mUSDT)</label>
                  <input id="price" className="text-input" value={form.price} onChange={(event) => setField('price')(event.target.value)} pattern="\d+" title="Atomic integer, e.g. 2000 = 0.002 mUSDT" required />
                  <span className="field-help">= {formatTokenAtomic(/^\d+$/.test(form.price) ? form.price : '0')} mUSDT</span>
                </div>
              </div>
              <label className="field-label" htmlFor="wallet"><Wallet size={13} /> Payment wallet</label>
              <input id="wallet" className="text-input mono-input" value={form.wallet} onChange={(event) => setField('wallet')(event.target.value)} placeholder="0x…" pattern="0x[0-9a-fA-F]{40}" title="Dirección EVM real: 0x seguido de 40 caracteres hexadecimales" maxLength={42} required />
              <span className="field-help">Real EVM address (0x + 40 hex) — payments are sent here.</span>
              <button className="button button-primary button-full" type="submit" disabled={saving}>
                {saving ? <><LoaderCircle className="spin" size={17} /> Publishing…</> : <><Save size={17} /> {editingId ? 'Update machine' : 'Publish machine'}</>}
              </button>
            </form>
          </section>
        </div>
        <section className="panel portal-panel">
          <div className="panel-heading"><h2>Contract requests</h2><span className="subtle-line">{contracts.length} total</span></div>
          {contracts.length === 0 ? (
            <div className="empty-state portal-empty"><Inbox size={28} /><h3>No requests yet</h3><p>Publish a machine and clients will be able to hire it.</p></div>
          ) : (
            <ul className="contract-list">
              {contracts.map((contract) => (
                <li key={contract.id} className="contract-item">
                  <div className="contract-main">
                    <strong>{contract.clientDisplayName}</strong>
                    <span>{contract.providerName} · {contract.modelLabel} · {formatTokenAtomic(contract.pricePer1kTokensAtomic)} mUSDT</span>
                    {contract.message && <p className="contract-message">“{contract.message}”</p>}
                    <small>{new Date(contract.createdAt).toLocaleString()}</small>
                  </div>
                  <div className="contract-actions">
                    <StatusBadge status={contract.status} />
                    {contract.status === 'REQUESTED' && (
                      <div className="contract-buttons">
                        <button className="button button-primary button-small" disabled={busyContract === contract.id} onClick={() => void handleResolve(contract, true)}><Check size={15} /> Accept</button>
                        <button className="button button-secondary button-small" disabled={busyContract === contract.id} onClick={() => void handleResolve(contract, false)}><X size={15} /> Reject</button>
                      </div>
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
