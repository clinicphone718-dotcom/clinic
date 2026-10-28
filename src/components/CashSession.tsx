import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { CircleDollarSign, Printer } from 'lucide-react';
import { auth, db } from '../firebase';
import { cashSessionOwnerId, closeCashSession, openCashSession, useCashSession } from '../lib/cashSessions';
import { computeExpectedCash } from '../lib/cashSessionMath';
import type { CashSession as CashSessionRecord, UserProfile } from '../types';

function asDate(value: any): Date {
  if (value?.toDate) return value.toDate();
  const result = value instanceof Date ? value : new Date(value || 0);
  return Number.isNaN(result.getTime()) ? new Date(0) : result;
}

function formatDate(value: any): string {
  return asDate(value).toLocaleString('fr-FR');
}

export default function CashSession({ userProfile }: { userProfile: UserProfile | null }) {
  const ownerId = cashSessionOwnerId(userProfile);
  const userId = userProfile?.uid || auth.currentUser?.uid;
  const isAdmin = userProfile?.role === 'admin';
  const { session, loading, error: activeSessionError } = useCashSession(userProfile);
  const [history, setHistory] = useState<CashSessionRecord[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [openingInput, setOpeningInput] = useState('0.000');
  const [countedInput, setCountedInput] = useState('');
  const [cashierFilter, setCashierFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!ownerId || !userId || !auth.currentUser) return;
    const sessionsQuery = isAdmin
      ? query(collection(db, 'cash_sessions'), where('ownerId', '==', ownerId))
      : query(collection(db, 'cash_sessions'), where('openedBy', '==', userId));
    return onSnapshot(sessionsQuery, snapshot => {
      const records = snapshot.docs.map(item => ({ id: item.id, ...item.data() } as CashSessionRecord));
      records.sort((a, b) => asDate(b.openedAt).getTime() - asDate(a.openedAt).getTime());
      setHistory(records);
      setHistoryError('');
    }, cause => {
      setHistoryError(cause instanceof Error ? cause.message : 'Impossible de charger l’historique des caisses.');
    });
  }, [ownerId, userId, isAdmin]);

  const filteredHistory = useMemo(() => history.filter(record => {
    const cashierMatch = !isAdmin || !cashierFilter.trim() ||
      record.openedBy.toLowerCase().includes(cashierFilter.trim().toLowerCase());
    const dateMatch = !dateFilter || asDate(record.openedAt).toISOString().slice(0, 10) === dateFilter;
    return cashierMatch && dateMatch;
  }), [history, isAdmin, cashierFilter, dateFilter]);

  const openSession = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError('');
    setMessage('');
    const openingFloat = Number(openingInput.replace(',', '.'));
    if (!userId || !ownerId || !Number.isFinite(openingFloat) || openingFloat < 0) {
      setFormError('Indiquez un fond de caisse valide, égal ou supérieur à zéro.');
      return;
    }
    setSaving(true);
    try {
      await openCashSession(userId, ownerId, openingFloat);
      setMessage('Session de caisse ouverte.');
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Impossible d’ouvrir la session.');
    } finally {
      setSaving(false);
    }
  };

  const closeSession = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError('');
    setMessage('');
    const countedCash = Number(countedInput.replace(',', '.'));
    if (!userId || !session || !Number.isFinite(countedCash) || countedCash < 0) {
      setFormError('Indiquez un montant compté valide, égal ou supérieur à zéro.');
      return;
    }
    if (!window.confirm('Confirmer la clôture ? Une session clôturée ne pourra plus être modifiée.')) return;
    setSaving(true);
    try {
      const result = await closeCashSession(userId, session.id, countedCash);
      setMessage(`Session clôturée. Écart : ${result.difference.toFixed(3)} DT.`);
      setCountedInput('');
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Impossible de clôturer la session.');
    } finally {
      setSaving(false);
    }
  };

  const currentExpected = session ? computeExpectedCash(session) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-500">Gestion financière</p>
          <h1 className="mt-1 text-3xl font-black text-slate-900">Clôture de caisse</h1>
          <p className="mt-1 text-sm text-slate-500">Une session ouverte est nécessaire pour vendre et encaisser.</p>
        </div>
        {session && <button type="button" onClick={() => window.print()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700">
          <Printer className="h-4 w-4" /> Imprimer / PDF
        </button>}
      </header>

      {activeSessionError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{activeSessionError}</p>}
      {loading ? <p className="text-sm text-slate-500">Chargement de la session…</p> : session ? (
        <section className="space-y-5 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-black text-emerald-800">Session ouverte</h2>
              <p className="text-xs text-slate-500">Ouverte le {formatDate(session.openedAt)} · Caissier {session.openedBy}</p>
            </div>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black uppercase text-emerald-800">Ouverte</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['Fond initial', session.openingFloat],
              ['Ventes', session.totals?.sales || 0],
              ['Espèces ventes', session.totals?.cash || 0],
              ['Dettes encaissées', session.totals?.debtsCollected || 0],
              ['Réparations encaissées', session.totals?.repairsCollected || 0],
              ['Dépenses', session.totals?.expenses || 0],
              ['Espèces attendues', currentExpected],
            ].map(([label, amount]) => (
              <div key={label} className="rounded-xl bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-400">{label}</p>
                <p className="mt-1 font-mono text-sm font-black text-slate-800">{Number(amount).toFixed(3)} DT</p>
              </div>
            ))}
          </div>
          <form onSubmit={closeSession} className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
            <label className="min-w-56 flex-1">
              <span className="mb-1 block text-xs font-bold text-slate-600">Espèces comptées (DT)</span>
              <input type="number" min="0" step="0.001" value={countedInput} onChange={event => setCountedInput(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5" required />
            </label>
            <p className="pb-2 text-sm font-bold text-slate-600">Écart indicatif : {(Number(countedInput || 0) - currentExpected).toFixed(3)} DT</p>
            <button disabled={saving} className="min-h-11 rounded-xl bg-rose-600 px-5 font-bold text-white disabled:opacity-50">{saving ? 'Clôture…' : 'Clôturer la session'}</button>
          </form>
        </section>
      ) : (
        <form onSubmit={openSession} className="flex flex-wrap items-end gap-3 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
          <div className="mr-auto">
            <h2 className="text-lg font-black text-slate-900">Aucune session ouverte</h2>
            <p className="mt-1 text-sm text-slate-500">Ouvrez la caisse avant toute vente ou encaissement.</p>
          </div>
          <label>
            <span className="mb-1 block text-xs font-bold text-slate-600">Fond de caisse (DT)</span>
            <input type="number" min="0" step="0.001" value={openingInput} onChange={event => setOpeningInput(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5" required />
          </label>
          <button disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-5 font-bold text-white disabled:opacity-50">
            <CircleDollarSign className="h-4 w-4" /> {saving ? 'Ouverture…' : 'Ouvrir la caisse'}
          </button>
        </form>
      )}

      {(formError || message) && <p role={formError ? 'alert' : 'status'} className={`rounded-xl p-3 text-sm font-semibold ${formError ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{formError || message}</p>}

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-black text-slate-900">Historique des sessions</h2>
          {isAdmin && <div className="flex flex-wrap gap-2">
            <input aria-label="Filtrer par caissier" placeholder="UID du caissier" value={cashierFilter} onChange={event => setCashierFilter(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <input aria-label="Filtrer par date" type="date" value={dateFilter} onChange={event => setDateFilter(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          </div>}
        </div>
        {historyError && <p role="alert" className="text-sm text-rose-700">{historyError}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead><tr className="border-b text-xs uppercase text-slate-400">
              <th className="py-2">Ouverture</th><th>Caissier</th><th>Ventes</th><th>Espèces</th><th>Dépenses</th><th>Attendu</th><th>Compté</th><th>Écart</th><th>Statut</th>
            </tr></thead>
            <tbody>{filteredHistory.map(record => (
              <tr key={record.id} className="border-b border-slate-100">
                <td className="py-3">{formatDate(record.openedAt)}</td><td>{record.openedBy}</td>
                <td>{Number(record.totals?.sales || 0).toFixed(3)} DT</td>
                <td>{Number(record.totals?.cash || 0).toFixed(3)} DT</td>
                <td>{Number(record.totals?.expenses || 0).toFixed(3)} DT</td>
                <td>{record.status === 'closed' ? Number(record.expectedCash || 0).toFixed(3) : computeExpectedCash(record).toFixed(3)} DT</td>
                <td>{record.countedCash === undefined ? '—' : `${record.countedCash.toFixed(3)} DT`}</td>
                <td>{record.difference === undefined ? '—' : `${record.difference.toFixed(3)} DT`}</td>
                <td className={record.status === 'open' ? 'font-bold text-emerald-700' : 'font-semibold text-slate-500'}>{record.status === 'open' ? 'Ouverte' : 'Fermée'}</td>
              </tr>
            ))}</tbody>
          </table>
          {filteredHistory.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Aucune session correspondante.</p>}
        </div>
      </section>
    </div>
  );
}
