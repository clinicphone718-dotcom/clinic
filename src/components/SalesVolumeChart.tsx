import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import { Sale } from '../types';
import { computeSaleProfit, type SaleCostLine } from '../lib/financial';
import { 
  BarChart3, 
  TrendingUp, 
  Calendar, 
  Flame, 
  Layers, 
  Coins, 
  ShoppingCart,
  Activity
} from 'lucide-react';

interface SalesVolumeChartProps {
  sales: Sale[];
  saleCostSnapshots: Record<string, SaleCostLine[]>;
  currency?: string;
  showProfit?: boolean;
}

export default function SalesVolumeChart({ sales, saleCostSnapshots, currency = 'DT', showProfit = false }: SalesVolumeChartProps) {
  const [chartMode, setChartMode] = useState<'combined' | 'volume' | 'revenue'>('combined');

  // Safe date parser
  const getSaleDate = (sale: Sale): Date => {
    if (!sale.date) return new Date();
    if (typeof (sale.date as any).toDate === 'function') return (sale.date as any).toDate();
    if (sale.date instanceof Date) return sale.date;
    return new Date(sale.date);
  };

  // Compute 7 days rolling metrics
  const chartData = useMemo(() => {
    const days: {
      dateKey: string;
      dayLabel: string;
      fullDateLabel: string;
      volume: number;
      revenue: number;
      profit: number | null;
      profitIncomplete: boolean;
    }[] = [];

    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateKey = `${year}-${month}-${day}`;

      const isToday = i === 0;
      const dayName = d.toLocaleDateString('fr-FR', { weekday: 'short' });
      const dayFormatted = d.toLocaleDateString('fr-FR', { 
        weekday: 'short', 
        day: 'numeric', 
        month: 'short' 
      });

      days.push({
        dateKey,
        dayLabel: isToday ? "Aujourd'hui" : dayName.charAt(0).toUpperCase() + dayName.slice(1),
        fullDateLabel: isToday ? `Aujourd'hui (${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })})` : dayFormatted,
        volume: 0,
        revenue: 0,
        profit: 0,
        profitIncomplete: false,
      });
    }

    // Populate with actual sales
    sales.forEach((sale) => {
      const sDate = getSaleDate(sale);
      const year = sDate.getFullYear();
      const month = String(sDate.getMonth() + 1).padStart(2, '0');
      const day = String(sDate.getDate()).padStart(2, '0');
      const saleDateKey = `${year}-${month}-${day}`;

      const matchedDay = days.find((d) => d.dateKey === saleDateKey);
      if (matchedDay) {
        matchedDay.volume += 1;
        matchedDay.revenue += Number(sale.total || 0);

        if (showProfit) {
          const margin = computeSaleProfit(sale, saleCostSnapshots[sale.id]);
          if (margin.profit === null) {
            matchedDay.profit = null;
            matchedDay.profitIncomplete = true;
          } else if (!matchedDay.profitIncomplete) {
            matchedDay.profit = (matchedDay.profit || 0) + margin.profit;
          }
        }
      }
    });

    const totalVolume = days.reduce((sum, d) => sum + d.volume, 0);
    const totalRevenue = days.reduce((sum, d) => sum + d.revenue, 0);
    const avgDailyVolume = (totalVolume / 7).toFixed(1);
    const avgDailyRevenue = (totalRevenue / 7).toFixed(2);
    
    // Day with highest volume
    const peakDay = days.reduce((max, d) => (d.volume > max.volume ? d : max), days[0]);

    return {
      days,
      totalVolume,
      totalRevenue,
      avgDailyVolume,
      avgDailyRevenue,
      peakDay
    };
  }, [sales, saleCostSnapshots, showProfit]);

  // Custom tooltips with styled Tailwind card
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const dataPoint = payload[0].payload;
      return (
        <div className="bg-slate-900/95 backdrop-blur-md text-white p-3.5 rounded-2xl shadow-xl border border-slate-700/60 text-xs min-w-[200px] z-50">
          <div className="flex items-center gap-2 pb-2 mb-2 border-b border-slate-700/80">
            <Calendar className="w-3.5 h-3.5 text-indigo-400" />
            <span className="font-bold tracking-wide capitalize text-slate-200">
              {dataPoint.fullDateLabel}
            </span>
          </div>

          <div className="space-y-1.5 font-medium">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-slate-300">
                <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                Volume de ventes:
              </span>
              <span className="font-mono font-black text-white text-sm">
                {dataPoint.volume} <span className="text-[10px] text-slate-400 font-sans font-semibold">ventes</span>
              </span>
            </div>

            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-slate-300">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                Chiffre d'affaires:
              </span>
              <span className="font-mono font-black text-emerald-400 text-sm">
                {dataPoint.revenue.toFixed(3)} <span className="text-[10px] text-emerald-500/80 font-sans">{currency}</span>
              </span>
            </div>

            {showProfit && dataPoint.profit !== null && dataPoint.profit !== 0 && (
              <div className="flex items-center justify-between gap-4 pt-1 border-t border-slate-800 text-[11px]">
                <span className="text-slate-400">Bénéfice brut:</span>
                <span className={`font-mono font-bold ${dataPoint.profit < 0 ? 'text-rose-300' : 'text-teal-300'}`}>
                  {dataPoint.profit > 0 ? '+' : ''}{dataPoint.profit.toFixed(3)} {currency}
                </span>
              </div>
            )}
            {showProfit && dataPoint.profitIncomplete && (
              <p className="pt-1 text-[10px] font-semibold text-amber-300">Coûts historiques incomplets ; bénéfice indisponible.</p>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-150 shadow-xs p-5 sm:p-6 transition-all">
      {/* Header with Title and Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5 pb-4 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shadow-xs">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase text-slate-800 tracking-wider">
                Volume des Ventes (7 Derniers Jours)
              </h2>
              <p className="text-[11px] text-slate-450 font-semibold uppercase mt-0.5">
                Évolution journalière du nombre de transactions et des encaissements
              </p>
            </div>
          </div>
        </div>

        {/* Mode Selector Tabs */}
        <div className="flex items-center bg-slate-100/80 p-1 rounded-2xl gap-1 self-start sm:self-auto border border-slate-200/60">
          <button
            type="button"
            onClick={() => setChartMode('combined')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              chartMode === 'combined'
                ? 'bg-white text-indigo-600 shadow-xs font-extrabold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Vue Combinée</span>
          </button>
          <button
            type="button"
            onClick={() => setChartMode('volume')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              chartMode === 'volume'
                ? 'bg-white text-indigo-600 shadow-xs font-extrabold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>Volume seul</span>
          </button>
          <button
            type="button"
            onClick={() => setChartMode('revenue')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              chartMode === 'revenue'
                ? 'bg-white text-emerald-600 shadow-xs font-extrabold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Coins className="w-3.5 h-3.5" />
            <span>CA seul</span>
          </button>
        </div>
      </div>

      {/* KPI Highlights Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-slate-50/70 border border-slate-100 rounded-2xl p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-indigo-100/70 text-indigo-700 flex items-center justify-center shrink-0">
            <ShoppingCart className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block">
              Volume Total (7j)
            </span>
            <span className="text-base font-black text-slate-800 font-mono block">
              {chartData.totalVolume} <span className="text-xs font-bold text-slate-500 font-sans">ventes</span>
            </span>
          </div>
        </div>

        <div className="bg-slate-50/70 border border-slate-100 rounded-2xl p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-emerald-100/70 text-emerald-700 flex items-center justify-center shrink-0">
            <Coins className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block">
              Total CA (7j)
            </span>
            <span className="text-base font-black text-slate-800 font-mono block">
              {chartData.totalRevenue.toFixed(2)} <span className="text-xs font-bold text-slate-500 font-sans">{currency}</span>
            </span>
          </div>
        </div>

        <div className="bg-slate-50/70 border border-slate-100 rounded-2xl p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-100/70 text-blue-700 flex items-center justify-center shrink-0">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block">
              Moyenne / Jour
            </span>
            <span className="text-base font-black text-slate-800 font-mono block">
              {chartData.avgDailyVolume} <span className="text-xs font-bold text-slate-500 font-sans">ventes/j</span>
            </span>
          </div>
        </div>

        <div className="bg-slate-50/70 border border-slate-100 rounded-2xl p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-amber-100/70 text-amber-700 flex items-center justify-center shrink-0">
            <Flame className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block">
              Pic d'activité
            </span>
            <span className="text-sm font-black text-slate-800 truncate block">
              {chartData.peakDay.dayLabel} ({chartData.peakDay.volume} v.)
            </span>
          </div>
        </div>
      </div>

      {/* Recharts Chart Visualization */}
      <div className="w-full h-72 sm:h-80 select-none">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData.days}
            margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
          >
            <defs>
              <linearGradient id="volumeBarGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#818cf8" stopOpacity={0.7} />
              </linearGradient>
              <linearGradient id="revenueAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0.0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />

            <XAxis 
              dataKey="dayLabel" 
              tickLine={false} 
              axisLine={{ stroke: '#e2e8f0' }}
              tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
              dy={6}
            />

            {/* Left YAxis for Volume */}
            <YAxis 
              yAxisId="left" 
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
              width={35}
            />

            {/* Right YAxis for Revenue when in combined mode */}
            {chartMode === 'combined' && (
              <YAxis 
                yAxisId="right" 
                orientation="right"
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#10b981', fontSize: 10, fontWeight: 700 }}
                tickFormatter={(val) => `${val}`}
                width={45}
              />
            )}

            {chartMode === 'revenue' && (
              <YAxis 
                yAxisId="left" 
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#10b981', fontSize: 10, fontWeight: 700 }}
                tickFormatter={(val) => `${val}`}
                width={45}
              />
            )}

            <Tooltip content={<CustomTooltip />} />

            <Legend 
              verticalAlign="top"
              align="right"
              wrapperStyle={{ paddingBottom: '10px', fontSize: '11px', fontWeight: 600 }}
              formatter={(value) => {
                if (value === 'volume') return <span className="text-slate-600 font-bold">Nombre de ventes</span>;
                if (value === 'revenue') return <span className="text-emerald-600 font-bold">Chiffre d'affaires ({currency})</span>;
                return value;
              }}
            />

            {/* Volume Bars */}
            {(chartMode === 'combined' || chartMode === 'volume') && (
              <Bar
                yAxisId="left"
                dataKey="volume"
                name="volume"
                fill="url(#volumeBarGradient)"
                radius={[8, 8, 0, 0]}
                barSize={32}
                animationDuration={800}
              />
            )}

            {/* Revenue Area */}
            {(chartMode === 'combined' || chartMode === 'revenue') && (
              <Area
                yAxisId={chartMode === 'combined' ? 'right' : 'left'}
                type="monotone"
                dataKey="revenue"
                name="revenue"
                stroke="#10b981"
                strokeWidth={3}
                fill="url(#revenueAreaGradient)"
                dot={{ r: 4, fill: '#10b981', strokeWidth: 2, stroke: '#ffffff' }}
                activeDot={{ r: 6, fill: '#059669', stroke: '#ffffff', strokeWidth: 2 }}
                animationDuration={1000}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between text-[11px] text-slate-400 font-semibold gap-2">
        <span className="flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5 text-indigo-500" />
          Les barres bleues indiquent le volume de transactions enregistrées chaque jour.
        </span>
        <span className="text-slate-500 font-bold">
          Dernière mise à jour : temps réel
        </span>
      </div>
    </div>
  );
}
