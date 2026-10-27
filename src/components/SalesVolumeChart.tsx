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
        <div className="z-50 min-w-[200px] rounded-2xl border border-[#3A3A3A] bg-[#141414]/95 p-3.5 text-xs text-white shadow-xl backdrop-blur-md">
          <div className="mb-2 flex items-center gap-2 border-b border-[#3A3A3A] pb-2">
            <Calendar className="h-3.5 w-3.5 text-[#B8B8B8]" />
            <span className="font-bold capitalize tracking-wide text-[#F4F4F2]">
              {dataPoint.fullDateLabel}
            </span>
          </div>

          <div className="space-y-1.5 font-medium">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-[#D0D0D0]">
                <span className="h-2 w-2 rounded-full bg-[#B8B8B8]"></span>
                Volume de ventes:
              </span>
              <span className="font-mono text-sm font-black text-white">
                {dataPoint.volume} <span className="font-sans text-[10px] font-semibold text-[#B8B8B8]">ventes</span>
              </span>
            </div>

            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-[#D0D0D0]">
                <span className="h-2 w-2 rounded-full bg-[#8A8A8A]"></span>
                Chiffre d'affaires:
              </span>
              <span className="font-mono text-sm font-black text-white">
                {dataPoint.revenue.toFixed(3)} <span className="font-sans text-[10px] text-[#B8B8B8]">{currency}</span>
              </span>
            </div>

            {showProfit && dataPoint.profit !== null && dataPoint.profit !== 0 && (
              <div className="flex items-center justify-between gap-4 border-t border-[#3A3A3A] pt-1 text-[11px]">
                <span className="text-[#B8B8B8]">Bénéfice brut:</span>
                <span className={`font-mono font-bold ${dataPoint.profit < 0 ? 'text-[#F6C9BE]' : 'text-[#E3EFE4]'}`}>
                  {dataPoint.profit > 0 ? '+' : ''}{dataPoint.profit.toFixed(3)} {currency}
                </span>
              </div>
            )}
            {showProfit && dataPoint.profitIncomplete && (
              <p className="pt-1 text-[10px] font-semibold text-[#F6C9BE]">Coûts historiques incomplets ; bénéfice indisponible.</p>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="rounded-[24px] border border-[#E2E2DF] bg-white p-5 transition-all sm:p-6">
      {/* Header with Title and Mode Switcher */}
      <div className="mb-5 flex flex-col justify-between gap-4 border-b border-[#E2E2DF] pb-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F4F4F2] text-[#0A0A0A]">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-sm font-bold uppercase tracking-wider text-[#0A0A0A]">
                Volume des Ventes (7 Derniers Jours)
              </h2>
              <p className="mt-0.5 text-[11px] font-semibold uppercase text-[#5C5C5C]">
                Évolution journalière du nombre de transactions et des encaissements
              </p>
            </div>
          </div>
        </div>

        {/* Mode Selector Tabs */}
        <div className="flex max-w-full items-center gap-1 overflow-x-auto self-start rounded-full border border-[#E2E2DF] bg-[#F4F4F2] p-1 sm:self-auto">
          <button
            type="button"
            onClick={() => setChartMode('combined')}
            className={`min-h-11 shrink-0 rounded-full px-4 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              chartMode === 'combined'
                ? 'bg-[#0A0A0A] text-white font-extrabold'
                : 'text-[#5C5C5C] hover:text-[#0A0A0A]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Vue Combinée</span>
          </button>
          <button
            type="button"
            onClick={() => setChartMode('volume')}
            className={`min-h-11 shrink-0 rounded-full px-4 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              chartMode === 'volume'
                ? 'bg-[#0A0A0A] text-white font-extrabold'
                : 'text-[#5C5C5C] hover:text-[#0A0A0A]'
            }`}
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>Volume seul</span>
          </button>
          <button
            type="button"
            onClick={() => setChartMode('revenue')}
            className={`min-h-11 shrink-0 rounded-full px-4 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              chartMode === 'revenue'
                ? 'bg-[#0A0A0A] text-white font-extrabold'
                : 'text-[#5C5C5C] hover:text-[#0A0A0A]'
            }`}
          >
            <Coins className="w-3.5 h-3.5" />
            <span>CA seul</span>
          </button>
        </div>
      </div>

      {/* KPI Highlights Bar */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex items-center gap-3 rounded-2xl border border-[#E2E2DF] bg-[#F4F4F2] p-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[#0A0A0A]">
            <ShoppingCart className="w-4 h-4" />
          </div>
          <div>
            <span className="block text-[9px] font-black uppercase tracking-wider text-[#5C5C5C]">
              Volume Total (7j)
            </span>
            <span className="block font-display text-base font-bold tabular-nums text-[#0A0A0A]">
              {chartData.totalVolume} <span className="font-sans text-xs font-bold text-[#5C5C5C]">ventes</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-[#E2E2DF] bg-[#F4F4F2] p-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[#0A0A0A]">
            <Coins className="w-4 h-4" />
          </div>
          <div>
            <span className="block text-[9px] font-black uppercase tracking-wider text-[#5C5C5C]">
              Total CA (7j)
            </span>
            <span className="block font-display text-base font-bold tabular-nums text-[#0A0A0A]">
              {chartData.totalRevenue.toFixed(2)} <span className="font-sans text-xs font-bold text-[#5C5C5C]">{currency}</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-[#E2E2DF] bg-[#F4F4F2] p-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[#0A0A0A]">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <span className="block text-[9px] font-black uppercase tracking-wider text-[#5C5C5C]">
              Moyenne / Jour
            </span>
            <span className="block font-display text-base font-bold tabular-nums text-[#0A0A0A]">
              {chartData.avgDailyVolume} <span className="font-sans text-xs font-bold text-[#5C5C5C]">ventes/j</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-[#E2E2DF] bg-[#F4F4F2] p-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[#0A0A0A]">
            <Flame className="w-4 h-4" />
          </div>
          <div>
            <span className="block text-[9px] font-black uppercase tracking-wider text-[#5C5C5C]">
              Pic d'activité
            </span>
            <span className="block truncate text-sm font-bold text-[#0A0A0A]">
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
                <stop offset="0%" stopColor="#141414" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#3A3A3A" stopOpacity={0.7} />
              </linearGradient>
              <linearGradient id="revenueAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5C5C5C" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#5C5C5C" stopOpacity={0.0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E2DF" />

            <XAxis 
              dataKey="dayLabel" 
              tickLine={false} 
              axisLine={{ stroke: '#E2E2DF' }}
              tick={{ fill: '#5C5C5C', fontSize: 11, fontWeight: 600 }}
              dy={6}
            />

            {/* Left YAxis for Volume */}
            <YAxis 
              yAxisId="left" 
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#5C5C5C', fontSize: 11, fontWeight: 600 }}
              width={35}
            />

            {/* Right YAxis for Revenue when in combined mode */}
            {chartMode === 'combined' && (
              <YAxis 
                yAxisId="right" 
                orientation="right"
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#5C5C5C', fontSize: 10, fontWeight: 700 }}
                tickFormatter={(val) => `${val}`}
                width={45}
              />
            )}

            {chartMode === 'revenue' && (
              <YAxis 
                yAxisId="left" 
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#5C5C5C', fontSize: 10, fontWeight: 700 }}
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
                if (value === 'volume') return <span className="font-bold text-[#0A0A0A]">Nombre de ventes</span>;
                if (value === 'revenue') return <span className="font-bold text-[#5C5C5C]">Chiffre d'affaires ({currency})</span>;
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
                stroke="#5C5C5C"
                strokeWidth={3}
                fill="url(#revenueAreaGradient)"
                dot={{ r: 4, fill: '#5C5C5C', strokeWidth: 2, stroke: '#ffffff' }}
                activeDot={{ r: 6, fill: '#0A0A0A', stroke: '#ffffff', strokeWidth: 2 }}
                animationDuration={1000}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#E2E2DF] pt-3 text-[11px] font-semibold text-[#5C5C5C]">
        <span className="flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-[#5C5C5C]" />
          Les barres bleues indiquent le volume de transactions enregistrées chaque jour.
        </span>
        <span className="font-bold text-[#5C5C5C]">
          Dernière mise à jour : temps réel
        </span>
      </div>
    </div>
  );
}
