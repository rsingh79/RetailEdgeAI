import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
  AreaChart, Area,
} from 'recharts';

/* ═══════════════════════════════════════════════════════════════════
   Mock Data Generators
   Structured to match what real API endpoints would return.
   Replace api calls once backend report routes are implemented.
   ═══════════════════════════════════════════════════════════════════ */
function generateCostChangeData() {
  const weeks = ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'];
  return {
    chartData: weeks.map((week, i) => ({
      week,
      increases: Math.floor(Math.random() * 15) + 5 + i * 2,
      decreases: Math.floor(Math.random() * 6) + 1,
      unchanged: Math.floor(Math.random() * 30) + 20,
    })),
    summary: {
      totalChanges: 47,
      avgIncrease: 6.8,
      avgDecrease: -3.2,
      biggestIncrease: { product: 'Free Range Eggs 700g', percent: 11.5, supplier: 'Farm Fresh Supplies' },
      biggestDecrease: { product: 'Wholemeal Bread 750g', percent: -5.1, supplier: 'Baker Bros' },
    },
  };
}

function generateMarginRiskData() {
  return {
    distribution: [
      { name: 'Above Target (>35%)', value: 42, color: '#10b981' },
      { name: 'Within Range (20-35%)', value: 31, color: '#f59e0b' },
      { name: 'Below Minimum (<20%)', value: 8, color: '#ef4444' },
      { name: 'Negative Margin', value: 2, color: '#991b1b' },
    ],
    atRiskProducts: [
      { name: 'Organic Soy Milk 1L', margin: 12.3, target: 30 },
      { name: 'Almond Butter 250g', margin: 15.1, target: 35 },
      { name: 'Greek Yogurt 1kg', margin: 18.7, target: 30 },
      { name: 'Hemp Seeds 500g', margin: 8.2, target: 35 },
      { name: 'Coconut Water 1L', margin: -2.5, target: 25 },
    ],
    totalProducts: 83,
  };
}

function generateSupplierData() {
  return {
    suppliers: [
      { name: 'Farm Fresh Supplies', spend: 12450, invoices: 24, avgMargin: 31.2, trend: 'up', changePercent: 4.2 },
      { name: 'Organic Wholesalers', spend: 9800, invoices: 18, avgMargin: 28.5, trend: 'stable', changePercent: 0.8 },
      { name: 'Baker Bros', spend: 7200, invoices: 15, avgMargin: 34.1, trend: 'down', changePercent: -2.1 },
      { name: 'Dairy Direct', spend: 6100, invoices: 12, avgMargin: 26.8, trend: 'up', changePercent: 6.5 },
      { name: 'Health Foods Co.', spend: 4300, invoices: 8, avgMargin: 38.4, trend: 'stable', changePercent: 1.2 },
    ],
    period: 'Last 90 days',
    totalSpend: 39850,
    totalInvoices: 77,
  };
}

function generateCompetitivenessData() {
  const months = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
  return {
    trendData: months.map((month) => ({
      month,
      yourPrice: +(Math.random() * 2 + 5.5).toFixed(2),
      competitorAvg: +(Math.random() * 2 + 5.8).toFixed(2),
      marketAvg: +(Math.random() * 2 + 5.3).toFixed(2),
    })),
    summary: {
      belowMarket: 28,
      atMarket: 35,
      aboveMarket: 20,
      totalMonitored: 83,
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════
   Chart Colors
   ═══════════════════════════════════════════════════════════════════ */
const BRAND = '#0d9488';
const GREEN = '#10b981';
const RED = '#ef4444';
const GRAY = '#9ca3af';

/* ═══════════════════════════════════════════════════════════════════
   Stat Card
   ═══════════════════════════════════════════════════════════════════ */
function StatCard({ label, value, color = 'text-gray-900' }) {
  return (
    <div className="text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Cost Changes Report
   ═══════════════════════════════════════════════════════════════════ */
function CostChangesCard({ data }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">Cost Changes</h3>
            <p className="text-xs text-gray-500">Invoice cost movements · Last 30 days</p>
          </div>
          <div className="flex items-center gap-4">
            <StatCard label="Total Changes" value={data.summary.totalChanges} />
            <StatCard label="Avg Increase" value={`${data.summary.avgIncrease}%`} color="text-red-600" />
          </div>
        </div>
      </div>
      <div className="p-5">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data.chartData} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="week" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip
              contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '13px' }}
            />
            <Bar dataKey="increases" name="Increases" fill={RED} radius={[4, 4, 0, 0]} />
            <Bar dataKey="decreases" name="Decreases" fill={GREEN} radius={[4, 4, 0, 0]} />
            <Bar dataKey="unchanged" name="Unchanged" fill="#e5e7eb" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>

        {/* Biggest movers */}
        <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-4">
          <div className="bg-red-50 rounded-lg p-3">
            <p className="text-xs text-red-600 font-medium mb-1">Biggest Increase</p>
            <p className="text-sm font-medium text-gray-900">{data.summary.biggestIncrease.product}</p>
            <p className="text-xs text-gray-500">
              +{data.summary.biggestIncrease.percent}% · {data.summary.biggestIncrease.supplier}
            </p>
          </div>
          <div className="bg-green-50 rounded-lg p-3">
            <p className="text-xs text-green-600 font-medium mb-1">Biggest Decrease</p>
            <p className="text-sm font-medium text-gray-900">{data.summary.biggestDecrease.product}</p>
            <p className="text-xs text-gray-500">
              {data.summary.biggestDecrease.percent}% · {data.summary.biggestDecrease.supplier}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Margin Risk Report
   ═══════════════════════════════════════════════════════════════════ */
function MarginRiskCard({ data }) {
  const totalProducts = data.distribution.reduce((sum, d) => sum + d.value, 0);
  const riskCount = data.distribution
    .filter((d) => d.name.includes('Below') || d.name.includes('Negative'))
    .reduce((s, d) => s + d.value, 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">Margin Risk</h3>
            <p className="text-xs text-gray-500">Product margin distribution · {totalProducts} products</p>
          </div>
          {riskCount > 0 && (
            <span className="px-2.5 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">
              {riskCount} at risk
            </span>
          )}
        </div>
      </div>
      <div className="p-5">
        <div className="flex items-center gap-6">
          <div className="w-48 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.distribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {data.distribution.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '13px' }}
                  formatter={(value) => [`${value} products`, '']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-2">
            {data.distribution.map((d) => (
              <div key={d.name} className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                <span className="text-sm text-gray-700 flex-1">{d.name}</span>
                <span className="text-sm font-medium text-gray-900">{d.value}</span>
                <span className="text-xs text-gray-400 w-10 text-right">
                  {Math.round((d.value / totalProducts) * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* At-risk products */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Products Below Target</h4>
          <div className="space-y-1.5">
            {data.atRiskProducts.map((p) => (
              <div key={p.name} className="flex items-center gap-3 text-sm">
                <div className={`w-2 h-2 rounded-full ${p.margin < 0 ? 'bg-red-700' : p.margin < 20 ? 'bg-red-500' : 'bg-amber-500'}`} />
                <span className="flex-1 text-gray-700 truncate">{p.name}</span>
                <span className={`font-medium ${p.margin < 0 ? 'text-red-700' : p.margin < 20 ? 'text-red-600' : 'text-amber-600'}`}>
                  {p.margin}%
                </span>
                <span className="text-xs text-gray-400">target {p.target}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Supplier Analysis Report
   ═══════════════════════════════════════════════════════════════════ */
function SupplierAnalysisCard({ data }) {
  const chartData = data.suppliers.map((s) => ({
    name: s.name.length > 18 ? s.name.slice(0, 16) + '...' : s.name,
    spend: s.spend,
  }));

  const trendIcon = (trend) => {
    if (trend === 'up') return <span className="text-red-500 text-xs">▲</span>;
    if (trend === 'down') return <span className="text-green-500 text-xs">▼</span>;
    return <span className="text-gray-400 text-xs">—</span>;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">Supplier Analysis</h3>
            <p className="text-xs text-gray-500">{data.period} · {data.totalInvoices} invoices</p>
          </div>
          <StatCard label="Total Spend" value={`$${(data.totalSpend / 1000).toFixed(1)}k`} color="text-brand-700" />
        </div>
      </div>
      <div className="p-5">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} layout="vertical" barSize={16}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
            <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12 }} />
            <Tooltip
              contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '13px' }}
              formatter={(value) => [`$${value.toLocaleString()}`, 'Spend']}
            />
            <Bar dataKey="spend" fill={BRAND} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>

        {/* Supplier details table */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase">
                <th className="text-left py-1">Supplier</th>
                <th className="text-right py-1">Spend</th>
                <th className="text-right py-1">Invoices</th>
                <th className="text-right py-1">Avg Margin</th>
                <th className="text-right py-1">Cost Trend</th>
              </tr>
            </thead>
            <tbody>
              {data.suppliers.map((s) => (
                <tr key={s.name} className="border-t border-gray-50">
                  <td className="py-1.5 text-gray-700">{s.name}</td>
                  <td className="py-1.5 text-right text-gray-900 font-medium">${s.spend.toLocaleString()}</td>
                  <td className="py-1.5 text-right text-gray-500">{s.invoices}</td>
                  <td className="py-1.5 text-right">
                    <span className={s.avgMargin < 25 ? 'text-red-600' : s.avgMargin < 30 ? 'text-amber-600' : 'text-green-600'}>
                      {s.avgMargin}%
                    </span>
                  </td>
                  <td className="py-1.5 text-right">
                    <span className="inline-flex items-center gap-1">
                      {trendIcon(s.trend)}
                      <span className={`text-xs ${s.trend === 'up' ? 'text-red-500' : s.trend === 'down' ? 'text-green-500' : 'text-gray-400'}`}>
                        {s.changePercent > 0 ? '+' : ''}{s.changePercent}%
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Price Competitiveness Report
   ═══════════════════════════════════════════════════════════════════ */
function CompetitivenessCard({ data }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">Price Competitiveness</h3>
            <p className="text-xs text-gray-500">Your pricing vs. market · {data.summary.totalMonitored} products tracked</p>
          </div>
        </div>
      </div>
      <div className="p-5">
        {/* Positioning summary */}
        <div className="flex items-center gap-4 mb-5">
          <div className="flex-1 bg-green-50 rounded-lg p-3 text-center border border-green-200">
            <div className="text-2xl font-bold text-green-700">{data.summary.belowMarket}</div>
            <div className="text-xs text-green-600 font-medium">Below Market</div>
            <div className="text-[10px] text-green-500">Price advantage</div>
          </div>
          <div className="flex-1 bg-gray-50 rounded-lg p-3 text-center border border-gray-200">
            <div className="text-2xl font-bold text-gray-700">{data.summary.atMarket}</div>
            <div className="text-xs text-gray-600 font-medium">At Market</div>
            <div className="text-[10px] text-gray-400">Competitive</div>
          </div>
          <div className="flex-1 bg-red-50 rounded-lg p-3 text-center border border-red-200">
            <div className="text-2xl font-bold text-red-700">{data.summary.aboveMarket}</div>
            <div className="text-xs text-red-600 font-medium">Above Market</div>
            <div className="text-[10px] text-red-500">Review needed</div>
          </div>
        </div>

        {/* Trend Chart */}
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data.trendData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${v}`} domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '13px' }}
              formatter={(value) => [`$${value}`, '']}
            />
            <Area
              type="monotone"
              dataKey="competitorAvg"
              name="Competitor Avg"
              stroke={RED}
              fill={RED}
              fillOpacity={0.08}
              strokeWidth={2}
              strokeDasharray="5 3"
            />
            <Area
              type="monotone"
              dataKey="marketAvg"
              name="Market Avg"
              stroke={GRAY}
              fill={GRAY}
              fillOpacity={0.05}
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
            <Area
              type="monotone"
              dataKey="yourPrice"
              name="Your Price"
              stroke={BRAND}
              fill={BRAND}
              fillOpacity={0.15}
              strokeWidth={2.5}
            />
          </AreaChart>
        </ResponsiveContainer>

        <div className="flex items-center justify-center gap-6 mt-3">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-0.5 rounded" style={{ backgroundColor: BRAND }} />
            <span className="text-xs text-gray-500">Your Price</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-0.5 rounded" style={{ backgroundColor: RED, borderTop: `2px dashed ${RED}`, height: 0 }} />
            <span className="text-xs text-gray-500">Competitor Avg</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-0.5 rounded" style={{ backgroundColor: GRAY }} />
            <span className="text-xs text-gray-500">Market Avg</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Main Reports Page
   ═══════════════════════════════════════════════════════════════════ */
export default function Reports() {
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30d');
  const [costData, setCostData] = useState(null);
  const [marginData, setMarginData] = useState(null);
  const [supplierData, setSupplierData] = useState(null);
  const [competitiveData, setCompetitiveData] = useState(null);

  useEffect(() => {
    loadReports();
  }, [period]);

  const loadReports = async () => {
    setLoading(true);

    // TODO: Replace with real API calls when backend report routes are implemented
    // Example future API shape:
    //   const cost = await api.reports.getCostChanges({ period });
    //   const margin = await api.reports.getMarginRisk();
    //   const supplier = await api.reports.getSupplierAnalysis({ period });
    //   const competitive = await api.reports.getCompetitiveness();

    // Use mock data for now
    await new Promise((r) => setTimeout(r, 400)); // Simulate API delay
    setCostData(generateCostChangeData());
    setMarginData(generateMarginRiskData());
    setSupplierData(generateSupplierData());
    setCompetitiveData(generateCompetitivenessData());
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 gap-3">
        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading reports...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Reports & Analytics</h2>
          <p className="text-sm text-gray-500 mt-1">
            Monitor cost movements, margin health, and supplier trends
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[
            { value: '7d', label: '7 days' },
            { value: '30d', label: '30 days' },
            { value: '90d', label: '90 days' },
          ].map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                period === p.value
                  ? 'bg-brand-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Products', value: marginData?.totalProducts || 0, icon: '📦', bg: 'bg-blue-50', color: 'text-blue-700' },
          { label: 'Cost Changes', value: costData?.summary.totalChanges || 0, icon: '📊', bg: 'bg-amber-50', color: 'text-amber-700' },
          { label: 'At Risk', value: marginData?.atRiskProducts.length || 0, icon: '⚠️', bg: 'bg-red-50', color: 'text-red-700' },
          { label: 'Total Spend', value: `$${((supplierData?.totalSpend || 0) / 1000).toFixed(1)}k`, icon: '💰', bg: 'bg-green-50', color: 'text-green-700' },
        ].map((stat) => (
          <div key={stat.label} className={`${stat.bg} rounded-xl p-4 flex items-center gap-3`}>
            <span className="text-2xl">{stat.icon}</span>
            <div>
              <div className={`text-xl font-bold ${stat.color}`}>{stat.value}</div>
              <div className="text-xs text-gray-500">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {costData && <CostChangesCard data={costData} />}
        {marginData && <MarginRiskCard data={marginData} />}
        {supplierData && <SupplierAnalysisCard data={supplierData} />}
        {competitiveData && <CompetitivenessCard data={competitiveData} />}
      </div>
    </div>
  );
}
