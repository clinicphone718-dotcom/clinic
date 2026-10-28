import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { BarChart3, CircleDollarSign, Coins, Wrench } from 'lucide-react';
import { auth, db } from '../firebase';
import { Repair, Sale, StoreSettings, UserProfile, REPAIR_STATUS_LABELS } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import type { SaleCostLine } from '../lib/financial';
import { computeWorkshopSummary, ReportPeriod } from '../lib/workshopReports';

type ExpenseRecord = { id: string; date: unknown; amount: number };

const periods: Array<{ value: ReportPeriod; label: string }> = [
  { value: 'all', label: 'Tout' },
  { value: '7', label: '7 jours' },
  { value: '30', label: '30 jours' },
  { value: '90', label: '90 jours' },
  { value: 'year', label: 'Cette année' },
];

export default function Reports({ userProfile }: { userProfile: UserProfile | null }) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [saleCosts, setSaleCosts] = useState<Record<string, SaleCostLine[]>>({});
  const [repairCosts, setRepairCosts] = useState<Record<string, Record<string, number>>>({});
  const [period, setPeriod] = useState<ReportPeriod>('30');
  const [currency, setCurrency] = useState('DT');
  const [loading, setLoading] = useState(true);

  const ownerId = userProfile?.uid;
  const money = (value: number) => value.toFixed(3);

  useEffect(() => {
    if (userProfile?.role !== 'admin' || userProfile.ownerId && userProfile.ownerId !== userProfile.uid || !ownerId || !auth.currentUser) {
      setLoading(false);
      return;
    }

    const completed = new Set<number>();
    let remaining = 6;
    const finishOne = (index: number) => {
      if (completed.has(index)) return;
      completed.add(index);
      remaining -= 1;
      if (remaining === 0) setLoading(false);
    };
    const onError = (error: Error, collectionName: string, index: number, operation = OperationType.LIST) => {
      handleFirestoreError(error, operation, collectionName);
      finishOne(index);
    };
    const unsubs = [
      onSnapshot(query(collection(db, 'sales'), where('ownerId', '==', ownerId)), snapshot => {
        setSales(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as Sale)));
        finishOne(0);
      }, error => onError(error, 'sales', 0)),
      onSnapshot(query(collection(db, 'repairs'), where('ownerId', '==', ownerId)), snapshot => {
        setRepairs(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as Repair)));
        finishOne(1);
      }, error => onError(error, 'repairs', 1)),
      onSnapshot(query(collection(db, 'expenses'), where('ownerId', '==', ownerId)), snapshot => {
        setExpenses(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as ExpenseRecord)));
        finishOne(2);
      }, error => onError(error, 'expenses', 2)),
      onSnapshot(query(collection(db, 'sale_costs'), where('ownerId', '==', ownerId)), snapshot => {
        setSaleCosts(Object.fromEntries(snapshot.docs.map(item => [
          item.id,
          (item.data().items || []) as SaleCostLine[],
        ])));
        finishOne(3);
      }, error => onError(error, 'sale_costs', 3)),
      onSnapshot(query(collection(db, 'repair_costs'), where('ownerId', '==', ownerId)), snapshot => {
        setRepairCosts(Object.fromEntries(snapshot.docs.map(item => [
          item.id,
          Object.fromEntries(((item.data().parts || []) as Array<{ productId: string; unitBuyPrice: number }>)
            .map(part => [part.productId, Number(part.unitBuyPrice) || 0])),
        ])));
        finishOne(4);
      }, error => onError(error, 'repair_costs', 4)),
      onSnapshot(doc(db, 'settings', ownerId), snapshot => {
        if (snapshot.exists()) {
          const settings = snapshot.data() as StoreSettings;
          setCurrency(settings.currency || 'DT');
        }
        finishOne(5);
      }, error => onError(error, `settings/${ownerId}`, 5, OperationType.GET)),
    ];
    return () => unsubs.forEach(unsubscribe => unsubscribe());
  }, [ownerId, userProfile?.role, userProfile?.ownerId, userProfile?.uid]);

  const summary = useMemo(() => computeWorkshopSummary(
    sales, repairs, expenses, saleCosts, repairCosts, period, userProfile?.role === 'admin',
  ), [sales, repairs, expenses, saleCosts, repairCosts, period, userProfile?.role]);

  if (userProfile?.role !== 'admin' || userProfile.ownerId && userProfile.ownerId !== userProfile.uid) {
    return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm font-semibold text-amber-800">Accès réservé à l’administrateur.</div>;
  }

  const cards = [
    { label: 'Réparations', value: String(summary.repairCount), unit: '', icon: Wrench, color: 'from-blue-600 to-indigo-700' },
    { label: 'Encaissé', value: money(summary.collected), unit: currency, icon: CircleDollarSign, color: 'from-emerald-500 to-teal-700' },
    { label: 'Bénéfice brut', value: summary.grossProfit === null ? '—' : money(summary.grossProfit), unit: summary.grossProfit === null ? '' : currency, icon: Coins, color: 'from-violet-600 to-purple-800' },
    { label: 'Impayés', value: money(summary.debt), unit: currency, icon: CircleDollarSign, color: 'from-rose-500 to-red-700' },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-500">Atelier • données de ce magasin</p>
          <h1 className="mt-1 text-3xl font-black text-slate-900">Rapports atelier</h1>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Période du rapport">
          {periods.map(item => (
            <button key={item.value} type="button" onClick={() => setPeriod(item.value)}
              aria-pressed={period === item.value}
              className={`min-h-10 rounded-full border px-4 text-sm font-bold transition-colors ${period === item.value ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {loading ? <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Chargement du rapport…</p> : (
        <>
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-label="Indicateurs atelier">
            {cards.map(({ label, value, unit, icon: Icon, color }) => (
              <article key={label} className={`flex min-h-36 items-center justify-between rounded-2xl bg-gradient-to-br ${color} p-6 text-white shadow-lg`}>
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-white/75">{label}</p>
                  <p className="mt-2 font-mono text-3xl font-black tabular-nums">{value} <span className="text-base">{unit}</span></p>
                </div>
                <Icon className="h-9 w-9 opacity-80" aria-hidden="true" />
              </article>
            ))}
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-800"><BarChart3 className="h-4 w-4 text-indigo-600" /> Décomposition du CA réparations</h2>
              <dl className="mt-4 divide-y divide-slate-100 text-sm">
                <div className="flex justify-between gap-4 py-3"><dt className="text-slate-600">Main d’œuvre</dt><dd className="font-mono font-bold tabular-nums">{money(summary.laborRevenue)} {currency}</dd></div>
                <div className="flex justify-between gap-4 py-3"><dt className="text-slate-600">Pièces (facturées)</dt><dd className="font-mono font-bold tabular-nums">{money(summary.repairPartsRevenue)} {currency}</dd></div>
                <div className="flex justify-between gap-4 py-3"><dt className="text-slate-600">Coût des pièces</dt><dd className="font-mono font-bold tabular-nums">{money(summary.repairPartsCost)} {currency}</dd></div>
                <div className="flex justify-between gap-4 py-3"><dt className="text-slate-600">Ventes (TTC)</dt><dd className="font-mono font-bold tabular-nums">{money(summary.salesRevenue)} {currency}</dd></div>
                <div className="flex justify-between gap-4 py-3 text-slate-900"><dt className="font-black">Total facturé</dt><dd className="font-mono font-black tabular-nums">{money(summary.repairRevenue)} {currency}</dd></div>
              </dl>
              {summary.incompleteRepairs > 0 && <p className="mt-2 text-xs font-semibold text-amber-700">Certains coûts historiques de pièces manquent ; le bénéfice brut n’est pas estimé.</p>}
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-black uppercase tracking-wide text-slate-800">Répartition par statut</h2>
              <dl className="mt-4 space-y-2">
                {Object.entries(REPAIR_STATUS_LABELS).map(([status, label]) => (
                  <div key={status} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                    <dt className="text-slate-700">{label}</dt>
                    <dd className="min-w-8 rounded-full bg-white px-2 py-0.5 text-center font-black text-slate-800 shadow-sm">{summary.repairStatuses[status] || 0}</dd>
                  </div>
                ))}
              </dl>
              {summary.incompleteSales > 0 && <p className="mt-3 text-xs font-semibold text-amber-700">Les coûts historiques manquent pour {summary.incompleteSales} vente(s) ; bénéfice brut indisponible.</p>}
            </article>
          </section>
        </>
      )}
    </div>
  );
}
