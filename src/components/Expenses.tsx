import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { addDoc, collection, onSnapshot, query, serverTimestamp, Timestamp, where } from 'firebase/firestore';
import { CircleDollarSign, Search } from 'lucide-react';
import { auth, db } from '../firebase';
import { UserProfile } from '../types';
import { handleFirestoreError, OperationType } from '../App';

interface Expense {
  id: string;
  ownerId: string;
  date: Timestamp | Date | string;
  label: string;
  category: string;
  amount: number;
  mode: string;
  createdAt?: Timestamp;
}

const CATEGORIES = ['Loyer', 'Transport', 'Salaires', 'Entretien', 'Téléphone / Internet', 'Autre'];
const PAYMENT_MODES = ['Espèces', 'Carte', 'Virement', 'Autre'];

function toDate(value: Expense['date']): Date {
  if (value instanceof Timestamp) return value.toDate();
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

export default function Expenses({ userProfile }: { userProfile: UserProfile | null }) {
  const ownerId = userProfile?.role === 'admin' ? userProfile.uid : userProfile?.ownerId;
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState('month');
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState(PAYMENT_MODES[0]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (userProfile?.role !== 'admin' || !ownerId || !auth.currentUser) {
      setExpenses([]);
      setLoading(false);
      return;
    }
    return onSnapshot(
      query(collection(db, 'expenses'), where('ownerId', '==', ownerId)),
      snapshot => {
        const records = snapshot.docs.map(item => ({ id: item.id, ...item.data() } as Expense));
        records.sort((a, b) => toDate(b.date).getTime() - toDate(a.date).getTime());
        setExpenses(records);
        setLoading(false);
      },
      err => {
        setLoading(false);
        handleFirestoreError(err, OperationType.LIST, 'expenses');
      },
    );
  }, [ownerId, userProfile?.role]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter(expense => {
      const expenseDate = toDate(expense.date);
      const monthMatch = period === 'all' ||
        `${expenseDate.getFullYear()}-${String(expenseDate.getMonth() + 1).padStart(2, '0')}` === selectedMonth;
      const queryText = search.trim().toLocaleLowerCase('fr');
      const searchMatch = !queryText ||
        expense.label.toLocaleLowerCase('fr').includes(queryText) ||
        expense.category.toLocaleLowerCase('fr').includes(queryText) ||
        expense.mode.toLocaleLowerCase('fr').includes(queryText);
      return monthMatch && searchMatch;
    });
  }, [expenses, period, selectedMonth, search]);

  const monthlyTotal = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    return expenses
      .filter(expense => {
        const expenseDate = toDate(expense.date);
        return expenseDate.getFullYear() === year && expenseDate.getMonth() === month - 1;
      })
      .reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
  }, [expenses, selectedMonth]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const parsedAmount = Number(amount.replace(',', '.'));
    if (!ownerId || userProfile?.role !== 'admin') {
      setError('Seul un administrateur peut gérer les dépenses.');
      return;
    }
    if (!label.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Indiquez un libellé et un montant supérieur à zéro.');
      return;
    }
    setSaving(true);
    try {
      await addDoc(collection(db, 'expenses'), {
        ownerId,
        date: Timestamp.fromDate(new Date(`${date}T12:00:00`)),
        label: label.trim(),
        category,
        amount: Math.round(parsedAmount * 1000) / 1000,
        mode,
        createdAt: serverTimestamp(),
        createdBy: userProfile.uid,
      });
      setLabel('');
      setAmount('');
      setMessage('Dépense enregistrée.');
    } catch (cause) {
      const messageText = cause instanceof Error ? cause.message : 'Erreur inconnue.';
      setError(`Impossible d'enregistrer la dépense : ${messageText}`);
    } finally {
      setSaving(false);
    }
  };

  if (userProfile?.role !== 'admin') {
    return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm font-semibold text-amber-800">Accès réservé à l’administrateur.</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-500">Gestion financière</p>
          <h1 className="mt-1 text-3xl font-black text-slate-900">Dépenses</h1>
        </div>
        <div className="rounded-2xl border border-rose-100 bg-rose-50 px-5 py-3 text-right">
          <p className="text-xs font-bold uppercase tracking-wider text-rose-500">Total du mois</p>
          <p className="mt-1 font-mono text-xl font-black text-rose-700">{monthlyTotal.toFixed(3)} DT</p>
        </div>
      </header>

      <form onSubmit={submit} className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-6">
        <label className="md:col-span-2">
          <span className="mb-1 block text-xs font-bold text-slate-600">Libellé</span>
          <input value={label} onChange={event => setLabel(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5" required maxLength={120} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold text-slate-600">Date</span>
          <input type="date" value={date} onChange={event => setDate(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5" required />
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold text-slate-600">Catégorie</span>
          <select value={category} onChange={event => setCategory(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5">
            {CATEGORIES.map(value => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold text-slate-600">Montant (DT)</span>
          <input type="number" min="0.001" step="0.001" value={amount} onChange={event => setAmount(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5" required />
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold text-slate-600">Mode</span>
          <select value={mode} onChange={event => setMode(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5">
            {PAYMENT_MODES.map(value => <option key={value}>{value}</option>)}
          </select>
        </label>
        <div className="flex items-end md:col-span-2">
          <button type="submit" disabled={saving} className="min-h-11 w-full rounded-xl bg-indigo-600 px-4 font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Enregistrement…' : 'Enregistrer la dépense'}
          </button>
        </div>
        {message && <p role="status" className="md:col-span-6 text-sm font-semibold text-emerald-700">{message}</p>}
        {error && <p role="alert" className="md:col-span-6 text-sm font-semibold text-rose-700">{error}</p>}
      </form>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Rechercher une dépense…" className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm" />
          </div>
          <select value={period} onChange={event => setPeriod(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
            <option value="month">Ce mois</option>
            <option value="all">Tout</option>
          </select>
          {period === 'month' && (
            <input type="month" value={selectedMonth} onChange={event => setSelectedMonth(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" aria-label="Mois des dépenses" />
          )}
        </div>
        {loading ? <p className="p-8 text-center text-sm text-slate-500">Chargement des dépenses…</p> :
          filteredExpenses.length === 0 ? (
            <div className="p-10 text-center">
              <CircleDollarSign className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 font-semibold text-slate-600">Aucune dépense pour cette période.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                  <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Libellé</th><th className="px-4 py-3">Catégorie</th><th className="px-4 py-3">Mode</th><th className="px-4 py-3 text-right">Montant (DT)</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredExpenses.map(expense => (
                    <tr key={expense.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3">{toDate(expense.date).toLocaleDateString('fr-FR')}</td>
                      <td className="px-4 py-3 font-semibold text-slate-800">{expense.label}</td>
                      <td className="px-4 py-3">{expense.category}</td>
                      <td className="px-4 py-3">{expense.mode}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-rose-700">{Number(expense.amount).toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  );
}
