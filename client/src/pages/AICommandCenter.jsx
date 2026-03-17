import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';

// ── Agent Configuration ──
const AGENTS = [
  {
    id: 'ingestion',
    name: 'Ingestion Agent',
    description: 'Email & folder scanning',
    emoji: '📥',
    bgColor: 'bg-blue-50',
  },
  {
    id: 'matching',
    name: 'Matching Agent',
    description: 'Product identification',
    emoji: '🔍',
    bgColor: 'bg-purple-50',
  },
  {
    id: 'pricing',
    name: 'Pricing Agent',
    description: 'Margin optimization',
    emoji: '💰',
    bgColor: 'bg-green-50',
  },
  {
    id: 'competitor',
    name: 'Competitor Agent',
    description: 'Price monitoring',
    emoji: '🕵️',
    bgColor: 'bg-orange-50',
  },
  {
    id: 'demand',
    name: 'Demand Agent',
    description: 'Sales intelligence',
    emoji: '📊',
    bgColor: 'bg-indigo-50',
  },
  {
    id: 'export',
    name: 'Export Agent',
    description: 'POS & ecommerce sync',
    emoji: '📤',
    bgColor: 'bg-teal-50',
  },
];

const STATUS_BADGE = {
  active: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500', label: 'Active' },
  running: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500 pulse-dot', label: 'Running' },
  ready: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500', label: 'Ready' },
  scheduled: { bg: 'bg-blue-50', text: 'text-blue-700', dot: null, label: null },
  analyzed: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500', label: 'Analyzed' },
  synced: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500', label: 'Synced' },
};

const DECISION_ICONS = {
  pricing: { emoji: '💰', bg: 'bg-green-50' },
  matching: { emoji: '🔍', bg: 'bg-purple-50' },
  reorder: { emoji: '📦', bg: 'bg-red-50' },
  competitor: { emoji: '🕵️', bg: 'bg-orange-50' },
};

const ACTIVITY_BADGE = {
  alert: { bg: 'bg-orange-50', text: 'text-orange-700' },
  review: { bg: 'bg-amber-50', text: 'text-amber-700' },
  done: { bg: 'bg-green-50', text: 'text-green-700' },
};

// ── Mock Data (will be replaced with API calls) ──
const MOCK_AGENT_STATUS = {
  ingestion: {
    status: 'active',
    metrics: [
      { label: 'Last scan', value: '2 min ago' },
      { label: 'Today', value: '4 invoices processed' },
      { label: 'Sources', value: 'Gmail ✓ Folder ✓' },
    ],
  },
  matching: {
    status: 'running',
    metrics: [
      { label: 'Processing', value: 'Invoice #4523' },
      { label: 'Progress', value: '8 / 12 lines' },
    ],
    progress: 67,
    extraMetrics: [
      { label: 'Auto-match rate', value: '91%', valueClass: 'text-green-600' },
    ],
  },
  pricing: {
    status: 'ready',
    metrics: [
      { label: 'Recommendations', value: '7 pending', valueClass: 'text-amber-600' },
      { label: 'Potential gain', value: '+$142/wk', valueClass: 'text-green-600' },
      { label: 'Avg margin', value: '28.4%' },
    ],
  },
  competitor: {
    status: 'scheduled',
    scheduledLabel: 'Next: 2h',
    metrics: [
      { label: 'Last scan', value: '6:00 AM' },
      { label: 'Tracked products', value: '48 across 4 competitors' },
      { label: 'Alerts', value: '2 undercuts detected', valueClass: 'text-red-600' },
    ],
  },
  demand: {
    status: 'analyzed',
    metrics: [
      { label: 'Period', value: 'Week 11, 2026' },
      { label: 'Trending up', value: 'Eggs, Yogurt, Bread', valueClass: 'text-green-600' },
      { label: 'Dead stock', value: '3 items flagged', valueClass: 'text-red-600' },
    ],
  },
  export: {
    status: 'synced',
    metrics: [
      { label: 'Last push', value: '10:31 AM' },
      { label: 'Stores', value: 'Shopify ✓ Square ✓' },
      { label: 'Queued', value: '4 price updates', valueClass: 'text-amber-600' },
    ],
  },
};

const MOCK_DECISIONS = [
  {
    id: 1,
    type: 'pricing',
    title: 'Price increase recommended',
    badge: '+$18.72/wk',
    badgeClass: 'bg-green-50 text-green-700',
    description: 'Free Range Eggs 700g — Cost ↑11.5%, competitors higher, demand strong',
    detail: { from: '$6.50', to: '$6.99', sub: 'Margin: 10.8% → 17.1%' },
    actions: 'accept-edit-dismiss',
  },
  {
    id: 2,
    type: 'matching',
    title: 'New product match needs confirmation',
    badge: '87% confidence',
    badgeClass: 'bg-purple-50 text-purple-700',
    description: '"Bonsoy Organic Soy Milk 1L" → Soy Milk 1L (existing product)',
    actions: 'confirm-choose',
  },
  {
    id: 3,
    type: 'reorder',
    title: 'Reorder alert',
    badge: 'Critical',
    badgeClass: 'bg-red-50 text-red-700',
    description: 'Barista Oat Milk 1L — 2 days of stock remaining (selling 8 units/day)',
    actions: 'remind-dismiss',
  },
  {
    id: 4,
    type: 'competitor',
    title: 'Competitor price alert',
    badge: 'Opportunity',
    badgeClass: 'bg-orange-50 text-orange-700',
    description: 'Coles raised Organic Milk 2L to $6.89 (+12%) — you\'re at $5.99, room to increase',
    actions: 'view-dismiss',
  },
];

const MOCK_ACTIVITY = [
  { time: '10:34', agent: 'Competitor Agent', agentEmoji: '🕵️', agentBg: 'bg-orange-50', message: 'Coles raised Organic Milk 2L price by 12%', badge: 'alert' },
  { time: '10:33', agent: 'Pricing Agent', agentEmoji: '💰', agentBg: 'bg-green-50', message: '3 price increase recommendations generated for Invoice #4521', badge: 'review' },
  { time: '10:33', agent: 'Matching Agent', agentEmoji: '🔍', agentBg: 'bg-purple-50', message: '11/12 lines matched (92% auto-match rate) for Invoice #4521', badge: 'done' },
  { time: '10:32', agent: 'Ingestion Agent', agentEmoji: '📥', agentBg: 'bg-blue-50', message: 'Processed invoice #4521 from Gmail (Farm Fresh Supplies)', badge: 'done' },
  { time: '10:31', agent: 'Export Agent', agentEmoji: '📤', agentBg: 'bg-teal-50', message: 'Pushed 6 price updates to Shopify & Square POS', badge: 'done' },
  { time: '09:00', agent: 'Demand Agent', agentEmoji: '📊', agentBg: 'bg-indigo-50', message: 'Weekly analysis complete: Eggs ↑15%, Yogurt ↑8%, Rice ↓12%', badge: 'done' },
];

// ── Icons ──
const icons = {
  lightning: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
    </svg>
  ),
  upload: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  ),
  refresh: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
    </svg>
  ),
  download: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  ),
  check: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  ),
  edit: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
    </svg>
  ),
  close: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  clock: (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
};

// ── Sub-components ──

function StatusBadge({ status, scheduledLabel }) {
  if (status === 'scheduled') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
        {icons.clock}
        {scheduledLabel || 'Scheduled'}
      </span>
    );
  }
  const s = STATUS_BADGE[status] || STATUS_BADGE.active;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 ${s.bg} ${s.text} rounded-full text-xs font-medium`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function AgentCard({ agent, agentStatus }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-10 h-10 ${agent.bgColor} rounded-lg flex items-center justify-center`}>
            <span className="text-xl">{agent.emoji}</span>
          </div>
          <div>
            <h3 className="font-semibold text-sm">{agent.name}</h3>
            <p className="text-xs text-gray-500">{agent.description}</p>
          </div>
        </div>
        <StatusBadge status={agentStatus.status} scheduledLabel={agentStatus.scheduledLabel} />
      </div>
      <div className="space-y-2 text-sm">
        {agentStatus.metrics?.map((m, i) => (
          <div key={i} className="flex justify-between text-gray-600">
            <span>{m.label}</span>
            <span className={`font-medium ${m.valueClass || 'text-gray-900'}`}>{m.value}</span>
          </div>
        ))}
        {agentStatus.progress != null && (
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div className="bg-brand-500 h-1.5 rounded-full transition-all" style={{ width: `${agentStatus.progress}%` }} />
          </div>
        )}
        {agentStatus.extraMetrics?.map((m, i) => (
          <div key={i} className="flex justify-between text-gray-600">
            <span>{m.label}</span>
            <span className={`font-medium ${m.valueClass || 'text-gray-900'}`}>{m.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionActions({ decision, onDismiss }) {
  if (decision.actions === 'accept-edit-dismiss') {
    return (
      <div className="flex items-center gap-3 flex-shrink-0">
        {decision.detail && (
          <div className="text-right">
            <div className="text-sm font-medium">
              {decision.detail.from} → <span className="text-green-600">{decision.detail.to}</span>
            </div>
            <div className="text-xs text-gray-500">{decision.detail.sub}</div>
          </div>
        )}
        <div className="flex gap-1.5">
          <button className="p-2 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition" title="Accept">
            {icons.check}
          </button>
          <button className="p-2 bg-gray-50 text-gray-400 rounded-lg hover:bg-gray-100 transition" title="Edit">
            {icons.edit}
          </button>
          <button onClick={() => onDismiss(decision.id)} className="p-2 bg-gray-50 text-gray-400 rounded-lg hover:bg-gray-100 transition" title="Dismiss">
            {icons.close}
          </button>
        </div>
      </div>
    );
  }
  if (decision.actions === 'confirm-choose') {
    return (
      <div className="flex gap-1.5 flex-shrink-0">
        <button className="px-3 py-1.5 bg-brand-50 text-brand-700 rounded-lg text-sm font-medium hover:bg-brand-100 transition">Confirm Match</button>
        <button className="px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-100 transition">Choose Different</button>
      </div>
    );
  }
  if (decision.actions === 'remind-dismiss') {
    return (
      <div className="flex gap-1.5 flex-shrink-0">
        <button className="px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-sm font-medium hover:bg-amber-100 transition">Remind Me</button>
        <button onClick={() => onDismiss(decision.id)} className="px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-100 transition">Dismiss</button>
      </div>
    );
  }
  if (decision.actions === 'view-dismiss') {
    return (
      <div className="flex gap-1.5 flex-shrink-0">
        <button className="px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-sm font-medium hover:bg-green-100 transition">View Pricing</button>
        <button onClick={() => onDismiss(decision.id)} className="px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-100 transition">Dismiss</button>
      </div>
    );
  }
  return null;
}

// ── Main Component ──

export default function AICommandCenter() {
  const navigate = useNavigate();
  const [agentStatuses, setAgentStatuses] = useState(MOCK_AGENT_STATUS);
  const [decisions, setDecisions] = useState(MOCK_DECISIONS);
  const [activity] = useState(MOCK_ACTIVITY);
  const [loading, setLoading] = useState(false);
  const [runningAll, setRunningAll] = useState(false);

  // Try to load real data, fall back to mock
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (api.agents) {
          const [statusData, decisionsData] = await Promise.all([
            api.agents.getStatus(),
            api.agents.getPendingDecisions(),
          ]);
          if (!cancelled) {
            if (statusData) setAgentStatuses(statusData);
            if (decisionsData) setDecisions(decisionsData);
          }
        }
      } catch {
        // Fall back to mock data silently
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function handleDismiss(decisionId) {
    setDecisions((prev) => prev.filter((d) => d.id !== decisionId));
  }

  async function handleRunAll() {
    setRunningAll(true);
    try {
      if (api.agents?.run) {
        await api.agents.run();
      }
    } catch {
      // ignore
    } finally {
      setTimeout(() => setRunningAll(false), 2000);
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Agent Status Cards ── */}
      <div className="grid grid-cols-3 gap-4">
        {AGENTS.map((agent) => (
          <AgentCard key={agent.id} agent={agent} agentStatus={agentStatuses[agent.id] || { status: 'ready', metrics: [] }} />
        ))}
      </div>

      {/* ── Quick Actions ── */}
      <div className="flex gap-3">
        <button
          onClick={handleRunAll}
          disabled={runningAll}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition disabled:opacity-60"
        >
          {icons.lightning}
          {runningAll ? 'Running...' : 'Run All Agents'}
        </button>
        <button
          onClick={() => navigate('/invoices')}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition"
        >
          {icons.upload}
          Upload Invoice
        </button>
        <button className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition">
          {icons.refresh}
          Refresh Competitors
        </button>
        <button className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition">
          {icons.download}
          Import Sales Data
        </button>
      </div>

      {/* ── Pending Decisions ── */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🔔</span>
            <h2 className="font-semibold">Pending Decisions</h2>
            <span className="bg-amber-100 text-amber-800 text-xs font-medium px-2 py-0.5 rounded-full">
              {decisions.length} item{decisions.length !== 1 ? 's' : ''}
            </span>
          </div>
          <button
            onClick={() => navigate('/review')}
            className="text-sm text-brand-600 hover:text-brand-700 font-medium"
          >
            Review All →
          </button>
        </div>
        {decisions.length === 0 ? (
          <div className="px-5 py-10 text-center text-gray-400">
            No pending decisions — all caught up!
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {decisions.map((decision) => {
              const icon = DECISION_ICONS[decision.type] || DECISION_ICONS.pricing;
              return (
                <div key={decision.id} className="px-5 py-4 flex items-center gap-4 hover:bg-gray-50 transition">
                  <div className={`w-10 h-10 ${icon.bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
                    <span className="text-lg">{icon.emoji}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{decision.title}</span>
                      <span className={`px-1.5 py-0.5 ${decision.badgeClass} text-xs rounded font-medium`}>{decision.badge}</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">{decision.description}</p>
                  </div>
                  <DecisionActions decision={decision} onDismiss={handleDismiss} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Recent Agent Activity ── */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold">Recent Agent Activity</h2>
        </div>
        <div className="divide-y divide-gray-50">
          {activity.map((item, i) => {
            const badge = ACTIVITY_BADGE[item.badge] || ACTIVITY_BADGE.done;
            return (
              <div key={i} className="px-5 py-3 flex items-center gap-3 text-sm">
                <span className="text-xs text-gray-400 w-16">{item.time}</span>
                <span className={`w-6 h-6 ${item.agentBg} rounded flex items-center justify-center text-xs`}>{item.agentEmoji}</span>
                <span className="font-medium text-gray-700">{item.agent}</span>
                <span className="text-gray-500">{item.message}</span>
                <span className={`ml-auto px-2 py-0.5 ${badge.bg} ${badge.text} text-xs rounded`}>
                  {item.badge.charAt(0).toUpperCase() + item.badge.slice(1)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
