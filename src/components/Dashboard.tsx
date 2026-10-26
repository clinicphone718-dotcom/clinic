import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, onSnapshot, query, orderBy, limit, doc, updateDoc, deleteDoc, where } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Sale, Product, StoreSettings, UserProfile } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { 
  TrendingUp, 
  Wallet, 
  Package, 
  AlertTriangle, 
  ArrowUpRight, 
  ArrowDownRight, 
  ShoppingCart, 
  Users, 
  Coins, 
  Clock, 
  Calendar, 
  AlertCircle,
  X,
  Search,
  ArrowUpDown,
  Printer,
  Download,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Trash2,
  PackagePlus,
  BarChart3,
  Wrench,
  Percent,
  Sparkles
} from 'lucide-react';
import { isSameDay } from 'date-fns';
import { cn } from '../lib/utils';
import SalesVolumeChart from './SalesVolumeChart';
import { can } from '../lib/permissions';
import { computeSaleProfit, computeTotals, normalizeFinancialSettings, type SaleCostLine } from '../lib/financial';
import { computeWorkshopSummary } from '../lib/workshopReports';

// Helper component for printing high-quality A4 reports
interface PrintableReportProps {
  activeModal: 'revenue' | 'profit' | 'debt' | 'sales' | 'expenses' | 'stock';
  records: any[];
  storeSettings: StoreSettings | null;
  currency: string;
  canViewBuyPrice: boolean;
  canViewCosts: boolean;
}

function PrintableReport({ activeModal, records, storeSettings, currency, canViewBuyPrice, canViewCosts }: PrintableReportProps) {
  const canViewMargin = canViewBuyPrice && canViewCosts;
  const title = activeModal === 'revenue' ? "RAPPORT D'ACTIVITÉ : CHIFFRE D'AFFAIRES"
    : activeModal === 'profit' ? "RAPPORT D'ACTIVITÉ : BÉNÉFICE NET (PERFORMANCE)"
    : activeModal === 'debt' ? "RAPPORT DE TRÉSORERIE : DETTES CLIENTS"
    : activeModal === 'stock' ? "RAPPORT D'INVENTAIRE : VALORISATION DE STOCK"
    : "RAPPORT D'ACTIVITÉ : CRÉATIONS DE BILLETS / TRANSACTIONS";

  const printedDate = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <div className="print-report-container print-container p-8 font-sans text-stone-900 bg-white leading-relaxed text-xs">
      <div className="flex justify-between items-start border-b-2 border-stone-800 pb-5 mb-5">
        <div>
          <h1 className="text-base font-bold uppercase tracking-tight text-stone-900">{storeSettings?.storeName || 'Magasin de caisse'}</h1>
          <p className="text-[10px] text-stone-500">{storeSettings?.address || 'Superette & Commerce'}</p>
          {storeSettings?.phone && <p className="text-[10px] text-stone-500">Tél: {storeSettings.phone}</p>}
        </div>
        <div className="text-right">
          <h2 className="text-xs font-bold uppercase tracking-wider text-stone-750">Synthèse Historique de Caisse</h2>
          <p className="text-[10px] text-stone-450 mt-1">Imprimé le {printedDate}</p>
        </div>
      </div>

      <div className="text-center font-bold text-sm tracking-wide bg-stone-100 py-3 border border-stone-200 rounded-xl my-4 text-stone-800">
        {title}
      </div>

      <table className="w-full border-collapse text-left border border-stone-300 mt-4 text-[11px]">
        <thead>
          <tr className="bg-stone-50 uppercase font-black text-stone-700 border-b border-stone-300">
            {activeModal === 'stock' ? (
              <>
                <th className="py-2 px-3 border border-stone-200">Désignation</th>
                <th className="py-2 px-3 text-center border border-stone-200">Stock Dispo</th>
                {canViewBuyPrice && <th className="py-2 px-3 text-right border border-stone-200">P.A. Unit</th>}
                <th className="py-2 px-3 text-right border border-stone-200">P.V. Unit</th>
                {canViewBuyPrice && <th className="py-2 px-3 text-right border border-stone-200">Total Achat</th>}
                <th className="py-2 px-3 text-right border border-stone-200 bg-stone-100 font-bold">Total Vente (Revenus)</th>
                {canViewCosts && <th className="py-2 px-3 text-right border border-stone-200 font-bold">Marge Théorique</th>}
              </>
            ) : (
              <th className="py-2 px-3 border border-stone-200">Date de l'Activité</th>
            )}
            {activeModal === 'revenue' && (
              <>
                <th className="py-2 px-3 text-center border border-stone-200">Nb de Ventes</th>
                <th className="py-2 px-3 text-right border border-stone-200">Total Encaissé</th>
                <th className="py-2 px-3 text-right border border-stone-200">Dettes Générées</th>
                <th className="py-2 px-3 text-right border border-stone-200 bg-stone-100 font-bold">Chiffre d'Affaires</th>
              </>
            )}
            {activeModal === 'profit' && (
              <>
                <th className="py-2 px-3 text-right border border-stone-200">Chiffre d'Affaires</th>
                <th className="py-2 px-3 text-right border border-stone-200">Coûts et dépenses</th>
                <th className="py-2 px-3 text-center border border-stone-200">Marge Ratio (%)</th>
                <th className="py-2 px-3 text-right border border-stone-200 bg-stone-100 font-bold">Bénéfice Net</th>
              </>
            )}
            {activeModal === 'debt' && (
              <>
                <th className="py-2 px-3 text-right border border-stone-200">Chiffre d'Affaires</th>
                <th className="py-2 px-3 text-right border border-stone-200">Revenus Perçus</th>
                <th className="py-2 px-3 text-center border border-stone-200">Ventes Totales</th>
                <th className="py-2 px-3 text-right border border-stone-200 bg-stone-100 font-bold text-red-700">Impayés Restants</th>
              </>
            )}
            {activeModal === 'sales' && (
              <>
                <th className="py-2 px-3 text-center border border-stone-200">Tickets encaissés</th>
                <th className="py-2 px-3 text-right border border-stone-200">Panier Moyen journalier</th>
                <th className="py-2 px-3 text-center border border-stone-200 bg-stone-100 font-bold">Total Transactions</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-200">
          {records.map((rec, idx) => {
            if (activeModal === 'stock') {
              const stock = rec.stock || 0;
              const buyVal = canViewBuyPrice ? stock * (rec.buyPrice || 0) : 0;
              const sellVal = stock * (rec.sellPrice || 0);
              const margin = canViewMargin ? sellVal - buyVal : 0;
              return (
                <tr key={rec.id || idx} className="hover:bg-stone-50/20">
                  <td className="py-2 px-3 font-semibold border border-stone-200">{rec.name}</td>
                  <td className="py-2 px-3 text-center border border-stone-200">{stock}</td>
                  {canViewBuyPrice && <td className="py-2 px-3 text-right border border-stone-200 font-mono">{(rec.buyPrice || 0).toFixed(3)} {currency}</td>}
                  <td className="py-2 px-3 text-right border border-stone-200 font-mono">{(rec.sellPrice || 0).toFixed(3)} {currency}</td>
                  {canViewBuyPrice && <td className="py-2 px-3 text-right border border-stone-200 font-mono">{buyVal.toFixed(3)} {currency}</td>}
                  <td className="py-2 px-3 text-right border border-stone-200 bg-stone-50 font-mono font-bold">{sellVal.toFixed(3)} {currency}</td>
                  {canViewCosts && <td className="py-2 px-3 text-right border border-stone-200 font-mono font-bold">{margin.toFixed(3)} {currency}</td>}
                </tr>
              );
            }

            const dateLabel = rec.dateObj.toLocaleDateString('fr-FR', {
              weekday: 'short',
              day: '2-digit',
              month: 'short',
              year: 'numeric'
            });
            return (
              <tr key={rec.dateStr} className="hover:bg-stone-50/20">
                <td className="py-2 px-3 font-semibold border border-stone-200 capitalize">{dateLabel}</td>
                {activeModal === 'revenue' && (
                  <>
                    <td className="py-2 px-3 text-center border border-stone-200">{rec.salesCount}</td>
                    <td className="py-2 px-3 text-right border border-stone-200 font-mono">{rec.cashAmount.toFixed(3)} {currency}</td>
                    <td className="py-2 px-3 text-right border border-stone-200 font-mono">{rec.debt.toFixed(3)} {currency}</td>
                    <td className="py-2 px-3 text-right border border-stone-200 bg-stone-50 font-mono font-bold">{rec.revenue.toFixed(3)} {currency}</td>
                  </>
                )}
                {activeModal === 'profit' && (
                  <>
                    <td className="py-2 px-3 text-right border border-stone-200 font-mono">{rec.revenue.toFixed(3)} {currency}</td>
                    <td className="py-2 px-3 text-right border border-stone-200 font-mono">{rec.profitComplete ? `${(rec.revenue - rec.profit).toFixed(3)} ${currency}` : 'Coûts manquants'}</td>
                    <td className="py-2 px-3 text-center border border-stone-200 font-mono font-bold">
                      {rec.profitComplete && rec.revenue > 0 ? ((rec.profit / rec.revenue) * 100).toFixed(1) + '%' : '—'}
                    </td>
                    <td className="py-2 px-3 text-right border border-stone-200 bg-stone-50 font-mono font-bold">{rec.profitComplete ? `${rec.profit.toFixed(3)} ${currency}` : '—'}</td>
                  </>
                )}
                {activeModal === 'debt' && (
                  <>
                    <td className="py-2 px-3 text-right border border-stone-200 font-mono">{rec.revenue.toFixed(3)} {currency}</td>
                    <td className="py-2 px-3 text-right border border-stone-200 font-mono">{rec.cashAmount.toFixed(3)} {currency}</td>
                    <td className="py-2 px-3 text-center border border-stone-200">{rec.salesCount}</td>
                    <td className="py-2 px-3 text-right border border-stone-200 bg-stone-50 font-mono font-bold text-red-700">{rec.debt.toFixed(3)} {currency}</td>
                  </>
                )}
                {activeModal === 'sales' && (
                  <>
                    <td className="py-2 px-3 text-center border border-stone-200">{rec.salesCount}</td>
                    <td className="py-2 px-3 text-right border border-stone-200 font-mono">
                      {rec.salesCount > 0 ? (rec.revenue / rec.salesCount).toFixed(3) : '0.000'} {currency}
                    </td>
                    <td className="py-2 px-3 text-center border border-stone-200 bg-stone-50 font-mono font-bold">{rec.salesCount}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-8 pt-4 border-t border-stone-300 text-[10px] text-center text-stone-400 font-bold uppercase tracking-widest">
        RAZ de caisse - Fin du rapport d'activité
      </div>
    </div>
  );
}

interface DashboardProps {
  userProfile: UserProfile | null;
}

export default function Dashboard({ userProfile }: DashboardProps) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [saleCostSnapshots, setSaleCostSnapshots] = useState<Record<string, SaleCostLine[]>>({});
  const [repairs, setRepairs] = useState<any[]>([]);
  const [repairCostSnapshots, setRepairCostSnapshots] = useState<Record<string, Record<string, number>>>({});
  const [expenses, setExpenses] = useState<any[]>([]);
  const productCostsRef = useRef<Record<string, number>>({});
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);

  // States for detailed history modal
  const [activeModal, setActiveModal] = useState<'revenue' | 'profit' | 'debt' | 'sales' | 'expenses' | 'stock' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [periodFilter, setPeriodFilter] = useState<'today' | '7' | '30' | '90' | 'year' | 'all' | 'custom'>('30');
  const [financialPeriod, setFinancialPeriod] = useState<'today' | '7' | '30' | '90' | 'year' | 'all'>('today');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortField, setSortField] = useState<'date' | 'value'>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [stockAlertDismissed, setStockAlertDismissed] = useState(false);

  // Real-time track and aggregate stock supplies (expenses/dépenses)
  const [supplies, setSupplies] = useState<any[]>([]);
  const [expensesTab, setExpensesTab] = useState<'daily' | 'detailed'>('daily');
  const [expensesSearch, setExpensesSearch] = useState('');
  const [expensesPage, setExpensesPage] = useState(1);
  const expensesItemsPerPage = 10;

  const [editingSupply, setEditingSupply] = useState<any | null>(null);
  const [editingSupplyQty, setEditingSupplyQty] = useState('');
  const [editingSupplyPrice, setEditingSupplyPrice] = useState('');

  const ownerId = (userProfile?.role === 'admin' ? userProfile?.uid : userProfile?.ownerId) || userProfile?.uid || auth.currentUser?.uid;
  const isAdmin = userProfile?.role === 'admin';
  const canViewBuyPrice = can(userProfile, 'products', 'viewBuyPrice');
  const canViewCosts = can(userProfile, 'reparation', 'viewCosts');
  const canViewMargin = canViewBuyPrice && canViewCosts;

  useEffect(() => {
    if (!canViewMargin && activeModal === 'profit') setActiveModal(null);
  }, [activeModal, canViewMargin]);

  useEffect(() => {
    if (!auth.currentUser || !ownerId) return;
    productCostsRef.current = {};
    // Fetch sales belonging to this store, sort client-side to avoid composite indexes
    const qSales = query(collection(db, 'sales'), where('ownerId', '==', ownerId));
    const unsubscribeSales = onSnapshot(qSales, (snapshot) => {
      const sls = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sale));
      sls.sort((a, b) => {
        const timeA = a.date?.seconds || 0;
        const timeB = b.date?.seconds || 0;
        return timeB - timeA;
      });
      setSales(sls);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'sales'));

    const unsubscribeProds = onSnapshot(query(collection(db, 'products'), where('ownerId', '==', ownerId)), (snapshot) => {
      setProducts(snapshot.docs.map(item => {
        const data = item.data();
        const legacyBuyPrice = isAdmin ? Number(data.buyPrice) || 0 : 0;
        delete data.buyPrice;
        return {
          id: item.id,
          ...data,
          buyPrice: canViewBuyPrice ? (productCostsRef.current[item.id] ?? legacyBuyPrice) : 0,
        } as Product;
      }));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'products'));

    const unsubscribeCosts = canViewBuyPrice
      ? onSnapshot(query(collection(db, 'product_costs'), where('ownerId', '==', ownerId)), snapshot => {
        const costs = Object.fromEntries(snapshot.docs.map(item => [item.id, Number(item.data().buyPrice) || 0]));
        productCostsRef.current = costs;
        setProducts(current => current.map(product => ({
          ...product,
          buyPrice: costs[product.id] ?? product.buyPrice,
        })));
      }, error => handleFirestoreError(error, OperationType.LIST, 'product_costs'))
      : () => {
        productCostsRef.current = {};
      };

    const unsubscribeSupplies = isAdmin
      ? onSnapshot(query(collection(db, 'supplies'), where('ownerId', '==', ownerId)), (snapshot) => {
        const sups = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
        sups.sort((a, b) => {
          const timeA = a.date?.seconds || (a.date instanceof Date ? a.date.getTime() : 0);
          const timeB = b.date?.seconds || (b.date instanceof Date ? b.date.getTime() : 0);
          return timeB - timeA;
        });
        setSupplies(sups);
      }, (error) => handleFirestoreError(error, OperationType.LIST, 'supplies'))
      : () => setSupplies([]);

    const unsubscribeSaleCosts = canViewMargin
      ? onSnapshot(query(collection(db, 'sale_costs'), where('ownerId', '==', ownerId)), snapshot => {
        setSaleCostSnapshots(Object.fromEntries(snapshot.docs.map(item => [
          item.id,
          (item.data().items || []) as SaleCostLine[],
        ])));
      }, error => handleFirestoreError(error, OperationType.LIST, 'sale_costs'))
      : () => setSaleCostSnapshots({});

    const unsubscribeRepairs = isAdmin
      ? onSnapshot(query(collection(db, 'repairs'), where('ownerId', '==', ownerId)), snapshot => {
        setRepairs(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      }, error => handleFirestoreError(error, OperationType.LIST, 'repairs'))
      : () => setRepairs([]);

    const unsubscribeRepairCosts = canViewMargin
      ? onSnapshot(query(collection(db, 'repair_costs'), where('ownerId', '==', ownerId)), snapshot => {
        setRepairCostSnapshots(Object.fromEntries(snapshot.docs.map(item => [
          item.id,
          Object.fromEntries(((item.data().parts || []) as Array<{ productId: string; unitBuyPrice: number }>)
            .map(part => [part.productId, Number(part.unitBuyPrice) || 0])),
        ])));
      }, error => handleFirestoreError(error, OperationType.LIST, 'repair_costs'))
      : () => setRepairCostSnapshots({});

    const unsubscribeExpenses = isAdmin
      ? onSnapshot(query(collection(db, 'expenses'), where('ownerId', '==', ownerId)), snapshot => {
        setExpenses(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      }, error => handleFirestoreError(error, OperationType.LIST, 'expenses'))
      : () => setExpenses([]);

    const unsubscribeStore = onSnapshot(doc(db, 'settings', ownerId), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as StoreSettings;
        setStoreSettings({ ...data, ...normalizeFinancialSettings(data) });
      }
      setLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.GET, `settings/${ownerId}`));

    return () => {
      unsubscribeSales();
      unsubscribeProds();
      unsubscribeCosts();
      unsubscribeSupplies();
      unsubscribeSaleCosts();
      unsubscribeRepairs();
      unsubscribeRepairCosts();
      unsubscribeExpenses();
      unsubscribeStore();
    };
  }, [ownerId, isAdmin, canViewBuyPrice, canViewMargin]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveModal(null);
      }
    };
    if (activeModal) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeModal]);

  const currency = 'DT'; // Configured specifically to Tunisian Dinar

  // Create a product lookup map for buyPrice calculation
  const productBuyPriceMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (canViewBuyPrice) products.forEach(p => { map[p.id] = p.buyPrice || 0; });
    return map;
  }, [products, canViewBuyPrice]);

  // Safe Date Helper
  const getSaleDate = (sale: Sale) => {
    if (!sale.date) return new Date();
    if (typeof sale.date.toDate === 'function') return sale.date.toDate();
    if (sale.date instanceof Date) return sale.date;
    return new Date(sale.date);
  };

  // Standard group calculate for Today's Stats card summary
  const dashboardData = useMemo(() => {
    const today = new Date();

    const isSameDayRobust = (d1: Date, d2: Date) => {
      return d1.getFullYear() === d2.getFullYear() &&
             d1.getMonth() === d2.getMonth() &&
             d1.getDate() === d2.getDate();
    };
    
    // 1. Today's Sales
    const todaySales = sales.filter(s => {
      const sDate = getSaleDate(s);
      return isSameDayRobust(sDate, today);
    });

    // Today's Supplies / Expenses
    const getDate = (value: any) => value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value || 0);
    const todayExpenses = expenses.filter(expense => isSameDayRobust(getDate(expense.date), today));
    const dailyExpenses = todayExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);

    // 2. Chiffre d'affaires
    const dailyRevenue = todaySales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);

    // 3. Paid & Debt
    const dailyPaid = todaySales.reduce((sum, s) => sum + s.paid, 0);
    const dailyDebt = todaySales.reduce((sum, s) => sum + s.debt, 0);

    // 4. Benefice Net
    const saleMargins = todaySales.map(sale => computeSaleProfit(sale, saleCostSnapshots[sale.id]));
    const todayRepairs = isAdmin ? repairs.filter(repair =>
      repair.status === 'livre' && isSameDayRobust(getDate(repair.deliveredAt || repair.date), today)
    ) : [];
    let repairProfit = 0;
    let repairCostsComplete = true;
    todayRepairs.forEach(repair => {
      const costs = repairCostSnapshots[repair.id] || {};
      let partCost = 0;
      (repair.parts || []).forEach((part: any) => {
        const unitBuyPrice = costs[part.productId] ?? part.unitBuyPrice;
        if (typeof unitBuyPrice !== 'number' || !Number.isFinite(unitBuyPrice)) repairCostsComplete = false;
        else partCost += unitBuyPrice * (Number(part.quantity) || 0);
      });
      const totals = computeTotals([
        { total: Number(repair.laborCost) || 0 },
        ...(repair.parts || []).map((part: any) => ({ total: Number(part.total) || 0 })),
      ], Number(repair.discount) || 0, {
        tvaEnabled: repair.tvaEnabled === true,
        tva: repair.tvaRate,
      });
      repairProfit += totals.taxableAmount - partCost;
    });
    const dailyProfit = canViewMargin && saleMargins.every(item => item.complete) && repairCostsComplete
      ? saleMargins.reduce((sum, item) => sum + (item.profit || 0), 0) + repairProfit - dailyExpenses
      : null;

    // 5. Products sold TODAY
    const productCounts: Record<string, { name: string, count: number, total: number }> = {};
    todaySales.forEach(sale => {
      sale.items.forEach(item => {
        if (!productCounts[item.productId]) {
          productCounts[item.productId] = { name: item.name, count: 0, total: 0 };
        }
        productCounts[item.productId].count += item.quantity;
        productCounts[item.productId].total += item.total;
      });
    });

    const topProductsToday = Object.values(productCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // 6. Low stock alerts based on store settings minimum threshold
    const configuredMinStock = (storeSettings?.minStockAlert !== undefined && storeSettings.minStockAlert >= 0)
      ? storeSettings.minStockAlert
      : 5;

    const lowStockAlerts = products.filter(p => {
      if (p.inventoryType === 'service') return false;
      const effectiveThreshold = (p.lowStockAlert !== undefined && p.lowStockAlert >= 0)
        ? p.lowStockAlert
        : configuredMinStock;
      return p.stock <= effectiveThreshold;
    });

    return {
      dailyRevenue,
      dailyPaid,
      dailyDebt,
      dailyProfit,
      dailyExpenses,
      todaySalesCount: todaySales.length,
      topProductsToday,
      lowStockAlerts,
      todaySales,
      configuredMinStock
    };
  }, [sales, products, productBuyPriceMap, saleCostSnapshots, repairs, repairCostSnapshots, expenses, storeSettings, canViewBuyPrice, canViewMargin, isAdmin]);

  const financialSummary = useMemo(() => computeWorkshopSummary(
    sales,
    repairs,
    expenses,
    saleCostSnapshots,
    repairCostSnapshots,
    financialPeriod,
    canViewMargin,
  ), [sales, repairs, expenses, saleCostSnapshots, repairCostSnapshots, financialPeriod, canViewMargin]);

  // Group ALL sales chronologically by day to build historical statistics dynamically
  const dailyRecords = useMemo(() => {
    const dailyMap: Record<string, {
      dateStr: string; // YYYY-MM-DD
      dateObj: Date;
      revenue: number;
      profit: number;
      profitComplete: boolean;
      debt: number;
      salesCount: number;
      cashAmount: number;
    }> = {};

    const getDayKey = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const getOrCreate = (date: Date) => {
      const dayKey = getDayKey(date);
      if (!dailyMap[dayKey]) {
        dailyMap[dayKey] = {
          dateStr: dayKey,
          dateObj: date,
          revenue: 0,
          profit: 0,
          profitComplete: true,
          debt: 0,
          salesCount: 0,
          cashAmount: 0,
        };
      }
      return dailyMap[dayKey];
    };

    sales.forEach(sale => {
      const sDate = getSaleDate(sale);
      const record = getOrCreate(sDate);
      const margin = computeSaleProfit(sale, saleCostSnapshots[sale.id]);
      record.revenue += margin.revenueExcludingTax;
      if (margin.profit === null) record.profitComplete = false;
      else record.profit += margin.profit;
      record.debt += sale.debt || 0;
      record.salesCount += 1;
      record.cashAmount += sale.paid || 0;
    });

    if (isAdmin) {
      repairs.filter(repair => repair.status === 'livre').forEach(repair => {
        const dateValue = repair.deliveredAt || repair.date;
        const date = dateValue?.toDate ? dateValue.toDate() : new Date(dateValue || 0);
        const record = getOrCreate(date);
        const costs = repairCostSnapshots[repair.id] || {};
        let partsCost = 0;
        (repair.parts || []).forEach((part: any) => {
          const buyPrice = costs[part.productId] ?? part.unitBuyPrice;
          if (typeof buyPrice !== 'number' || !Number.isFinite(buyPrice)) record.profitComplete = false;
          else partsCost += buyPrice * (Number(part.quantity) || 0);
        });
        const totals = computeTotals([
          { total: Number(repair.laborCost) || 0 },
          ...(repair.parts || []).map((part: any) => ({ total: Number(part.total) || 0 })),
        ], Number(repair.discount) || 0, {
          tvaEnabled: repair.tvaEnabled === true,
          tva: repair.tvaRate,
        });
        record.revenue += totals.taxableAmount;
        record.profit += totals.taxableAmount - partsCost;
        record.debt += Number(repair.debt) || 0;
        record.cashAmount += Number(repair.paid) || 0;
      });
      expenses.forEach(expense => {
        const value = expense.date?.toDate ? expense.date.toDate() : new Date(expense.date || 0);
        const record = getOrCreate(value);
        record.profit -= Number(expense.amount) || 0;
      });
      expenses.forEach(expense => {
        const value = expense.date?.toDate ? expense.date.toDate() : new Date(expense.date || 0);
        const record = getOrCreate(value);
        record.profit -= Number(expense.amount) || 0;
      });
    }

    return Object.values(dailyMap);
  }, [sales, saleCostSnapshots, repairs, repairCostSnapshots, expenses, isAdmin]);

  // Group ALL supplies chronologically by day to build historical expenses statistics dynamically
  const dailySuppliesRecords = useMemo(() => {
    const dailyMap: Record<string, {
      dateStr: string; // YYYY-MM-DD
      dateObj: Date;
      productsCount: number; // unique operations or product additions count
      totalQty: number;      // total items added
      totalExpenses: number; // total cost of purchases
    }> = {};

    supplies.forEach(sup => {
      const sDate = !sup.date ? new Date() : (typeof sup.date.toDate === 'function' ? sup.date.toDate() : new Date(sup.date));
      const year = sDate.getFullYear();
      const month = String(sDate.getMonth() + 1).padStart(2, '0');
      const day = String(sDate.getDate()).padStart(2, '0');
      const dayKey = `${year}-${month}-${day}`;

      if (!dailyMap[dayKey]) {
        dailyMap[dayKey] = {
          dateStr: dayKey,
          dateObj: sDate,
          productsCount: 0,
          totalQty: 0,
          totalExpenses: 0
        };
      }

      const record = dailyMap[dayKey];
      record.productsCount += 1;
      record.totalQty += (sup.quantity || 0);
      record.totalExpenses += (sup.totalCost || 0);
    });

    return Object.values(dailyMap).sort((a, b) => b.dateStr.localeCompare(a.dateStr));
  }, [supplies]);

  // Handle Search & Filter & Sorter for the Active Historical Data
  const filteredAndSortedRecords = useMemo(() => {
    let result = [...dailyRecords];

    // 1. Searching by Date
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      result = result.filter(rec => {
        const formatted = rec.dateObj.toLocaleDateString('fr-FR'); // ex: "22/06/2026"
        return formatted.toLowerCase().includes(q) || rec.dateStr.includes(q);
      });
    }

    // 2. Period Filter
    const todayLimit = new Date();
    todayLimit.setHours(23, 59, 59, 999);

    if (periodFilter === 'today') {
      const boundary = new Date();
      boundary.setHours(0, 0, 0, 0);
      result = result.filter(rec => rec.dateObj >= boundary);
    } else if (periodFilter === '7') {
      const boundary = new Date();
      boundary.setDate(todayLimit.getDate() - 6);
      result = result.filter(rec => rec.dateObj >= boundary);
    } else if (periodFilter === '30') {
      const boundary = new Date();
      boundary.setDate(todayLimit.getDate() - 29);
      result = result.filter(rec => rec.dateObj >= boundary);
    } else if (periodFilter === '90') {
      const boundary = new Date();
      boundary.setDate(todayLimit.getDate() - 89);
      result = result.filter(rec => rec.dateObj >= boundary);
    } else if (periodFilter === 'year') {
      const boundary = new Date(todayLimit.getFullYear(), 0, 1);
      result = result.filter(rec => rec.dateObj >= boundary);
    } else if (periodFilter === 'custom') {
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        result = result.filter(rec => rec.dateObj >= start);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        result = result.filter(rec => rec.dateObj <= end);
      }
    }

    // 3. Sorting
    result.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'date') {
        comparison = a.dateObj.getTime() - b.dateObj.getTime();
      } else {
        // Sort by value depending on current context
        const valA = activeModal === 'revenue' ? a.revenue
          : activeModal === 'profit' ? a.profit
          : activeModal === 'debt' ? a.debt
          : a.salesCount;
        const valB = activeModal === 'revenue' ? b.revenue
          : activeModal === 'profit' ? b.profit
          : activeModal === 'debt' ? b.debt
          : b.salesCount;
        comparison = valA - valB;
      }
      return sortAsc ? comparison : -comparison;
    });

    return result;
  }, [dailyRecords, searchQuery, periodFilter, startDate, endDate, sortField, sortAsc, activeModal]);

  // Remaining Stock valuation and profit margins calculations - automatically refreshed in real-time
  const stockValuation = useMemo(() => {
    let totalItemsCount = 0;
    let inStockItemsCount = 0; // Produits réellement existants en stock (quantité > 0)
    let totalStockQty = 0;
    let totalBuyValue = 0;
    let totalSellValue = 0; // Estimated revenues
    
    products.forEach(p => {
      const stock = p.stock || 0;
      totalItemsCount += 1;
      if (stock > 0) inStockItemsCount += 1;
      totalStockQty += stock;
      if (canViewBuyPrice) totalBuyValue += stock * (p.buyPrice || 0);
      totalSellValue += stock * (p.sellPrice || 0);
    });
    
    const theoreticalMargin = canViewMargin ? totalSellValue - totalBuyValue : 0;
    const marginRatio = canViewMargin && totalSellValue > 0 ? (theoreticalMargin / totalSellValue) * 100 : 0;
    
    return {
      totalItemsCount,
      inStockItemsCount,
      outOfStockCount: totalItemsCount - inStockItemsCount,
      totalStockQty,
      totalBuyValue,
      totalSellValue,
      theoreticalMargin,
      marginRatio
    };
  }, [products, canViewBuyPrice, canViewMargin]);

  const filteredAndSortedProducts = useMemo(() => {
    if (activeModal !== 'stock') return [];
    let result = [...products];

    // 1. Searching by Product Name or Barcode or Category
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      result = result.filter(p => 
        (p.name || '').toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
      );
    }

    // 2. Sorting
    result.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'date') {
        // Sort by name for 'date' field in stock modal context
        comparison = (a.name || '').localeCompare(b.name || '');
      } else {
        // Sort by total stock valuation (sell price) or stock level
        const stockValA = (a.stock || 0) * (a.sellPrice || 0);
        const stockValB = (b.stock || 0) * (b.sellPrice || 0);
        comparison = stockValA - stockValB;
      }
      return sortAsc ? comparison : -comparison;
    });

    return result;
  }, [products, searchQuery, sortField, sortAsc, activeModal]);

  // Paginated records list
  const paginatedRecords = useMemo(() => {
    const startIdx = (currentPage - 1) * itemsPerPage;
    if (activeModal === 'stock') {
      return filteredAndSortedProducts.slice(startIdx, startIdx + itemsPerPage);
    }
    return filteredAndSortedRecords.slice(startIdx, startIdx + itemsPerPage);
  }, [filteredAndSortedRecords, filteredAndSortedProducts, currentPage, activeModal]);

  const totalPages = useMemo(() => {
    if (activeModal === 'stock') {
      return Math.ceil(filteredAndSortedProducts.length / itemsPerPage);
    }
    return Math.ceil(filteredAndSortedRecords.length / itemsPerPage);
  }, [filteredAndSortedRecords, filteredAndSortedProducts, activeModal]);

  // Excel (.xlsx) sheets generator
  const handleExportHistory = () => {
    try {
      if (activeModal === 'stock') {
        if (filteredAndSortedProducts.length === 0) {
          alert("Aucun enregistrement à exporter.");
          return;
        }

        const rows = filteredAndSortedProducts.map(p => {
          const stock = p.stock || 0;
          const buyValue = canViewBuyPrice ? stock * (p.buyPrice || 0) : 0;
          const sellValue = stock * (p.sellPrice || 0);
          const theoreticalMargin = canViewMargin ? sellValue - buyValue : 0;
          const ratio = canViewMargin && sellValue > 0 ? ((theoreticalMargin / sellValue) * 100).toFixed(1) + '%' : '0.0%';
          return {
            'Désignation du Produit': p.name || '',
            'Code barre': p.barcode || 'Sans codebarre',
            'Catégorie': p.category || 'Général',
            'Quantité en stock': stock,
            'Prix de vente unitaire (DT)': (p.sellPrice || 0).toFixed(3),
            'Valeur de vente totale (Revenus) (DT)': sellValue.toFixed(3),
            ...(canViewBuyPrice ? {
              'Prix d\'achat unitaire (DT)': (p.buyPrice || 0).toFixed(3),
              'Valeur d\'achat totale (DT)': buyValue.toFixed(3),
            } : {}),
            ...(canViewMargin ? {
              'Marge théorique estimée (DT)': theoreticalMargin.toFixed(3),
              'Ratio Marge (%)': ratio,
            } : {}),
          };
        });

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();

        // Feuille de synthèse : état instantané du stock
        const now = new Date();
        const summaryRows = [
          { 'Indicateur': 'Date et heure du calcul', 'Valeur': `${now.toLocaleDateString('fr-FR')} ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` },
          { 'Indicateur': 'Produits existants en stock (quantité > 0)', 'Valeur': stockValuation.inStockItemsCount },
          { 'Indicateur': 'Références totales répertoriées', 'Valeur': stockValuation.totalItemsCount },
          { 'Indicateur': 'Produits en rupture de stock', 'Valeur': stockValuation.outOfStockCount },
          { 'Indicateur': 'Quantité totale en stock (unités)', 'Valeur': stockValuation.totalStockQty },
          { 'Indicateur': `Valeur du stock à cet instant — Vente potentielle (${currency})`, 'Valeur': stockValuation.totalSellValue.toFixed(3) },
          ...(canViewBuyPrice ? [
            { 'Indicateur': `Valeur du stock à cet instant — Achat (${currency})`, 'Valeur': stockValuation.totalBuyValue.toFixed(3) },
          ] : []),
          ...(canViewMargin ? [
            { 'Indicateur': `Marge théorique estimée (${currency})`, 'Valeur': stockValuation.theoreticalMargin.toFixed(3) },
            { 'Indicateur': 'Taux de marge moyen (%)', 'Valeur': stockValuation.marginRatio.toFixed(1) + '%' }
          ] : [])
        ];
        const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
        wsSummary['!cols'] = [{ wch: 48 }, { wch: 24 }];
        XLSX.utils.book_append_sheet(wb, wsSummary, 'Synthèse');

        XLSX.utils.book_append_sheet(wb, ws, 'Valorisation Stock');
        XLSX.writeFile(wb, `Rapport_Valorisation_Stock_${new Date().toISOString().split('T')[0]}.xlsx`);
        return;
      }

      if (filteredAndSortedRecords.length === 0) {
        alert("Aucun enregistrement à exporter.");
        return;
      }

      const rows = filteredAndSortedRecords.map(rec => {
        const fmtDate = rec.dateObj.toLocaleDateString('fr-FR');
        if (activeModal === 'revenue') {
          return {
            'Date': fmtDate,
            'Nombre de Ventes': rec.salesCount,
            'Total Encaissé (DT)': rec.cashAmount.toFixed(3),
            'Dettes Générées (DT)': rec.debt.toFixed(3),
            'Chiffre d\'Affaires (DT)': rec.revenue.toFixed(3)
          };
        } else if (activeModal === 'profit') {
          const ratio = rec.profitComplete && rec.revenue > 0 ? ((rec.profit / rec.revenue) * 100).toFixed(1) + '%' : '—';
          return {
            'Date': fmtDate,
            'Chiffre d\'Affaires (DT)': rec.revenue.toFixed(3),
            'Coûts et dépenses (DT)': rec.profitComplete ? (rec.revenue - rec.profit).toFixed(3) : 'Coûts manquants',
            'Marge Ratio (%)': ratio,
            'Bénéfice Net (DT)': rec.profitComplete ? rec.profit.toFixed(3) : 'Coûts manquants'
          };
        } else if (activeModal === 'debt') {
          return {
            'Date': fmtDate,
            'Chiffre d\'Affaires (DT)': rec.revenue.toFixed(3),
            'Montant Payé (DT)': rec.cashAmount.toFixed(3),
            'Transactions total': rec.salesCount,
            'Total des Impayés (DT)': rec.debt.toFixed(3)
          };
        } else {
          return {
            'Date': fmtDate,
            'Tickets encaissés': rec.salesCount,
            'Panier Moyen (DT)': rec.salesCount > 0 ? (rec.revenue / rec.salesCount).toFixed(3) : '0.000',
            'Nombre total Transactions': rec.salesCount
          };
        }
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      
      let tabName = 'Chiffre d\'Affaires';
      if (activeModal === 'profit') tabName = 'Bénéfice Net';
      else if (activeModal === 'debt') tabName = 'Dettes';
      else if (activeModal === 'sales') tabName = 'Transactions';

      XLSX.utils.book_append_sheet(wb, ws, tabName.slice(0, 30));
      XLSX.writeFile(wb, `Rapport_Caisse_${tabName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (e) {
      console.error(e);
      alert("Une erreur est survenue lors de l'exportation vers Excel.");
    }
  };

  const openHistoryModal = (type: 'revenue' | 'profit' | 'debt' | 'sales' | 'expenses' | 'stock') => {
    if (!canViewMargin && type === 'profit') return;
    setActiveModal(type);
    setSearchQuery('');
    setPeriodFilter('30');
    setStartDate('');
    setEndDate('');
    setSortField('date');
    setSortAsc(false); // Newest first by default
    setCurrentPage(1);
    setExpensesTab('daily');
    setExpensesSearch('');
    setExpensesPage(1);
  };

  const filteredSupplies = useMemo(() => {
    let result = [...supplies];
    if (expensesSearch.trim() !== '') {
      const q = expensesSearch.toLowerCase();
      result = result.filter(sup => 
        (sup.productName || '').toLowerCase().includes(q) ||
        (sup.date && typeof sup.date.toDate === 'function' && sup.date.toDate().toLocaleDateString('fr-FR').includes(q))
      );
    }
    return result;
  }, [supplies, expensesSearch]);

  const paginatedSupplies = useMemo(() => {
    const start = (expensesPage - 1) * expensesItemsPerPage;
    return filteredSupplies.slice(start, start + expensesItemsPerPage);
  }, [filteredSupplies, expensesPage]);

  const totalExpensesPages = Math.ceil(filteredSupplies.length / expensesItemsPerPage);

  const exportExpensesToExcel = () => {
    try {
      let rows: any[] = [];
      let filename = '';
      if (expensesTab === 'daily') {
        rows = dailySuppliesRecords.map(rec => ({
          'Date': rec.dateObj.toLocaleDateString('fr-FR'),
          'Nombre de produits ajoutés': rec.productsCount,
          'Quantité totale ajoutée': rec.totalQty,
          'Dépenses totales (DT)': rec.totalExpenses.toFixed(3)
        }));
        filename = `Depenses_Journalieres`;
      } else {
        rows = supplies.map(sup => {
          const timestampStr = !sup.date ? '' : (typeof sup.date.toDate === 'function' ? sup.date.toDate().toLocaleString('fr-FR') : new Date(sup.date).toLocaleString('fr-FR'));
          return {
            'Date et Heure': timestampStr,
            'Produit': sup.productName || '',
            'Quantité Ajoutée': sup.quantity || 0,
            'Prix d\'achat unitaire (DT)': (sup.buyPrice || 0).toFixed(3),
            'Coût Total (DT)': (sup.totalCost || 0).toFixed(3)
          };
        });
        filename = `Details_Depenses`;
      }

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Dépenses');
      XLSX.writeFile(wb, `${filename}_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (e) {
      console.error(e);
      alert("Une erreur est survenue lors de l'exportation vers Excel.");
    }
  };

  const handleUpdateSupply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSupply) return;
    try {
      const newQty = parseInt(editingSupplyQty) || 0;
      const newPrice = parseFloat(editingSupplyPrice) || 0;
      if (newQty <= 0) return;

      const oldQty = editingSupply.quantity || 0;
      const quantityDiff = newQty - oldQty;

      // 1. Update matching product stock reference in Firestore
      if (editingSupply.productId) {
        const prodRef = doc(db, 'products', editingSupply.productId);
        const matchingProd = products.find(p => p.id === editingSupply.productId);
        if (matchingProd) {
          const updatedStock = Math.max(0, (matchingProd.stock || 0) + quantityDiff);
          await updateDoc(prodRef, { 
            stock: updatedStock,
            buyPrice: newPrice 
          });
        }
      }

      // 2. Update supply document in Firestore
      await updateDoc(doc(db, 'supplies', editingSupply.id), {
        quantity: newQty,
        buyPrice: newPrice,
        totalCost: newQty * newPrice
      });

      setEditingSupply(null);
    } catch (err) {
      console.error('Error updating supply:', err);
      alert('Erreur lors de la modification de l\'approvisionnement.');
    }
  };

  const handleDeleteSupply = async (supply: any) => {
    if (!window.confirm(`Voulez-vous vraiment supprimer cet approvisionnement pour "${supply.productName}" ?`)) return;
    try {
      // 1. Subtract supply quantity from product stock
      if (supply.productId) {
        const prodRef = doc(db, 'products', supply.productId);
        const matchingProd = products.find(p => p.id === supply.productId);
        if (matchingProd) {
          const updatedStock = Math.max(0, (matchingProd.stock || 0) - (supply.quantity || 0));
          await updateDoc(prodRef, { stock: updatedStock });
        }
      }

      // 2. Delete the supply doc
      await deleteDoc(doc(db, 'supplies', supply.id));
    } catch (err) {
      console.error('Error deleting supply:', err);
      alert('Erreur lors de la suppression.');
    }
  };

  const financialCards = [
    { label: 'Réparations', value: financialSummary.repairCount, unit: 'réparations', style: 'from-blue-600 to-indigo-700', icon: Wrench, count: true },
    { label: 'Encaissé', value: financialSummary.collected, unit: currency, style: 'from-emerald-500 to-teal-700', icon: Wallet, count: false },
    ...(canViewMargin ? [
      { label: 'Bénéfice brut', value: financialSummary.grossProfit, unit: currency, style: 'from-violet-600 to-purple-800', icon: Coins, count: false },
    ] : []),
    { label: 'Impayés', value: financialSummary.debt, unit: currency, style: 'from-rose-500 to-red-700', icon: AlertCircle, count: false },
  ];
  const historicalTvaSalesCount = sales.filter(sale => Number(sale.tva) > 0).length;

  if (loading) return (
    <div className="h-full min-h-[60vh] flex flex-col items-center justify-center gap-3">
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-slate-200 border-b-indigo-600"></div>
      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest animate-pulse">Chargement des indicateurs...</p>
    </div>
  );

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Tableau de Bord</h1>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mt-0.5">Performance financière et opérationnelle en temps réel</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dashboardData.lowStockAlerts.length > 0 && stockAlertDismissed && (
            <button
              type="button"
              onClick={() => setStockAlertDismissed(false)}
              className="flex items-center gap-1.5 text-xs font-black bg-rose-50 text-rose-700 px-3 py-1.5 rounded-xl border border-rose-200 hover:bg-rose-100 transition-colors animate-pulse cursor-pointer shadow-xs"
              title="Cliquer pour afficher la notification d'alerte de stock"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
              <span>{dashboardData.lowStockAlerts.length} alerte{dashboardData.lowStockAlerts.length > 1 ? 's' : ''} de stock (Afficher)</span>
            </button>
          )}
          <div className="flex items-center gap-2 text-xs font-semibold bg-indigo-50/50 text-indigo-700 px-3 py-1.5 rounded-xl border border-indigo-100 w-fit">
            <Calendar className="w-4 h-4" />
            <span>Aujourd'hui, {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-500">Synthèse financière</h2>
          <select
            value={financialPeriod}
            onChange={event => setFinancialPeriod(event.target.value as typeof financialPeriod)}
            className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
            aria-label="Période de la synthèse financière"
          >
            <option value="today">Aujourd'hui</option>
            <option value="7">7 jours</option>
            <option value="30">30 jours</option>
            <option value="90">90 jours</option>
            <option value="year">Cette année</option>
            <option value="all">Tout</option>
          </select>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {financialCards.map(({ label, value, unit, style, icon: Icon, count }) => (
            <article key={label} className={`flex min-h-28 items-center justify-between rounded-2xl bg-gradient-to-br ${style} p-4 text-white shadow-md sm:p-5`}>
              <div className="min-w-0">
                <p className="truncate text-[10px] font-black uppercase tracking-wider text-white/75">{label}</p>
                <p className="mt-2 truncate font-mono text-2xl font-black tabular-nums">
                  {value === null ? '—' : count ? value : value.toFixed(3)}
                  {value !== null && <span className="ml-1 text-sm font-bold">{unit}</span>}
                </p>
              </div>
              <Icon className="h-8 w-8 shrink-0 opacity-80" aria-hidden="true" />
            </article>
          ))}
        </div>
        {canViewMargin && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
            <strong>CA réparations :</strong> main-d’œuvre {financialSummary.laborRevenue.toFixed(3)} {currency}
            {' · '}pièces facturées {financialSummary.repairPartsRevenue.toFixed(3)} {currency}
            {' · '}coût des pièces {financialSummary.repairPartsCost.toFixed(3)} {currency}
            {' · '}{financialSummary.salesWithTva} vente(s) avec TVA sur la période
            {' · '}historique total : {historicalTvaSalesCount} vente(s) avec TVA
            {(financialSummary.incompleteSales > 0 || financialSummary.incompleteRepairs > 0) && (
              <p role="status" className="mt-2 font-semibold text-amber-700">
                Bénéfice masqué : coûts historiques manquants pour {financialSummary.incompleteSales} vente(s)
                {financialSummary.incompleteRepairs ? ' ou certaines réparations' : ''}. Aucun coût estimé n’est utilisé.
              </p>
            )}
          </div>
        )}
      </section>

      {/* SYSTÈME D'ALERTE VISUELLE : NOTIFICATION DE STOCK MINIMUM */}
      {dashboardData.lowStockAlerts.length > 0 && !stockAlertDismissed && (
        <div className="relative overflow-hidden rounded-3xl border border-rose-200/90 bg-gradient-to-r from-rose-50 via-amber-50/30 to-rose-50 p-4 sm:p-5 shadow-sm transition-all">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            
            {/* Left: Icon & Details */}
            <div className="flex items-start gap-3.5">
              <div className="relative flex items-center justify-center shrink-0 mt-0.5">
                <div className="w-10 h-10 rounded-2xl bg-rose-600 text-white flex items-center justify-center shadow-md shadow-rose-600/30">
                  <AlertTriangle className="w-5 h-5 animate-pulse" />
                </div>
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-600"></span>
                </span>
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-black text-rose-900 tracking-tight">
                    Alerte de Stock Faible ({dashboardData.lowStockAlerts.length} produit{dashboardData.lowStockAlerts.length > 1 ? 's' : ''})
                  </h3>
                  <span className="text-[10px] font-black uppercase tracking-wider bg-rose-200/80 text-rose-800 px-2 py-0.5 rounded-full">
                    Seuil minimum : {dashboardData.configuredMinStock} unités
                  </span>
                  {dashboardData.lowStockAlerts.filter(p => p.stock <= 0).length > 0 && (
                    <span className="text-[10px] font-black uppercase tracking-wider bg-red-600 text-white px-2 py-0.5 rounded-full animate-pulse">
                      {dashboardData.lowStockAlerts.filter(p => p.stock <= 0).length} rupture{dashboardData.lowStockAlerts.filter(p => p.stock <= 0).length > 1 ? 's' : ''} immédiate{dashboardData.lowStockAlerts.filter(p => p.stock <= 0).length > 1 ? 's' : ''} !
                    </span>
                  )}
                </div>
                <p className="text-xs text-rose-700/90 font-medium mt-1">
                  La quantité en stock de ces articles est inférieure ou égale au seuil minimum défini dans vos paramètres ({dashboardData.configuredMinStock} unités). Un réapprovisionnement est recommandé.
                </p>

                {/* Quick list of urgent items */}
                <div className="flex flex-wrap items-center gap-1.5 mt-3">
                  {dashboardData.lowStockAlerts.slice(0, 6).map((prod) => (
                    <div 
                      key={prod.id}
                      onClick={() => openHistoryModal('stock')}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-all cursor-pointer hover:scale-105 active:scale-95 shadow-xs",
                        prod.stock <= 0 
                          ? "bg-red-100 text-red-900 border-red-300" 
                          : "bg-white text-slate-800 border-rose-200"
                      )}
                    >
                      <span className="truncate max-w-[140px]">{prod.name}</span>
                      <span className={cn(
                        "px-1.5 py-0.2 rounded font-mono font-black text-[10px]",
                        prod.stock <= 0 ? "bg-red-600 text-white" : "bg-rose-100 text-rose-800"
                      )}>
                        {prod.stock} restant{prod.stock > 1 ? 's' : ''}
                      </span>
                    </div>
                  ))}
                  {dashboardData.lowStockAlerts.length > 6 && (
                    <button
                      type="button"
                      onClick={() => openHistoryModal('stock')}
                      className="text-[11px] font-bold text-rose-700 underline underline-offset-2 hover:text-rose-900 transition-colors ml-1 cursor-pointer"
                    >
                      +{dashboardData.lowStockAlerts.length - 6} autres produits...
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2 self-end md:self-center shrink-0">
              <button
                type="button"
                onClick={() => openHistoryModal('stock')}
                className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-rose-600/20 active:scale-95 cursor-pointer flex items-center gap-1.5"
              >
                <Package className="w-3.5 h-3.5" />
                <span>Gérer le Stock</span>
              </button>
              <button
                type="button"
                onClick={() => setStockAlertDismissed(true)}
                title="Masquer l'alerte temporairement"
                className="p-2 text-rose-400 hover:text-rose-700 hover:bg-rose-100/60 rounded-xl transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Main Stats Grid with responsive 2-column layout and optimized sizing */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3.5 sm:gap-5">
        
        {/* CARD 1: Chiffre d'Affaires - BLEU */}
        <div 
          onClick={() => openHistoryModal('revenue')}
          className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-850 text-white rounded-2xl sm:rounded-3xl p-3.5 sm:p-6 shadow-xl shadow-blue-500/20 hover:scale-[1.03] active:scale-[0.98] cursor-pointer transition-all duration-300 flex flex-col justify-between min-h-[140px] sm:min-h-[170px] relative overflow-hidden group ring-offset-2 hover:ring-2 hover:ring-blue-500/55"
        >
          <div className="absolute top-0 right-0 p-8 translate-x-4 -translate-y-4 bg-white/5 rounded-full blur-xl group-hover:scale-150 transition-transform duration-500"></div>
          <div className="flex items-center justify-between relative z-10 gap-1">
            <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-blue-100/85 truncate">CA Jour</span>
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md group-hover:bg-white/20 transition-colors shrink-0">
              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-blue-100" />
            </div>
          </div>
          <div className="mt-3 sm:mt-4 relative z-10">
            <div className="flex items-baseline gap-1">
              <span className="text-xl sm:text-[28px] lg:text-[30px] font-black font-mono tracking-tight leading-none truncate">
                {dashboardData.dailyRevenue.toFixed(3)}
              </span>
              <span className="text-[10px] sm:text-xs font-black text-blue-150 shrink-0">{currency}</span>
            </div>
            <p className="text-[8px] sm:text-[9px] font-bold text-blue-100/70 mt-1.5 sm:mt-2.5 flex items-center gap-1">
              <Clock className="w-3 h-3 shrink-0" />
              <span className="truncate">Historique</span>
            </p>
          </div>
        </div>

        {canViewMargin && <div 
          onClick={() => openHistoryModal('profit')}
          className="bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-800 text-white rounded-2xl sm:rounded-3xl p-3.5 sm:p-6 shadow-xl shadow-emerald-500/20 hover:scale-[1.03] active:scale-[0.98] cursor-pointer transition-all duration-300 flex flex-col justify-between min-h-[140px] sm:min-h-[170px] relative overflow-hidden group ring-offset-2 hover:ring-2 hover:ring-emerald-500/55"
        >
          <div className="absolute top-0 right-0 p-8 translate-x-4 -translate-y-4 bg-white/5 rounded-full blur-xl group-hover:scale-150 transition-transform duration-500"></div>
          <div className="flex items-center justify-between relative z-10 gap-1">
            <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-emerald-100/85 truncate">Bénéfice Net</span>
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md group-hover:bg-white/20 transition-colors shrink-0">
              <Coins className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-100" />
            </div>
          </div>
          <div className="mt-3 sm:mt-4 relative z-10">
            <div className="flex items-baseline gap-1">
              <span className="text-xl sm:text-[28px] lg:text-[30px] font-black font-mono tracking-tight leading-none truncate">
                {dashboardData.dailyProfit === null ? '—' : dashboardData.dailyProfit.toFixed(3)}
              </span>
              <span className="text-[10px] sm:text-xs font-black text-emerald-150 shrink-0">{currency}</span>
            </div>
            <p className="text-[8px] sm:text-[9px] font-bold text-emerald-100/70 mt-1.5 sm:mt-2.5 flex items-center gap-1">
              <Clock className="w-3 h-3 shrink-0" />
              <span className="truncate">Historique</span>
            </p>
          </div>
        </div>}

        {/* CARD 3: Dépenses du Jour - ORANGE ANGLAIS */}
        <div 
          onClick={() => openHistoryModal('expenses')}
          className="bg-gradient-to-br from-amber-500 via-amber-600 to-orange-700 text-white rounded-2xl sm:rounded-3xl p-3.5 sm:p-6 shadow-xl shadow-amber-500/20 hover:scale-[1.03] active:scale-[0.98] cursor-pointer transition-all duration-300 flex flex-col justify-between min-h-[140px] sm:min-h-[170px] relative overflow-hidden group ring-offset-2 hover:ring-2 hover:ring-amber-500/55"
        >
          <div className="absolute top-0 right-0 p-8 translate-x-4 -translate-y-4 bg-white/5 rounded-full blur-xl group-hover:scale-150 transition-transform duration-500"></div>
          <div className="flex items-center justify-between relative z-10 gap-1">
            <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-amber-100/85 truncate">Dépenses</span>
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md group-hover:bg-white/20 transition-colors shrink-0">
              <PackagePlus className="w-4 h-4 sm:w-5 sm:h-5 text-amber-100" />
            </div>
          </div>
          <div className="mt-3 sm:mt-4 relative z-10">
            <div className="flex items-baseline gap-1">
              <span className="text-xl sm:text-[28px] lg:text-[30px] font-black font-mono tracking-tight leading-none truncate">
                {dashboardData.dailyExpenses.toFixed(3)}
              </span>
              <span className="text-[10px] sm:text-xs font-black text-amber-150 shrink-0">{currency}</span>
            </div>
            <p className="text-[8px] sm:text-[9px] font-bold text-amber-100/70 mt-1.5 sm:mt-2.5 flex items-center gap-1">
              <Clock className="w-3 h-3 shrink-0" />
              <span className="truncate">Historique</span>
            </p>
          </div>
        </div>

        {/* CARD 4: Dettes - ROUGE */}
        <div 
          onClick={() => openHistoryModal('debt')}
          className="bg-gradient-to-br from-rose-500 via-rose-600 to-red-700 text-white rounded-2xl sm:rounded-3xl p-3.5 sm:p-6 shadow-xl shadow-rose-500/20 hover:scale-[1.03] active:scale-[0.98] cursor-pointer transition-all duration-300 flex flex-col justify-between min-h-[140px] sm:min-h-[170px] relative overflow-hidden group ring-offset-2 hover:ring-2 hover:ring-rose-500/55"
        >
          <div className="absolute top-0 right-0 p-8 translate-x-4 -translate-y-4 bg-white/5 rounded-full blur-xl group-hover:scale-150 transition-transform duration-500"></div>
          <div className="flex items-center justify-between relative z-10 gap-1">
            <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-rose-100/85 truncate">Dettes</span>
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md group-hover:bg-white/20 transition-colors shrink-0">
              <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 text-rose-100" />
            </div>
          </div>
          <div className="mt-3 sm:mt-4 relative z-10">
            <div className="flex items-baseline gap-1">
              <span className="text-xl sm:text-[28px] lg:text-[30px] font-black font-mono tracking-tight leading-none truncate">
                {dashboardData.dailyDebt.toFixed(3)}
              </span>
              <span className="text-[10px] sm:text-xs font-black text-rose-150 shrink-0">{currency}</span>
            </div>
            <p className="text-[8px] sm:text-[9px] font-bold text-rose-100/70 mt-1.5 sm:mt-2.5 flex items-center gap-1">
              <Clock className="w-3 h-3 shrink-0" />
              <span className="truncate">Historique</span>
            </p>
          </div>
        </div>

        {/* CARD 5: Nombre de ventes - VIOLET */}
        <div 
          onClick={() => openHistoryModal('sales')}
          className="col-span-2 sm:col-span-1 bg-gradient-to-br from-purple-500 via-purple-600 to-violet-850 text-white rounded-2xl sm:rounded-3xl p-3.5 sm:p-6 shadow-xl shadow-purple-500/20 hover:scale-[1.03] active:scale-[0.98] cursor-pointer transition-all duration-300 flex flex-col justify-between min-h-[140px] sm:min-h-[170px] relative overflow-hidden group ring-offset-2 hover:ring-2 hover:ring-purple-500/55"
        >
          <div className="absolute top-0 right-0 p-8 translate-x-4 -translate-y-4 bg-white/5 rounded-full blur-xl group-hover:scale-150 transition-transform duration-500"></div>
          <div className="flex items-center justify-between relative z-10 gap-1">
            <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-purple-100/85 truncate">Ventes</span>
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md group-hover:bg-white/20 transition-colors shrink-0">
              <ShoppingCart className="w-4 h-4 sm:w-5 sm:h-5 text-purple-100" />
            </div>
          </div>
          <div className="mt-3 sm:mt-4 relative z-10">
            <div className="flex items-baseline gap-1">
              <span className="text-xl sm:text-[28px] lg:text-[30px] font-black font-mono tracking-tight leading-none truncate">
                {dashboardData.todaySalesCount}
              </span>
              <span className="text-[10px] sm:text-xs font-black text-purple-150 shrink-0">ventes</span>
            </div>
            <p className="text-[8px] sm:text-[9px] font-bold text-purple-100/70 mt-1.5 sm:mt-2.5 flex items-center gap-1">
              <Clock className="w-3 h-3 shrink-0" />
              <span className="truncate">Historique</span>
            </p>
          </div>
        </div>
      </div>

      {/* SECTION: VALORISATION & PERFORMANCE DU STOCK RESTANT */}
      <div className="bg-white rounded-3xl border border-slate-150 shadow-xs p-6 font-sans">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse"></span>
              <h2 className="text-sm font-black uppercase text-slate-800 tracking-wider">Valorisation & Performance du Stock Restant</h2>
            </div>
            <p className="text-[11px] text-slate-450 font-semibold uppercase mt-0.5">Calculé automatiquement en temps réel à chaque modification de prix ou de stock</p>
          </div>
          <button
            onClick={() => openHistoryModal('stock')}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-indigo-600/10 active:scale-[0.98] cursor-pointer flex items-center gap-1.5 self-start sm:self-auto"
          >
            <BarChart3 className="w-4 h-4" />
            Consulter le Rapport d'Inventaire
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {canViewMargin && <div className="bg-slate-50/70 rounded-2xl p-4 border border-slate-100 flex items-center gap-4 hover:bg-slate-50 transition-colors">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 shadow-xs">
              <Coins className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-black uppercase text-slate-450 tracking-wider block">Valeur d'Achat Totale</span>
              <span className="text-base font-black text-slate-800 font-mono block mt-0.5">
                {stockValuation.totalBuyValue.toFixed(3)} <span className="text-xs text-slate-500">{currency}</span>
              </span>
              <span className="text-[10px] text-slate-400 font-bold uppercase block mt-0.5">Investi dans les marchandises</span>
            </div>
          </div>}

          {/* Card: Revenus Potentiels Estimés (Valeur de vente) */}
          <div className="bg-slate-50/70 rounded-2xl p-4 border border-slate-100 flex items-center gap-4 hover:bg-slate-50 transition-colors">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 shadow-xs">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-black uppercase text-slate-450 tracking-wider block">Revenus Potentiels Estimés</span>
              <span className="text-base font-black text-slate-800 font-mono block mt-0.5">
                {stockValuation.totalSellValue.toFixed(3)} <span className="text-xs text-slate-500">{currency}</span>
              </span>
              <span className="text-[10px] text-slate-400 font-bold uppercase block mt-0.5">Chiffre d'affaires estimé</span>
            </div>
          </div>

          {canViewMargin && <div className="bg-slate-50/70 rounded-2xl p-4 border border-slate-100 flex items-center gap-4 hover:bg-slate-50 transition-colors">
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0 shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-black uppercase text-slate-450 tracking-wider block">Bénéfice Théorique (Marge)</span>
              <span className="text-base font-black text-slate-800 font-mono block mt-0.5">
                {stockValuation.theoreticalMargin.toFixed(3)} <span className="text-xs text-slate-500">{currency}</span>
              </span>
              <span className="text-[10px] text-slate-400 font-bold uppercase block mt-0.5">Marge brute théorique</span>
            </div>
          </div>}

          {canViewBuyPrice && <div className="bg-slate-50/70 rounded-2xl p-4 border border-slate-100 flex items-center gap-4 hover:bg-slate-50 transition-colors">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 shadow-xs">
              <Percent className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-black uppercase text-slate-450 tracking-wider block">Marge Commerciale Moyenne</span>
              <span className="text-base font-black text-indigo-700 font-mono block mt-0.5">
                {stockValuation.marginRatio.toFixed(1)}%
              </span>
              <span className="text-[10px] text-slate-400 font-bold uppercase block mt-0.5">Taux de profitabilité du stock</span>
            </div>
          </div>}

        </div>
      </div>

      {/* SECTION: VISUALISATION DU VOLUME DES VENTES SUR LES 7 DERNIERS JOURS */}
      <SalesVolumeChart 
        sales={sales} 
        products={products} 
        currency={currency} 
        showProfit={canViewMargin}
      />

      {/* Main layout divided into 2 Columns (Table on left, stats sidebar on right) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 border-t border-slate-100 pt-8">
        
        {/* LEFT COLUMN: Dernières Ventes (Top 10) */}
        <div className="xl:col-span-2 space-y-6">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-50 flex items-center justify-between bg-slate-50/40">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shadow-xs">
                  <ShoppingCart className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h2 className="font-extrabold text-slate-800 text-sm uppercase tracking-wider">Les 10 Dernières Ventes</h2>
                  <p className="text-[10px] text-slate-400 font-semibold uppercase mt-0.5">Transactions récentes enregistrées</p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              {sales.slice(0, 10).length === 0 ? (
                <div className="text-center py-16 px-4">
                  <ShoppingCart className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                  <p className="text-slate-400 font-bold text-xs uppercase tracking-wider">Aucune vente récente dans le système</p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/40 border-b border-slate-100 text-[10px] font-extrabold text-slate-450 uppercase tracking-wider">
                      <th className="px-6 py-4">Date et Heure</th>
                      <th className="px-6 py-4">Client</th>
                      <th className="px-6 py-4 text-right">Total</th>
                      <th className="px-6 py-4 text-right">Montant payé</th>
                      <th className="px-6 py-4 text-right">Reste à payer</th>
                      <th className="px-6 py-4 text-center">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {sales.slice(0, 10).map((sale) => {
                      const sDate = getSaleDate(sale);
                      const formattedDate = sDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                      const formattedTime = sDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                      return (
                        <tr key={sale.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-slate-700">{formattedDate}</span>
                              <span className="text-[10px] text-slate-450 font-semibold font-mono mt-0.5">{formattedTime}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-xs font-bold text-slate-800">{sale.clientName || 'Client de passage'}</div>
                          </td>
                          <td className="px-6 py-4 text-right whitespace-nowrap">
                            <span className="text-xs font-black text-slate-900 font-mono">{sale.total.toFixed(3)} {currency}</span>
                          </td>
                          <td className="px-6 py-4 text-right whitespace-nowrap">
                            <span className="text-xs font-bold text-emerald-650 font-mono">{sale.paid.toFixed(3)} {currency}</span>
                          </td>
                          <td className="px-6 py-4 text-right whitespace-nowrap">
                            {sale.debt > 0 ? (
                              <span className="text-xs font-bold text-rose-600 font-mono">-{sale.debt.toFixed(3)} {currency}</span>
                            ) : (
                              <span className="text-xs font-bold text-slate-400 font-mono">0.000 {currency}</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center whitespace-nowrap">
                            <span className={cn(
                              "inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider",
                              sale.debt > 0 
                                ? "bg-rose-50 text-rose-600 border border-rose-100" 
                                : "bg-emerald-50 text-emerald-700 border border-emerald-100"
                            )}>
                              {sale.debt > 0 ? 'Crédit' : 'Réglé'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Products Bestsellers and Low Stock alerts */}
        <div className="space-y-6">
          
          {/* Section: Top Products TODAY */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden font-sans">
            <div className="p-5 border-b border-slate-50 flex items-center justify-between bg-slate-50/40">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-xs">
                  <Package className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h2 className="font-extrabold text-slate-800 text-xs uppercase tracking-wider">Top Ventes Aujourd'hui</h2>
                  <p className="text-[10px] text-slate-455 font-semibold uppercase mt-0.5">Par volume d'articles vendus</p>
                </div>
              </div>
            </div>

            <div className="p-5 divide-y divide-slate-50">
              {dashboardData.topProductsToday.length === 0 ? (
                <div className="text-center py-10">
                  <Package className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-slate-400 font-bold text-[11px] uppercase tracking-wider">Aucune vente aujourd'hui</p>
                </div>
              ) : (
                dashboardData.topProductsToday.map((p, idx) => (
                  <div key={idx} className="flex items-center gap-3 py-3 first:pt-1 last:pb-1 hover:bg-slate-50/30 transition-all duration-200">
                    <div className={cn(
                      "w-7 h-7 rounded-lg flex items-center justify-center font-extrabold text-xs shrink-0 shadow-xs",
                      idx === 0 ? "bg-amber-100 text-amber-700" :
                      idx === 1 ? "bg-slate-100 text-slate-700" :
                      idx === 2 ? "bg-orange-100 text-orange-700" : "bg-slate-50 text-slate-500"
                    )}>
                      #{idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-extrabold text-xs text-slate-700 truncate">{p.name}</h4>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-slate-450 font-bold font-mono">{p.count} unités</span>
                        <span className="text-[10px] text-slate-300">|</span>
                        <span className="text-[10px] text-indigo-500 font-black">CA: {p.total.toFixed(3)} {currency}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Section: Low Stock Warning */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-50 flex items-center justify-between bg-slate-50/40">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shadow-xs">
                  <AlertTriangle className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h2 className="font-extrabold text-slate-800 text-xs uppercase tracking-wider">Alerte Stock Faible</h2>
                  <p className="text-[10px] text-slate-450 font-semibold uppercase mt-0.5">
                    Seuil configuré : {dashboardData.configuredMinStock} unités
                  </p>
                </div>
              </div>
              <span className={cn(
                "px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider",
                dashboardData.lowStockAlerts.length > 0 ? "bg-rose-100 text-rose-700" : "bg-emerald-50 text-emerald-700 border border-emerald-100"
              )}>
                {dashboardData.lowStockAlerts.length} produits
              </span>
            </div>

            <div className="p-5 max-h-[350px] overflow-y-auto divide-y divide-slate-50">
              {dashboardData.lowStockAlerts.length === 0 ? (
                <div className="text-center py-10">
                  <Package className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-slate-400 font-bold text-[11px] uppercase tracking-wider">État des stocks satisfaisant</p>
                </div>
              ) : (
                dashboardData.lowStockAlerts.map((product) => {
                  const effectiveThreshold = product.lowStockAlert !== undefined && product.lowStockAlert >= 0 
                    ? product.lowStockAlert 
                    : dashboardData.configuredMinStock;
                  return (
                    <div 
                      key={product.id} 
                      onClick={() => openHistoryModal('stock')}
                      className="flex items-center justify-between py-3 first:pt-1 last:pb-1 hover:bg-slate-50/60 -mx-2 px-2 rounded-xl transition-colors cursor-pointer group"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <h4 className="font-extrabold text-xs text-slate-700 truncate group-hover:text-indigo-600 transition-colors" title={product.name}>
                          {product.name}
                        </h4>
                        <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                          Seuil minimal : {effectiveThreshold} unités
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={cn(
                          "inline-flex font-mono font-black text-xs px-2 py-1 rounded-lg",
                          product.stock <= 0 ? "bg-red-100 text-red-700 border border-red-200 animate-pulse" : "bg-rose-50 text-rose-700 border border-rose-100/50"
                        )}>
                          {product.stock <= 0 ? 'Rupture (0)' : `${product.stock} dispo`}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>
      </div>

      {/* MODAL: INTERACTIVE DAILY HISTORY CONSULTATION */}
      {activeModal && (
        <div 
          onClick={() => setActiveModal(null)}
          className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 cursor-pointer"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl w-full max-w-5xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 cursor-default"
          >
            
            {/* Modal Header */}
            <div className={cn(
              "p-6 text-white flex items-center justify-between relative overflow-hidden shrink-0",
              activeModal === 'revenue' ? "bg-gradient-to-r from-blue-600 to-indigo-800" :
              activeModal === 'profit' ? "bg-gradient-to-r from-emerald-500 to-teal-750" :
              activeModal === 'debt' ? "bg-gradient-to-r from-rose-500 to-red-700" :
              activeModal === 'stock' ? "bg-gradient-to-r from-indigo-600 via-indigo-700 to-slate-900" :
              "bg-gradient-to-r from-purple-500 to-violet-800"
            )}>
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-white/10 to-transparent"></div>
              <div className="relative z-10 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-xs">
                  {activeModal === 'revenue' && <TrendingUp className="w-5 h-5 text-blue-50" />}
                  {activeModal === 'profit' && <Coins className="w-5 h-5 text-emerald-50" />}
                  {activeModal === 'debt' && <AlertCircle className="w-5 h-5 text-rose-50" />}
                  {activeModal === 'sales' && <ShoppingCart className="w-5 h-5 text-purple-50" />}
                  {activeModal === 'stock' && <Package className="w-5 h-5 text-indigo-50" />}
                </div>
                <div>
                  <h3 className="text-lg font-black tracking-tight leading-none">
                    {activeModal === 'revenue' && "Consulter l'Historique : Chiffre d'Affaires"}
                    {activeModal === 'profit' && "Consulter l'Historique : Bénéfice Net"}
                    {activeModal === 'debt' && "Consulter l'Historique : Dettes"}
                    {activeModal === 'sales' && "Consulter l'Historique : Nombre de ventes"}
                    {activeModal === 'stock' && "Rapport de Valorisation & Rentabilité du Stock"}
                  </h3>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-white/70 mt-1">
                    {activeModal === 'revenue' && "Suivi de la courbe des ventes brutes"}
                    {activeModal === 'profit' && "Rendement financier après déduction du coût d'achat"}
                    {activeModal === 'debt' && "Encours clients et d'impayés du jour"}
                    {activeModal === 'sales' && "Intensité de l'activité du magasin"}
                    {activeModal === 'stock' && (canViewMargin
                      ? "Analyse en temps réel de la valeur d'achat, de vente et des marges bénéficiaires de l'inventaire actuel"
                      : "Analyse en temps réel du stock disponible et des revenus potentiels")}
                  </p>
                </div>
              </div>

              <button 
                onClick={() => setActiveModal(null)} 
                className="relative z-10 px-4 py-2 flex items-center gap-2 bg-white/15 hover:bg-white/25 rounded-xl transition-all cursor-pointer text-white text-xs font-black uppercase tracking-wider"
              >
                <X className="w-4 h-4" />
                <span>Fermer</span>
              </button>
            </div>

            {/* Modal Controls / Filters */}
            <div className="p-6 bg-slate-50/50 border-b border-slate-100 flex flex-col gap-4 shrink-0 font-sans">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                
                {/* Search bar */}
                <div className="md:col-span-4 relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="text"
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                    placeholder={activeModal === 'stock' ? "Rechercher un produit, code barre..." : "Rechercher une date (ex: 22/06)..."}
                    className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
                  />
                </div>

                {/* Period Selection or Stock KPIs */}
                {activeModal === 'stock' ? (
                  <div className="md:col-span-8 flex flex-wrap items-center gap-4 md:justify-end">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-white px-4 py-2.5 rounded-2xl border border-slate-100 shadow-xs text-[11px] font-bold text-slate-600">
                      <div>
                        <span>Articles : </span>
                        <span className="text-slate-900 font-black font-mono">{stockValuation.totalItemsCount}</span>
                      </div>
                      <div className="hidden sm:block w-px h-3.5 bg-slate-150"></div>
                      <div>
                        <span>Stock Total : </span>
                        <span className="text-slate-900 font-black font-mono">{stockValuation.totalStockQty}</span>
                      </div>
                      <div className="hidden sm:block w-px h-3.5 bg-slate-150"></div>
                      {canViewBuyPrice && <div>
                        <span>Valeur d'Achat : </span>
                        <span className="text-emerald-650 font-black font-mono">{stockValuation.totalBuyValue.toFixed(3)} {currency}</span>
                      </div>}
                      {canViewBuyPrice && <div className="hidden sm:block w-px h-3.5 bg-slate-150"></div>}
                      <div>
                        <span>Revenus Est. : </span>
                        <span className="text-indigo-600 font-black font-mono">{stockValuation.totalSellValue.toFixed(3)} {currency}</span>
                      </div>
                      {canViewMargin && <div className="hidden sm:block w-px h-3.5 bg-slate-150"></div>}
                      {canViewMargin && <div>
                        <span>Marge Est. : </span>
                        <span className="text-purple-650 font-black font-mono">{stockValuation.theoreticalMargin.toFixed(3)} {currency} ({stockValuation.marginRatio.toFixed(1)}%)</span>
                      </div>}
                    </div>
                  </div>
                ) : (
                  <div className="md:col-span-8 flex flex-wrap items-center gap-2 md:justify-end">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider mr-1">Filtre Période :</span>
                    {(['today', '7', '30', '90', 'year', 'all', 'custom'] as const).map(p => {
                      const label = p === 'today' ? "Aujourd'hui" :
                                    p === '7' ? '7 jours' :
                                    p === '30' ? '30 jours' :
                                    p === '90' ? '90 jours' :
                                    p === 'year' ? 'Cette année' :
                                    p === 'all' ? 'Tout' : 'Personnalisée';
                      return (
                        <button
                          key={p}
                          onClick={() => { setPeriodFilter(p); setCurrentPage(1); }}
                          className={cn(
                            "px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer",
                            periodFilter === p
                              ? "bg-slate-900 text-white shadow-md shadow-slate-900/10"
                              : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Custom date range option */}
              {activeModal !== 'stock' && periodFilter === 'custom' && (
                <div className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-slate-100 shadow-xs max-w-lg animate-in slide-in-from-top-2 duration-200">
                  <div className="relative flex-1">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                    <input 
                      type="date"
                      value={startDate}
                      onChange={(e) => { setStartDate(e.target.value); setCurrentPage(1); }}
                      className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-xl text-xs font-medium outline-none"
                    />
                  </div>
                  <span className="text-slate-400 font-bold text-xs">à</span>
                  <div className="relative flex-1">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                    <input 
                      type="date"
                      value={endDate}
                      onChange={(e) => { setEndDate(e.target.value); setCurrentPage(1); }}
                      className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-xl text-xs font-medium outline-none"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Synthèse instantanée du stock (Rapport de Valorisation) */}
            {activeModal === 'stock' && (
              <div className="px-6 pt-5 shrink-0 font-sans">
                <div className="bg-gradient-to-r from-indigo-600 via-indigo-700 to-violet-700 rounded-2xl p-5 text-white shadow-lg shadow-indigo-600/15 relative overflow-hidden">
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-white/10 to-transparent pointer-events-none"></div>
                  <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-xs shrink-0">
                        <Package className="w-5 h-5 text-indigo-50" />
                      </div>
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-indigo-100/80 block">Produits existants en stock</span>
                        <div className="flex items-baseline gap-1.5 mt-0.5">
                          <span className="text-2xl font-black font-mono leading-none">{stockValuation.inStockItemsCount}</span>
                          <span className="text-[11px] font-bold text-indigo-100/80">/ {stockValuation.totalItemsCount} références</span>
                        </div>
                        {stockValuation.outOfStockCount > 0 && (
                          <span className="text-[9px] font-bold uppercase text-amber-200/90 block mt-0.5">{stockValuation.outOfStockCount} produit(s) en rupture</span>
                        )}
                      </div>
                    </div>
                    <div className="hidden md:block w-px h-12 bg-white/15"></div>
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-indigo-100/80 block">Valeur de mon stock à cet instant</span>
                      <div className="flex items-baseline gap-1.5 mt-0.5">
                        <span className="text-2xl font-black font-mono leading-none">{stockValuation.totalBuyValue.toFixed(3)}</span>
                        <span className="text-[11px] font-bold text-indigo-100/80">{currency} (valeur d'achat)</span>
                      </div>
                      <span className="text-[9px] font-bold uppercase text-indigo-100/70 block mt-0.5">Soit {stockValuation.totalSellValue.toFixed(3)} {currency} en valeur de vente potentielle</span>
                    </div>
                    <div className="hidden md:block w-px h-12 bg-white/15"></div>
                    <div className="text-right md:text-left">
                      <span className="text-[10px] font-black uppercase tracking-widest text-indigo-100/80 block">Calculé le</span>
                      <span className="text-xs font-black font-mono block mt-1">{new Date().toLocaleDateString('fr-FR')} à {new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="text-[9px] font-bold uppercase text-indigo-100/70 block mt-0.5">Temps réel · inventaire actuel</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Modal Table Area (Scrollable body) */}
            <div className="flex-1 overflow-auto font-sans">
              {((activeModal === 'stock' ? filteredAndSortedProducts.length : filteredAndSortedRecords.length) === 0) ? (
                <div className="text-center py-24 px-4 flex flex-col items-center justify-center">
                  <Calendar className="w-12 h-12 text-slate-200 mb-3" />
                  <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">Aucune donnée trouvée</h4>
                  <p className="text-slate-400 font-medium text-[11px] mt-1 max-w-xs">Ajustez la recherche pour visualiser d'autres articles ou données.</p>
                </div>
              ) : (
                <div className="p-6">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-150 text-[10px] font-black uppercase tracking-wider text-slate-450 bg-slate-50/70">
                        {activeModal === 'stock' ? (
                          <>
                            <th 
                              onClick={() => { setSortField('date'); setSortAsc(!sortAsc); }}
                              className="px-6 py-3 cursor-pointer hover:bg-slate-150 transition-colors select-none"
                            >
                              <div className="flex items-center gap-1.5">
                                Désignation du Produit
                                <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                              </div>
                            </th>
                            <th className="px-6 py-3 text-center">Quantité en Stock</th>
                            {canViewBuyPrice && <th className="px-6 py-3 text-right">Prix d'Achat Unit.</th>}
                            <th className="px-6 py-3 text-right">Prix de Vente Unit.</th>
                            {canViewBuyPrice && <th className="px-6 py-3 text-right">Valeur d'Achat Totale</th>}
                            <th className="px-6 py-3 text-right">Valeur de Vente Totale (Revenus Est.)</th>
                            {canViewMargin && <th 
                              onClick={() => { setSortField('value'); setSortAsc(!sortAsc); }}
                              className="px-6 py-3 cursor-pointer hover:bg-slate-155 transition-colors text-right select-none"
                            >
                              <div className="flex items-center gap-1.5 justify-end">
                                Marge Bénéficiaire Théorique
                                <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                              </div>
                            </th>}
                          </>
                        ) : (
                          <th 
                            onClick={() => { setSortField('date'); setSortAsc(!sortAsc); }}
                            className="px-6 py-3 cursor-pointer hover:bg-slate-150 transition-colors select-none"
                          >
                            <div className="flex items-center gap-1.5">
                              Date de l'activité
                              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                            </div>
                          </th>
                        )}
                        
                        {activeModal === 'revenue' && (
                          <>
                            <th className="px-6 py-3 text-center">Nbre Ventes</th>
                            <th className="px-6 py-3 text-right">Montant Encaissé (Liquide)</th>
                            <th className="px-6 py-3 text-right">Dettes Créées</th>
                            <th 
                              onClick={() => { setSortField('value'); setSortAsc(!sortAsc); }}
                              className="px-6 py-3 cursor-pointer hover:bg-slate-155 transition-colors text-right select-none"
                            >
                              <div className="flex items-center gap-1.5 justify-end">
                                Chiffre d'Affaires Brut
                                <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                              </div>
                            </th>
                          </>
                        )}

                        {activeModal === 'profit' && (
                          <>
                            <th className="px-6 py-3 text-right">Chiffre d'Affaires</th>
                            <th className="px-6 py-3 text-right">Coût estimé des articles</th>
                            <th className="px-6 py-3 text-right">Ratio Marge (%)</th>
                            <th 
                              onClick={() => { setSortField('value'); setSortAsc(!sortAsc); }}
                              className="px-6 py-3 cursor-pointer hover:bg-slate-155 transition-colors text-right select-none"
                            >
                              <div className="flex items-center gap-1.5 justify-end">
                                Bénéfice Net
                                <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                              </div>
                            </th>
                          </>
                        )}

                        {activeModal === 'debt' && (
                          <>
                            <th className="px-6 py-3 text-right">Total CA du Jour</th>
                            <th className="px-6 py-3 text-right">Total Crédit Accordé</th>
                            <th className="px-6 py-3 text-center">Nbre Tickets à Crédit</th>
                            <th 
                              onClick={() => { setSortField('value'); setSortAsc(!sortAsc); }}
                              className="px-6 py-3 cursor-pointer hover:bg-slate-155 transition-colors text-right select-none"
                            >
                              <div className="flex items-center gap-1.5 justify-end">
                                Somme des Impayés
                                <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                              </div>
                            </th>
                          </>
                        )}

                        {activeModal === 'sales' && (
                          <>
                            <th className="px-6 py-3 text-center font-bold text-slate-500">Panier Moyen journalier</th>
                            <th className="px-6 py-3 text-right">Ventes encaissées</th>
                            <th 
                              onClick={() => { setSortField('value'); setSortAsc(!sortAsc); }}
                              className="px-6 py-3 cursor-pointer hover:bg-slate-155 transition-colors text-center select-none bg-indigo-50/30"
                            >
                              <div className="flex items-center gap-1.5 justify-center">
                                Nombre de Ventes
                                <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                              </div>
                            </th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paginatedRecords.map((rec, rIdx) => {
                        if (activeModal === 'stock') {
                          const product = rec as Product;
                          const stock = product.stock || 0;
                          const buyVal = canViewBuyPrice ? stock * (product.buyPrice || 0) : 0;
                          const sellVal = stock * (product.sellPrice || 0);
                          const profitVal = canViewMargin ? sellVal - buyVal : 0;
                          return (
                            <tr key={product.id || rIdx} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-6 py-3.5 whitespace-nowrap">
                                <div className="flex flex-col">
                                  <span className="text-xs font-bold text-slate-700">{product.name}</span>
                                  <span className="text-[10px] text-slate-450 font-mono">{product.barcode || 'Sans codebarre'}</span>
                                </div>
                              </td>
                              <td className="px-6 py-3.5 text-center whitespace-nowrap">
                                <span className={cn(
                                  "px-2.5 py-1 rounded-xl text-xs font-black font-mono inline-block border",
                                  stock === 0 ? "bg-red-50 text-red-700 border-red-100" :
                                  stock <= (product.lowStockAlert || 5) ? "bg-rose-50 text-rose-700 border-rose-100" :
                                  "bg-emerald-50 text-emerald-700 border-emerald-100"
                                )}>
                                  {stock} unités
                                </span>
                              </td>
                              {canViewBuyPrice && <td className="px-6 py-3.5 text-right font-semibold text-slate-500 font-mono">
                                {(product.buyPrice || 0).toFixed(3)} {currency}
                              </td>}
                              <td className="px-6 py-3.5 text-right font-bold text-slate-800 font-mono">
                                {(product.sellPrice || 0).toFixed(3)} {currency}
                              </td>
                              {canViewBuyPrice && <td className="px-6 py-3.5 text-right text-slate-500 font-mono">
                                {buyVal.toFixed(3)} {currency}
                              </td>}
                              <td className="px-6 py-3.5 text-right font-black text-slate-700 font-mono">
                                {sellVal.toFixed(3)} {currency}
                              </td>
                              {canViewMargin && <td className="px-6 py-3.5 text-right whitespace-nowrap">
                                <span className="px-3 py-1 bg-indigo-50 text-indigo-700 font-black font-mono rounded-lg border border-indigo-100 text-xs">
                                  {profitVal.toFixed(3)} {currency}
                                </span>
                              </td>}
                            </tr>
                          );
                        }

                        const dayRec = rec as any;
                        const formattedDate = dayRec.dateObj.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
                        return (
                          <tr key={dayRec.dateStr} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-6 py-3.5 whitespace-nowrap">
                              <div className="flex flex-col">
                                <span className="text-xs font-bold text-slate-700 capitalize">{formattedDate}</span>
                                <span className="text-[10px] text-slate-400 font-mono font-bold">{dayRec.dateStr}</span>
                              </div>
                            </td>

                            {activeModal === 'revenue' && (
                              <>
                                <td className="px-6 py-3.5 text-center font-bold text-slate-700 font-mono">{dayRec.salesCount}</td>
                                <td className="px-6 py-3.5 text-right font-bold text-emerald-650 font-mono">{dayRec.cashAmount.toFixed(3)} {currency}</td>
                                <td className="px-6 py-3.5 text-right font-semibold text-rose-500 font-mono">{dayRec.debt.toFixed(3)} {currency}</td>
                                <td className="px-6 py-3.5 text-right whitespace-nowrap">
                                  <span className="px-3 py-1 bg-blue-50 text-blue-700 font-black font-mono rounded-lg border border-blue-100 text-xs">
                                    {dayRec.revenue.toFixed(3)} {currency}
                                  </span>
                                </td>
                              </>
                            )}

                            {activeModal === 'profit' && (
                              <>
                                <td className="px-6 py-3.5 text-right font-semibold text-slate-600 font-mono">{dayRec.revenue.toFixed(3)} {currency}</td>
                                <td className="px-6 py-3.5 text-right text-slate-500 font-mono">{(dayRec.revenue - dayRec.profit).toFixed(3)} {currency}</td>
                                <td className="px-6 py-3.5 text-right whitespace-nowrap">
                                  <span className="text-[10px] font-black text-emerald-650 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
                                    {dayRec.revenue > 0 ? ((dayRec.profit / dayRec.revenue) * 100).toFixed(1) + '%' : '0.0%'}
                                  </span>
                                </td>
                                <td className="px-6 py-3.5 text-right whitespace-nowrap">
                                  <span className="px-3 py-1 bg-emerald-50 text-emerald-700 font-black font-mono rounded-lg border border-emerald-100 text-xs">
                                    {dayRec.profit.toFixed(3)} {currency}
                                  </span>
                                </td>
                              </>
                            )}

                            {activeModal === 'debt' && (
                              <>
                                <td className="px-6 py-3.5 text-right text-slate-500 font-mono">{dayRec.revenue.toFixed(3)} {currency}</td>
                                <td className="px-6 py-3.5 text-right text-slate-500 font-mono">{dayRec.cashAmount.toFixed(3)} {currency}</td>
                                <td className="px-6 py-3.5 text-center font-bold text-slate-700 font-mono">{dayRec.salesCount}</td>
                                <td className="px-6 py-3.5 text-right whitespace-nowrap">
                                  <span className="px-3 py-1 bg-rose-50 text-rose-700 font-black font-mono rounded-lg border border-rose-100 text-xs">
                                    {dayRec.debt.toFixed(3)} {currency}
                                  </span>
                                </td>
                              </>
                            )}

                            {activeModal === 'sales' && (
                              <>
                                <td className="px-6 py-3.5 text-center font-semibold text-slate-500 font-mono">
                                  {dayRec.salesCount > 0 ? (dayRec.revenue / dayRec.salesCount).toFixed(3) : '0.000'} {currency}
                                </td>
                                <td className="px-6 py-3.5 text-right text-slate-500 font-mono">{dayRec.salesCount}</td>
                                <td className="px-6 py-3.5 text-center whitespace-nowrap bg-indigo-50/10">
                                  <span className="px-3 py-1 bg-purple-50 text-purple-700 font-black font-mono rounded-lg border border-purple-100 text-xs">
                                    {dayRec.salesCount} transactions
                                  </span>
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer / Actions */}
            <div className="p-6 bg-slate-50/50 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0 font-sans">
              
              {/* Pagination controls */}
              {totalPages > 1 ? (
                <div className="flex items-center gap-2">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    className="p-1.5 bg-white border border-slate-200 rounded-lg text-slate-650 disabled:opacity-40 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-bold text-slate-600">
                    Page {currentPage} sur {totalPages}
                  </span>
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    className="p-1.5 bg-white border border-slate-200 rounded-lg text-slate-650 disabled:opacity-40 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="text-xs font-bold text-slate-400 block uppercase">
                  {activeModal === 'stock'
                    ? `Total : ${filteredAndSortedProducts.length} articles répertoriés`
                    : `Total : ${filteredAndSortedRecords.length} rapports de journée`}
                </div>
              )}

              {/* Action button row */}
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer transition-all active:scale-[0.98] border border-slate-200 shadow-xs"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Retour au Tableau de bord
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTimeout(() => {
                      window.print();
                    }, 100);
                  }}
                  className="flex items-center gap-2 px-4 py-2.5 bg-slate-850 hover:bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer transition-all active:scale-[0.98] shadow-md shadow-slate-850/5"
                >
                  <Printer className="w-4 h-4" />
                  Imprimer le rapport
                </button>
                
                <button
                  type="button"
                  onClick={handleExportHistory}
                  className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer transition-all active:scale-[0.98] shadow-md shadow-emerald-600/5"
                >
                  <Download className="w-4 h-4" />
                  Exporter Excel
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* MODAL: INTERACTIVE EXPENSES DETAIL & HISTORY */}
      {activeModal === 'expenses' && (
        <div 
          onClick={() => setActiveModal(null)}
          className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 cursor-pointer"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl w-full max-w-5xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 cursor-default"
          >
            {/* Modal Header */}
            <div className="p-6 text-white bg-gradient-to-r from-amber-550 via-amber-600 to-orange-750 flex items-center justify-between relative overflow-hidden shrink-0">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-white/10 to-transparent"></div>
              <div className="relative z-10 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-xs">
                  <PackagePlus className="w-5 h-5 text-amber-50" />
                </div>
                <div>
                  <h3 className="text-lg font-black tracking-tight leading-none">
                    Consulter l'Historique : Dépenses de Stock
                  </h3>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-white/70 mt-1">
                    Suivi automatique du coût d'acquisition des marchandises
                  </p>
                </div>
              </div>

              <button 
                onClick={() => setActiveModal(null)} 
                className="relative z-10 px-4 py-2 flex items-center gap-2 bg-white/15 hover:bg-white/25 rounded-xl transition-all cursor-pointer text-white text-xs font-black uppercase tracking-wider"
              >
                <X className="w-4 h-4" />
                <span>Fermer</span>
              </button>
            </div>

            {/* Modal Controls / Tabs & Filters */}
            <div className="p-6 bg-slate-50/50 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0 font-sans">
              <div className="flex gap-2">
                <button
                  onClick={() => { setExpensesTab('daily'); setExpensesPage(1); }}
                  className={cn(
                    "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer",
                    expensesTab === 'daily'
                      ? "bg-slate-900 text-white shadow-md shadow-slate-900/15"
                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                  )}
                >
                  Historique Journalier
                </button>
                <button
                  onClick={() => { setExpensesTab('detailed'); setExpensesPage(1); }}
                  className={cn(
                    "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer",
                    expensesTab === 'detailed'
                      ? "bg-slate-900 text-white shadow-md shadow-slate-900/15"
                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                  )}
                >
                  Détails des Opérations
                </button>
              </div>

              {/* Search input dynamically scoped to active tab search */}
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text"
                  value={expensesSearch}
                  onChange={(e) => { setExpensesSearch(e.target.value); setExpensesPage(1); }}
                  placeholder={expensesTab === 'daily' ? "Rechercher une date (ex: 22/06)..." : "Rechercher un produit ou date..."}
                  className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-amber-500/10 focus:border-amber-500 transition-all"
                />
              </div>
            </div>

            {/* Modal Table Content */}
            <div className="overflow-y-auto grow font-sans p-6">
              {expensesTab === 'daily' ? (
                // Tab 1: Daily grouping list
                dailySuppliesRecords.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center text-slate-450 border border-slate-100 mb-2">
                      <AlertCircle className="w-5 h-5 text-slate-400" />
                    </div>
                    <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">Aucun approvisionnement</h4>
                    <p className="text-slate-450 text-[11px] mt-1">Ajoutez du stock aux articles pour suivre vos dépenses.</p>
                  </div>
                ) : (
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-150 text-[10px] font-black uppercase tracking-wider text-slate-450 bg-slate-50/70">
                        <th className="px-6 py-3">Date</th>
                        <th className="px-6 py-3 text-center">Nbre de Produits Ajoutés</th>
                        <th className="px-6 py-3 text-center">Quantité Totale Ajoutée</th>
                        <th className="px-6 py-3 text-right">Dépenses Totales</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {dailySuppliesRecords.map((rec) => {
                        const formattedDate = rec.dateObj.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
                        return (
                          <tr key={rec.dateStr} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-6 py-3.5 whitespace-nowrap font-bold text-slate-700 capitalize">
                              {formattedDate}
                            </td>
                            <td className="px-6 py-3.5 text-center font-bold text-slate-600 font-mono">
                              {rec.productsCount}
                            </td>
                            <td className="px-6 py-3.5 text-center font-bold text-slate-600 font-mono">
                              {rec.totalQty}
                            </td>
                            <td className="px-6 py-3.5 text-right whitespace-nowrap">
                              <span className="px-3 py-1 bg-amber-50 text-amber-700 font-black font-mono rounded-lg border border-amber-100 text-xs">
                                {rec.totalExpenses.toFixed(3)} {currency}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )
              ) : (
                // Tab 2: Detailed Raw entries
                filteredSupplies.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center text-slate-450 border border-slate-100 mb-2">
                      <AlertCircle className="w-5 h-5 text-slate-400" />
                    </div>
                    <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">Aucune opération trouvée</h4>
                    <p className="text-slate-440 text-[11px] mt-1">Ajustez les termes de votre recherche.</p>
                  </div>
                ) : (
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-150 text-[10px] font-black uppercase tracking-wider text-slate-450 bg-slate-50/70">
                        <th className="px-6 py-3">Date et Heure</th>
                        <th className="px-6 py-3">Produit</th>
                        <th className="px-6 py-3 text-center">Quantité Ajoutée</th>
                        <th className="px-6 py-3 text-right">Prix d'Achat unitaire</th>
                        <th className="px-6 py-3 text-right">Coût Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paginatedSupplies.map((sup: any) => {
                        const dateObj = !sup.date ? new Date() : (typeof sup.date.toDate === 'function' ? sup.date.toDate() : new Date(sup.date));
                        const formattedDateTime = dateObj.toLocaleString('fr-FR', { 
                          day: '2-digit', 
                          month: 'short', 
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        });
                        return (
                          <tr key={sup.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-6 py-3.5 whitespace-nowrap text-slate-400 font-bold font-mono">
                              {formattedDateTime}
                            </td>
                            <td className="px-6 py-3.5 font-bold text-slate-700">
                              {sup.productName || 'Produit supprimé'}
                            </td>
                            <td className="px-6 py-3.5 text-center font-extrabold text-slate-800 font-mono">
                              {sup.quantity || 0}
                            </td>
                            <td className="px-6 py-3.5 text-right font-semibold text-slate-650 font-mono">
                              {(sup.buyPrice || 0).toFixed(3)} {currency}
                            </td>
                            <td className="px-6 py-3.5 text-right font-black text-amber-700 font-mono">
                              {(sup.totalCost || 0).toFixed(3)} {currency}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )
              )}
            </div>

            {/* Modal Footer / Navigation */}
            <div className="p-6 bg-slate-50/50 border-t border-slate-100 flex flex-col md:flex-row items-center justify-between gap-4 shrink-0 font-sans">
              
              {/* Pagination indicators specifically for Tab 2 */}
              {expensesTab === 'detailed' && totalExpensesPages > 1 ? (
                <div className="flex items-center gap-2">
                  <button
                    disabled={expensesPage === 1}
                    onClick={() => setExpensesPage(prev => Math.max(1, prev - 1))}
                    className="p-1.5 bg-white border border-slate-200 rounded-lg text-slate-650 disabled:opacity-40 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-[11px] font-bold text-slate-550">
                    Page {expensesPage} sur {totalExpensesPages}
                  </span>
                  <button
                    disabled={expensesPage === totalExpensesPages}
                    onClick={() => setExpensesPage(prev => Math.min(totalExpensesPages, prev + 1))}
                    className="p-1.5 bg-white border border-slate-200 rounded-lg text-slate-650 disabled:opacity-40 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="text-xs font-bold text-slate-450 block uppercase tracking-wide">
                  Total : {expensesTab === 'daily' ? dailySuppliesRecords.length : filteredSupplies.length} enregistrements
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer transition-all active:scale-[0.98] border border-slate-200 shadow-xs"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Retour au Tableau de bord
                </button>

                <button
                  type="button"
                  onClick={exportExpensesToExcel}
                  className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer transition-all active:scale-[0.98] shadow-md shadow-emerald-600/5 hover:scale-[1.01]"
                >
                  <Download className="w-4 h-4" />
                  Exporter Excel
                </button>
              </div>

            </div>

          </div>
        </div>
      )}

      {/* SUB-MODAL FOR MODIFYING SUPPLY INPUT */}
      {editingSupply && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-100 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">
                Modifier l'approvisionnement
              </h3>
              <button 
                onClick={() => setEditingSupply(null)}
                className="p-1 text-gray-400 hover:text-gray-650 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleUpdateSupply} className="space-y-4">
              <div>
                <p className="text-[10px] text-slate-400 font-extrabold uppercase mb-2">
                  Produit : <span className="text-slate-805 font-bold">{editingSupply.productName}</span>
                </p>
              </div>
              
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-slate-600 mb-1">
                  Quantité d'approvisionnement
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  value={editingSupplyQty}
                  onChange={(e) => setEditingSupplyQty(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500/15 focus:border-amber-500 outline-none text-xs font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-slate-600 mb-1">
                  Prix d'achat unitaire ({currency})
                </label>
                <input
                  type="number"
                  step="0.001"
                  required
                  min="0.001"
                  value={editingSupplyPrice}
                  onChange={(e) => setEditingSupplyPrice(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500/15 focus:border-amber-500 outline-none text-xs font-bold font-mono"
                />
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setEditingSupply(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold uppercase tracking-wider rounded-xl transition-colors cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md shadow-amber-600/10 cursor-pointer active:scale-[0.98]"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RENDER INVISIBLE PRINTABLE REPORT VIA REACT PORTAL */}
      {activeModal && activeModal !== 'expenses' && createPortal(
        <PrintableReport 
          activeModal={activeModal} 
          records={activeModal === 'stock' ? filteredAndSortedProducts : filteredAndSortedRecords} 
          storeSettings={storeSettings} 
          currency={currency} 
          canViewBuyPrice={canViewBuyPrice}
          canViewCosts={canViewCosts}
        />,
        document.body
      )}
    </div>
  );
}
