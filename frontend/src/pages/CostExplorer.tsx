import { useState, useMemo } from 'react'
import {
  ArrowPathIcon,
  CurrencyDollarIcon,
  ArrowTrendingDownIcon,
  ChartBarIcon,
  ClockIcon,
} from '@heroicons/react/24/outline'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from 'recharts'
import {
  useSnapshots,
  useClusterEstimate,
  useWorkloadAttribution,
  usePublicRates,
  useRefreshRates,
  useRecomputeSnapshots,
} from '../hooks/useCostExplorer'
import type {
  InstanceTypeRate,
  SnapshotCluster,
  WorkloadAttribution,
} from '../types'

const fmt = (n: number | null | undefined) =>
  n != null ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'

const fmtPct = (n: number | null | undefined) =>
  n != null ? `${n.toFixed(1)}%` : '—'

const fmtRate = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/hr`

type Granularity = 'daily' | 'weekly' | 'monthly'
type Preset = 'last7' | 'last30' | 'thisMonth' | 'last3m' | 'thisYear' | 'lastYear'

const GRAN_LABELS: Record<Granularity, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
}

const PRESETS: { id: Preset; label: string; gran: Granularity }[] = [
  { id: 'last7', label: 'Last 7 days', gran: 'daily' },
  { id: 'last30', label: 'Last 30 days', gran: 'daily' },
  { id: 'thisMonth', label: 'This month', gran: 'daily' },
  { id: 'last3m', label: 'Last 3 months', gran: 'weekly' },
  { id: 'thisYear', label: 'This year', gran: 'monthly' },
  { id: 'lastYear', label: 'Last year', gran: 'monthly' },
]

function getPresetRange(preset: Preset): { start: string; end: string } {
  const today = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  switch (preset) {
    case 'last7': {
      const s = new Date(today)
      s.setDate(s.getDate() - 6)
      return { start: iso(s), end: iso(today) }
    }
    case 'last30': {
      const s = new Date(today)
      s.setDate(s.getDate() - 29)
      return { start: iso(s), end: iso(today) }
    }
    case 'thisMonth':
      return {
        start: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`,
        end: iso(today),
      }
    case 'last3m': {
      const s = new Date(today)
      s.setMonth(s.getMonth() - 3)
      s.setDate(1)
      return { start: iso(s), end: iso(today) }
    }
    case 'thisYear':
      return { start: `${today.getFullYear()}-01-01`, end: `${today.getFullYear()}-12-31` }
    case 'lastYear': {
      const y = today.getFullYear() - 1
      return { start: `${y}-01-01`, end: `${y}-12-31` }
    }
  }
}

function formatPeriodLabel(period: string, granularity: Granularity): string {
  if (granularity === 'daily') {
    const d = new Date(period + 'T00:00:00')
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  if (granularity === 'weekly') {
    const d = new Date(period + 'T00:00:00')
    return `W${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  }
  const [, mon] = period.split('-')
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return names[parseInt(mon) - 1] || period
}

function formatPeriodTitle(period: string, granularity: Granularity): string {
  if (granularity === 'daily') {
    const d = new Date(period + 'T00:00:00')
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
  }
  if (granularity === 'weekly') {
    const d = new Date(period + 'T00:00:00')
    const end = new Date(d)
    end.setDate(end.getDate() + 6)
    return `Week of ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
  }
  const [yr, mon] = period.split('-')
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${names[parseInt(mon) - 1]} ${yr}`
}

function computeEstDiscount(publicCost: number, estimatedCost: number): number | null {
  if (publicCost <= 0) return null
  return (1 - estimatedCost / publicCost) * 100
}

export default function CostExplorer() {
  const [preset, setPreset] = useState<Preset>('thisYear')
  const [granularity, setGranularity] = useState<Granularity>('monthly')
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string | null>(null)
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null)

  const { start, end } = getPresetRange(preset)
  const { data: periods, isLoading, error } = useSnapshots(start, end, granularity)
  const { data: rates, isLoading: ratesLoading } = usePublicRates()
  const refreshRates = useRefreshRates()
  const recompute = useRecomputeSnapshots()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleBarClick = (data: any) => {
    const key = data?.periodKey as string | undefined
    if (key) {
      setSelectedPeriodKey(key)
      setSelectedClusterId(null)
    }
  }

  const totals = useMemo(() => {
    if (!periods) return { public: 0, estimated: 0, actual: 0, hasActual: false }
    let pub = 0, est = 0, act = 0, hasActual = false
    for (const p of periods) {
      pub += p.public_total
      est += p.estimated_total
      if (p.actual_total != null) { act += p.actual_total; hasActual = true }
    }
    return { public: pub, estimated: est, actual: act, hasActual }
  }, [periods])

  const discount = totals.hasActual && totals.public > 0
    ? ((1 - totals.actual / totals.public) * 100).toFixed(1)
    : null

  const paddedPeriods = useMemo(() => {
    if (!periods) return []
    const dataMap = new Map(periods.map((p) => [p.period, p]))
    const empty = (key: string) => ({
      period: key, public_total: 0, estimated_total: 0,
      actual_total: null as number | null, savings: null, discount_pct: null, clusters: [],
    })
    const allKeys: string[] = []

    if (granularity === 'monthly') {
      const startYear = parseInt(start.slice(0, 4))
      const startMon = parseInt(start.slice(5, 7))
      const endYear = parseInt(end.slice(0, 4))
      const endMon = parseInt(end.slice(5, 7))
      for (let y = startYear; y <= endYear; y++) {
        const m0 = y === startYear ? startMon : 1
        const m1 = y === endYear ? endMon : 12
        for (let m = m0; m <= m1; m++) {
          allKeys.push(`${y}-${String(m).padStart(2, '0')}`)
        }
      }
    } else if (granularity === 'weekly') {
      const d = new Date(start + 'T00:00:00')
      d.setDate(d.getDate() - d.getDay() + 1)
      const endD = new Date(end + 'T00:00:00')
      while (d <= endD) {
        allKeys.push(d.toISOString().slice(0, 10))
        d.setDate(d.getDate() + 7)
      }
    } else {
      const d = new Date(start + 'T00:00:00')
      const endD = new Date(end + 'T00:00:00')
      while (d <= endD) {
        allKeys.push(d.toISOString().slice(0, 10))
        d.setDate(d.getDate() + 1)
      }
    }
    return allKeys.map((k) => dataMap.get(k) ?? empty(k))
  }, [periods, granularity, start, end])

  const latestWithData = useMemo(() => {
    if (!paddedPeriods.length) return null
    for (let i = paddedPeriods.length - 1; i >= 0; i--) {
      if (paddedPeriods[i].public_total > 0 || (paddedPeriods[i].actual_total ?? 0) > 0) {
        return paddedPeriods[i].period
      }
    }
    return paddedPeriods[paddedPeriods.length - 1].period
  }, [paddedPeriods])

  const activePeriodKey = selectedPeriodKey ?? latestWithData
  const selectedPeriod = paddedPeriods.find((p) => p.period === activePeriodKey)

  // Derive billing month (YYYY-MM) from the active period key
  const selectedMonth = useMemo(() => {
    if (!activePeriodKey) return undefined
    return activePeriodKey.slice(0, 7)
  }, [activePeriodKey])

  const { data: clusterEstimate } = useClusterEstimate(
    selectedClusterId ?? undefined,
    selectedMonth,
  )
  const { data: workloads } = useWorkloadAttribution(
    selectedClusterId ?? undefined,
    selectedMonth,
  )

  const chartData = paddedPeriods.map((p) => ({
    label: formatPeriodLabel(p.period, granularity),
    periodKey: p.period,
    actual: p.actual_total ?? 0,
    estimated: p.estimated_total,
    public: p.public_total,
  }))

  if (error) {
    const msg = (error as Error)?.message || 'Unknown error'
    if (msg.includes('401') || msg.includes('403')) {
      return (
        <div className="p-6">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
            <CurrencyDollarIcon className="h-12 w-12 text-yellow-500 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-yellow-800">Admin Access Required</h3>
            <p className="text-yellow-700 mt-1">Cost Explorer is available to administrators only.</p>
          </div>
        </div>
      )
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cost Explorer</h1>
          <p className="text-sm text-gray-500 mt-1">
            IBM Cloud cost analysis, estimates, and savings
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Preset selector */}
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setPreset(p.id)
                  setGranularity(p.gran)
                  setSelectedPeriodKey(null)
                  setSelectedClusterId(null)
                }}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  preset === p.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* Granularity toggle */}
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            {(['daily', 'weekly', 'monthly'] as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => {
                  setGranularity(g)
                  setSelectedPeriodKey(null)
                }}
                className={`px-2.5 py-1.5 text-xs font-medium capitalize transition-colors ${
                  granularity === g
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
          {/* Recompute */}
          <button
            onClick={() => recompute.mutate()}
            disabled={recompute.isPending}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            title="Recompute all snapshots"
          >
            <ArrowPathIcon className={`h-3.5 w-3.5 ${recompute.isPending ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {periods && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            icon={CurrencyDollarIcon}
            label="Actual Cost"
            value={totals.hasActual ? fmt(totals.actual) : '—'}
            sub="From billing data"
            color="blue"
          />
          <SummaryCard
            icon={ChartBarIcon}
            label="Public Rate"
            value={fmt(totals.public)}
            sub="List price"
            color="gray"
          />
          <SummaryCard
            icon={ArrowTrendingDownIcon}
            label="Savings"
            value={totals.hasActual ? fmt(totals.public - totals.actual) : '—'}
            sub={discount ? `${discount}% discount` : 'No billing data'}
            color="green"
          />
          <SummaryCard
            icon={ClockIcon}
            label="Projected Cost"
            value={fmt(totals.estimated)}
            sub="With estimated discount"
            color="purple"
          />
        </div>
      )}

      {/* Chart */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Cost Overview
        </h2>
        {isLoading ? (
          <div className="h-64 flex items-center justify-center text-gray-400">Loading...</div>
        ) : chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-gray-400">
            No snapshot data yet. Click the refresh icon to compute snapshots.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#374151' }}
                axisLine={{ stroke: '#d1d5db' }}
                tickLine={{ stroke: '#d1d5db' }}
                interval={granularity === 'daily' && chartData.length > 15 ? Math.floor(chartData.length / 10) : 0}
              />
              <YAxis
                tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`}
                tick={{ fontSize: 12, fill: '#374151' }}
                axisLine={{ stroke: '#d1d5db' }}
                tickLine={{ stroke: '#d1d5db' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '0.5rem',
                  color: '#111827',
                }}
                itemStyle={{ color: '#374151' }}
                labelStyle={{ color: '#111827', fontWeight: 600 }}
                formatter={(value: unknown, name: unknown) => {
                  const label = String(name) === 'actual' ? 'Actual Cost'
                    : String(name) === 'estimated' ? 'Projected Cost'
                    : 'Public Rate'
                  return [fmt(value as number), label]
                }}
              />
              <Legend
                formatter={(value: string) => (
                  <span style={{ color: '#374151' }}>
                    {value === 'actual' ? 'Actual Cost' : value === 'estimated' ? 'Projected' : 'Public Rate'}
                  </span>
                )}
              />
              <Bar dataKey="public" fill="#6366f1" radius={[3, 3, 0, 0]} cursor="pointer" onClick={handleBarClick}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.periodKey === activePeriodKey ? '#4338ca' : '#6366f1'} />
                ))}
              </Bar>
              <Bar dataKey="estimated" fill="#f59e0b" radius={[3, 3, 0, 0]} cursor="pointer" onClick={handleBarClick}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.periodKey === activePeriodKey ? '#d97706' : '#f59e0b'} />
                ))}
              </Bar>
              <Bar dataKey="actual" fill="#10b981" radius={[3, 3, 0, 0]} cursor="pointer" onClick={handleBarClick}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.periodKey === activePeriodKey ? '#059669' : '#10b981'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        <p className="text-xs text-gray-500 mt-2">Click a bar to see the {granularity === 'daily' ? 'daily' : granularity === 'weekly' ? 'weekly' : 'monthly'} cluster breakdown below</p>
      </div>

      {/* Period Cluster Breakdown */}
      {selectedPeriod && selectedPeriod.clusters.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              {formatPeriodTitle(activePeriodKey!, granularity)} — {GRAN_LABELS[granularity]} Cluster Breakdown
            </h2>
            {selectedPeriod.actual_total != null && selectedPeriod.public_total > 0 ? (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
                <ArrowTrendingDownIcon className="h-4 w-4" />
                {((1 - selectedPeriod.actual_total / selectedPeriod.public_total) * 100).toFixed(1)}% actual savings
              </span>
            ) : selectedPeriod.discount_pct != null ? (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-amber-100 text-amber-700">
                <ArrowTrendingDownIcon className="h-4 w-4" />
                {selectedPeriod.discount_pct}% est. savings
              </span>
            ) : null}
          </div>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center p-3 bg-indigo-50 rounded-lg">
              <p className="text-xs text-gray-500">Public Rate</p>
              <p className="text-lg font-semibold text-gray-900">{fmt(selectedPeriod.public_total)}</p>
            </div>
            <div className="text-center p-3 bg-amber-50 rounded-lg">
              <p className="text-xs text-gray-500">Projected</p>
              <p className="text-lg font-semibold text-gray-900">{fmt(selectedPeriod.estimated_total)}</p>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <p className="text-xs text-gray-500">Actual</p>
              <p className="text-lg font-semibold text-gray-900">
                {selectedPeriod.actual_total != null ? fmt(selectedPeriod.actual_total) : '—'}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 font-medium text-gray-500">Cluster</th>
                  <th className="text-right py-2 font-medium text-gray-500">Public Rate</th>
                  <th className="text-right py-2 font-medium text-gray-500">Projected</th>
                  <th className="text-right py-2 font-medium text-gray-500">Actual</th>
                  <th className="text-right py-2 font-medium text-gray-500">Discount</th>
                  <th className="text-right py-2 font-medium text-gray-500">Savings</th>
                  <th className="text-right py-2 font-medium text-gray-500"></th>
                </tr>
              </thead>
              <tbody>
                {selectedPeriod.clusters.map((c: SnapshotCluster) => {
                  const hasActual = c.actual_cost != null && c.public_cost > 0
                  const clusterDiscount = hasActual
                    ? computeEstDiscount(c.public_cost, c.actual_cost!)
                    : computeEstDiscount(c.public_cost, c.estimated_cost)
                  const savings = hasActual
                    ? c.public_cost - c.actual_cost!
                    : null
                  return (
                    <tr
                      key={c.cluster_id}
                      className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${
                        selectedClusterId === c.cluster_id ? 'bg-blue-50' : ''
                      }`}
                      onClick={() => setSelectedClusterId(c.cluster_id)}
                    >
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: c.cluster_color }} />
                          <span className="font-medium text-gray-900">{c.cluster_name}</span>
                        </div>
                      </td>
                      <td className="text-right text-gray-900">{fmt(c.public_cost)}</td>
                      <td className="text-right text-gray-900">{fmt(c.estimated_cost)}</td>
                      <td className="text-right text-gray-900">
                        {c.actual_cost != null ? fmt(c.actual_cost) : '—'}
                      </td>
                      <td className="text-right text-gray-900">
                        {clusterDiscount != null ? (
                          <span className={clusterDiscount > 0 ? 'text-green-700' : ''}>{fmtPct(clusterDiscount)}</span>
                        ) : '—'}
                      </td>
                      <td className="text-right text-gray-900">
                        {savings != null ? (
                          <span className="text-green-700">{fmt(savings)}</span>
                        ) : '—'}
                      </td>
                      <td className="text-right text-xs text-gray-400">details →</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cluster Estimate Detail */}
      {selectedClusterId && clusterEstimate && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Node Breakdown — {clusterEstimate.billing_month ? formatPeriodTitle(clusterEstimate.billing_month, 'monthly') : 'Current Month'}
            </h2>
            {clusterEstimate.total_actual_cost != null && clusterEstimate.total_public_cost > 0 ? (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
                {((1 - clusterEstimate.total_actual_cost / clusterEstimate.total_public_cost) * 100).toFixed(1)}% actual discount
              </span>
            ) : clusterEstimate.discount_pct > 0 ? (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-amber-100 text-amber-700">
                {clusterEstimate.discount_pct}% est. discount
              </span>
            ) : null}
          </div>
          <div className={`grid gap-4 mb-4 ${clusterEstimate.total_actual_cost != null ? 'grid-cols-4' : 'grid-cols-3'}`}>
            <div className="text-center p-3 bg-indigo-50 rounded-lg">
              <p className="text-xs text-gray-500">Public Rate</p>
              <p className="text-lg font-semibold text-gray-900">{fmt(clusterEstimate.total_public_cost)}</p>
            </div>
            <div className="text-center p-3 bg-amber-50 rounded-lg">
              <p className="text-xs text-gray-500">Projected</p>
              <p className="text-lg font-semibold text-gray-900">{fmt(clusterEstimate.total_estimated_cost)}</p>
            </div>
            {clusterEstimate.total_actual_cost != null && (
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <p className="text-xs text-gray-500">Actual</p>
                <p className="text-lg font-semibold text-gray-900">{fmt(clusterEstimate.total_actual_cost)}</p>
              </div>
            )}
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <p className="text-xs text-gray-500">Savings</p>
              <p className="text-lg font-semibold text-gray-900">
                {clusterEstimate.total_actual_cost != null
                  ? fmt(clusterEstimate.total_public_cost - clusterEstimate.total_actual_cost)
                  : fmt(clusterEstimate.total_public_cost - clusterEstimate.total_estimated_cost)}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 font-medium text-gray-500">Node</th>
                  <th className="text-left py-2 font-medium text-gray-500">Type</th>
                  <th className="text-left py-2 font-medium text-gray-500">Region</th>
                  <th className="text-center py-2 font-medium text-gray-500">GPU</th>
                  <th className="text-right py-2 font-medium text-gray-500">Hours</th>
                  <th className="text-right py-2 font-medium text-gray-500">Rate</th>
                  <th className="text-right py-2 font-medium text-gray-500">Public</th>
                  <th className="text-right py-2 font-medium text-gray-500">Projected</th>
                  <th className="text-right py-2 font-medium text-gray-500">Actual</th>
                  <th className="text-right py-2 font-medium text-gray-500">Discount</th>
                </tr>
              </thead>
              <tbody>
                {clusterEstimate.nodes.map((n) => {
                  const nodeDiscount = n.actual_cost != null && n.public_cost > 0
                    ? computeEstDiscount(n.public_cost, n.actual_cost)
                    : n.rate_available && n.public_rate && n.public_rate > 0
                    ? computeEstDiscount(n.public_rate * n.hours_active, n.estimated_cost)
                    : null
                  return (
                    <tr key={n.node_name} className="border-b border-gray-100">
                      <td className="py-2 font-mono text-xs text-gray-900">{n.node_name}</td>
                      <td className="py-2 text-xs text-gray-700">{n.instance_type ?? '—'}</td>
                      <td className="py-2 text-xs text-gray-700">{n.region ?? '—'}</td>
                      <td className="py-2 text-center">
                        {n.is_gpu ? (
                          <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">GPU</span>
                        ) : '—'}
                      </td>
                      <td className="py-2 text-right text-gray-900">{n.hours_active.toFixed(0)}</td>
                      <td className="py-2 text-right text-gray-700">
                        {n.rate_available && n.public_rate ? fmtRate(n.public_rate) : '—'}
                      </td>
                      <td className="py-2 text-right text-gray-900">{fmt(n.public_cost)}</td>
                      <td className="py-2 text-right text-gray-900">{fmt(n.estimated_cost)}</td>
                      <td className="py-2 text-right text-gray-900">
                        {n.actual_cost != null ? fmt(n.actual_cost) : '—'}
                      </td>
                      <td className="py-2 text-right text-gray-900">
                        {nodeDiscount != null ? (
                          <span className={nodeDiscount > 0 ? 'text-green-700' : ''}>{fmtPct(nodeDiscount)}</span>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Workload Attribution */}
      {selectedClusterId && workloads && workloads.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            GPU Workload Attribution — {selectedMonth ? formatPeriodTitle(selectedMonth, 'monthly') : 'Current Month'}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 font-medium text-gray-500">Namespace</th>
                  <th className="text-right py-2 font-medium text-gray-500">GPU-Hours</th>
                  <th className="text-right py-2 font-medium text-gray-500">Share</th>
                  <th className="text-right py-2 font-medium text-gray-500">Est. Cost</th>
                </tr>
              </thead>
              <tbody>
                {workloads.map((w: WorkloadAttribution) => (
                  <tr key={w.namespace} className="border-b border-gray-100">
                    <td className="py-2 font-mono text-xs text-gray-900">{w.namespace}</td>
                    <td className="py-2 text-right text-gray-900">{w.gpu_hours.toFixed(1)}</td>
                    <td className="py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-purple-500 rounded-full"
                            style={{ width: `${Math.min(w.percentage, 100)}%` }}
                          />
                        </div>
                        <span className="text-gray-700 text-xs w-12 text-right">{w.percentage}%</span>
                      </div>
                    </td>
                    <td className="py-2 text-right font-medium text-gray-900">{fmt(w.estimated_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Public Rates Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            IBM Cloud Public Rates
          </h2>
          <button
            onClick={() => refreshRates.mutate()}
            disabled={refreshRates.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <ArrowPathIcon className={`h-4 w-4 ${refreshRates.isPending ? 'animate-spin' : ''}`} />
            Refresh Rates
          </button>
        </div>
        {rates && rates.some((r: InstanceTypeRate) => r.is_estimated) && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
            * Rates marked with an asterisk are estimated from billing data — public pricing is not available for these instance types. These rates are not used in discount calculations.
          </p>
        )}
        {ratesLoading ? (
          <p className="text-gray-500 text-sm">Loading rates...</p>
        ) : rates && rates.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 font-medium text-gray-500">Instance Type</th>
                  <th className="text-left py-2 font-medium text-gray-500">Region</th>
                  <th className="text-right py-2 font-medium text-gray-500">Hourly Rate</th>
                  <th className="text-right py-2 font-medium text-gray-500">Monthly (730 hrs)</th>
                  <th className="text-right py-2 font-medium text-gray-500">Source</th>
                  <th className="text-right py-2 font-medium text-gray-500">Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const grouped = new Map<string, InstanceTypeRate[]>()
                  rates.forEach((r: InstanceTypeRate) => {
                    const list = grouped.get(r.instance_type) ?? []
                    list.push(r)
                    grouped.set(r.instance_type, list)
                  })
                  const rows: React.ReactNode[] = []
                  grouped.forEach((regionRates, instanceType) => {
                    regionRates.sort((a, b) => a.region.localeCompare(b.region))
                    const isEst = regionRates[0]?.is_estimated
                    regionRates.forEach((r, idx) => {
                      rows.push(
                        <tr
                          key={`${r.instance_type}-${r.region}`}
                          className={`border-b border-gray-100 ${idx === 0 ? 'border-t border-gray-200' : ''} ${isEst ? 'bg-amber-50/50' : ''}`}
                        >
                          <td className="py-2 font-mono text-xs text-gray-900">
                            {idx === 0 ? (<>{instanceType}{isEst ? <span className="text-amber-600 ml-1">*</span> : null}</>) : ''}
                          </td>
                          <td className="py-2 text-xs text-gray-700">{r.region}</td>
                          <td className="py-2 text-right font-medium text-gray-900">{fmtRate(r.public_hourly_rate)}</td>
                          <td className="py-2 text-right text-gray-700">{fmt(r.public_hourly_rate * 730)}</td>
                          <td className="py-2 text-right text-xs">
                            {r.is_estimated ? (
                              <span className="text-amber-600 font-medium">Billing est.</span>
                            ) : (
                              <span className="text-gray-500">Public</span>
                            )}
                          </td>
                          <td className="py-2 text-right text-xs text-gray-500">
                            {new Date(r.last_fetched).toLocaleDateString()}
                          </td>
                        </tr>
                      )
                    })
                  })
                  return rows
                })()}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-500 text-sm">
            No rates cached yet. Rates are fetched automatically when cluster nodes are discovered.
          </p>
        )}
      </div>
    </div>
  )
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ElementType
  label: string
  value: string
  sub: string
  color: 'blue' | 'gray' | 'green' | 'purple'
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    gray: 'bg-gray-100 text-gray-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
  }
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colors[color]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-lg font-semibold text-gray-900">{value}</p>
          <p className="text-xs text-gray-500">{sub}</p>
        </div>
      </div>
    </div>
  )
}
