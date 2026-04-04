const API_BASE = '/api';

async function request(path, options = {}) {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message || 'Request failed');
  }
  return res.json();
}

export const api = {
  // Auth
  login: (email, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (data) => request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  me: () => request('/auth/me'),

  // Invoices
  getInvoiceCounts: () => request('/invoices/counts'),
  getDashboardStats: () => request('/invoices/dashboard-stats'),
  getActionInvoices: () => request('/invoices/action-invoices'),
  getInvoices: (params) => {
    const qs = params ? `?${new URLSearchParams(params)}` : '';
    return request(`/invoices${qs}`);
  },
  getInvoice: (id) => request(`/invoices/${id}`),
  getInvoiceDetails: (id) => request(`/invoices/${id}/details`),
  correctMatch: async (invoiceId, lineId, body) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_BASE}/invoices/${invoiceId}/lines/${lineId}/correct-match`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ message: res.statusText }));
    if (!res.ok) {
      const err = new Error(data.message || 'Correction failed');
      err.code = data.code;
      err.data = data;
      throw err;
    }
    return data;
  },
  uploadInvoice: (formData) =>
    fetch(`${API_BASE}/invoices/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: formData,
    }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Upload failed');
      return data;
    }),
  updateInvoice: (id, data) => request(`/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteInvoice: (id) => request(`/invoices/${id}`, { method: 'DELETE' }),
  updateInvoiceLine: (invoiceId, lineId, data) =>
    request(`/invoices/${invoiceId}/lines/${lineId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  reallocateCosts: (invoiceId) =>
    request(`/invoices/${invoiceId}/reallocate`, { method: 'POST' }),

  // Products
  getProducts: (params) => {
    const qs = params ? `?${new URLSearchParams(params)}` : '';
    return request(`/products${qs}`);
  },
  getProduct: (id) => request(`/products/${id}`),
  getProductPriceHistory: (id, params) => {
    const qs = params ? `?${new URLSearchParams(params)}` : '';
    return request(`/products/${id}/price-history${qs}`);
  },
  createProduct: (data) => request('/products', { method: 'POST', body: JSON.stringify(data) }),
  deleteProduct: (id) => request(`/products/${id}`, { method: 'DELETE' }),
  bulkDeleteProducts: (ids) => request('/products/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),

  // Product Import
  uploadProductFile: (formData) =>
    fetch(`${API_BASE}/products/import/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: formData,
    }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Upload failed');
      return data;
    }),
  confirmProductImport: (data) =>
    request('/v1/products/import/confirm', { method: 'POST', body: JSON.stringify(data) }),
  getImportTemplates: () => request('/products/import/templates'),
  getImportTemplate: (systemName) =>
    request(`/products/import/templates/${encodeURIComponent(systemName)}`),
  saveImportTemplate: (systemName, mapping) =>
    request(`/products/import/templates/${encodeURIComponent(systemName)}`, {
      method: 'PUT',
      body: JSON.stringify({ mapping }),
    }),

  // Smart Product Import (AI-powered) — v1 pipeline with approval gate
  smartImportUpload: (formData) =>
    fetch(`${API_BASE}/v1/products/import/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: formData,
    }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Upload failed');
      return data;
    }),
  smartImportChat: (uploadId, importJobId, message) =>
    request('/v1/products/import/chat', { method: 'POST', body: JSON.stringify({ uploadId, importJobId, message }) }),
  smartImportTest: (uploadId, importJobId) =>
    request('/v1/products/import/test', { method: 'POST', body: JSON.stringify({ uploadId, importJobId }) }),
  smartImportConfirm: (uploadId, importJobId, saveTemplate) =>
    request('/v1/products/import/confirm', { method: 'POST', body: JSON.stringify({ uploadId, importJobId, saveTemplate }) }),
  smartImportSession: (uploadId) =>
    request(`/product-import/session/${uploadId}`),

  // Approval Queue
  getApprovalQueue: (params) => {
    const qs = params ? `?${new URLSearchParams(params)}` : '';
    return request(`/v1/products/approval-queue${qs}`);
  },
  getApprovalQueueSummary: () =>
    request('/v1/products/approval-queue/summary'),
  getApprovalQueueEntry: (id) =>
    request(`/v1/products/approval-queue/${id}`),
  approveQueueEntry: (id, notes) =>
    request(`/v1/products/approval-queue/${id}/approve`, { method: 'POST', body: JSON.stringify({ notes }) }),
  rejectQueueEntry: (id, notes) =>
    request(`/v1/products/approval-queue/${id}/reject`, { method: 'POST', body: JSON.stringify({ notes }) }),
  bulkApproveAllQueue: (importJobId) =>
    request('/v1/products/approval-queue/bulk', {
      method: 'POST',
      body: JSON.stringify({
        action: 'approve',
        notes: 'Bulk approved — Approve All action',
        approveAll: true,
        ...(importJobId ? { importJobId } : {}),
      }),
    }),
  smartImportExport: async (systemName) => {
    const resp = await fetch(`${API_BASE}/product-import/export`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify({ systemName }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.message || 'Export failed');
    }
    // Download as file
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const disposition = resp.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="(.+)"/);
    a.href = url;
    a.download = match ? match[1] : `${systemName}_export.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // Stores
  getStores: () => request('/stores'),

  // Invoice matching
  runMatching: (invoiceId) =>
    request(`/invoices/${invoiceId}/match`, { method: 'POST' }),
  setLineMatch: (invoiceId, lineId, data) =>
    request(`/invoices/${invoiceId}/lines/${lineId}/matches`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateMatch: (invoiceId, lineId, matchId, data) =>
    request(`/invoices/${invoiceId}/lines/${lineId}/matches/${matchId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  confirmLine: (invoiceId, lineId, data) =>
    request(`/invoices/${invoiceId}/lines/${lineId}/confirm`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  approveInvoice: (invoiceId) =>
    request(`/invoices/${invoiceId}/approve`, { method: 'POST' }),
  reOcr: (invoiceId) =>
    request(`/invoices/${invoiceId}/reocr`, { method: 'POST' }),
  getExportData: (invoiceId) =>
    request(`/invoices/${invoiceId}/export`),

  // Cross-invoice export
  getExportableInvoices: () => request('/invoices/exportable'),
  getExportItems: (invoiceIds, includeOtherExported = false) => {
    const params = new URLSearchParams({
      invoiceIds: invoiceIds.join(','),
      includeOtherExported: String(includeOtherExported),
    });
    return request(`/invoices/export/items?${params}`);
  },
  markExported: (matchIds, syncPlatforms) =>
    request('/invoices/export/mark', { method: 'POST', body: JSON.stringify({ matchIds, syncPlatforms }) }),
  updateExportPrice: (matchId, approvedPrice) =>
    request('/invoices/export/price', { method: 'PATCH', body: JSON.stringify({ matchId, approvedPrice }) }),

  // Product search (for match resolution)
  searchProducts: (query, storeId) => {
    const params = new URLSearchParams({ q: query });
    if (storeId) params.set('storeId', storeId);
    return request(`/products/search?${params}`);
  },

  // Pricing rules
  getPricingRules: () => request('/pricing-rules'),
  createPricingRule: (data) => request('/pricing-rules', { method: 'POST', body: JSON.stringify(data) }),
  updatePricingRule: (id, data) => request(`/pricing-rules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePricingRule: (id) => request(`/pricing-rules/${id}`, { method: 'DELETE' }),

  // ── Gmail Integration ──────────────────────────────────────────
  gmail: {
    getStatus: () => request('/gmail/status'),
    saveCredentials: (data) => request('/gmail/save-credentials', { method: 'POST', body: JSON.stringify(data) }),
    getAuthUrl: () => request('/gmail/auth-url'),
    configure: (data) => request('/gmail/configure', { method: 'POST', body: JSON.stringify(data) }),
    poll: (integrationId) => request('/gmail/poll', { method: 'POST', body: JSON.stringify(integrationId ? { integrationId } : {}) }),
    getImportLogs: (params) => {
      const qs = params ? `?${new URLSearchParams(params)}` : '';
      return request(`/gmail/import-logs${qs}`);
    },
    disconnect: (integrationId) => integrationId
      ? request(`/gmail/${integrationId}/disconnect`, { method: 'DELETE' })
      : request('/gmail/disconnect', { method: 'DELETE' }),
    // IMAP (App Password) methods
    imapTestConnection: (data) => request('/gmail/imap/test-connection', { method: 'POST', body: JSON.stringify(data) }),
    imapSaveCredentials: (data) => request('/gmail/imap/save-credentials', { method: 'POST', body: JSON.stringify(data) }),
  },

  // ── Folder Polling Integration ────────────────────────────────
  folderPolling: {
    getStatus: () => request('/folder-polling/status'),
    configure: (data) => request('/folder-polling/configure', { method: 'POST', body: JSON.stringify(data) }),
    testConnection: (data) => request('/folder-polling/test-connection', { method: 'POST', body: JSON.stringify(data) }),
    poll: () => request('/folder-polling/poll', { method: 'POST' }),
    getImportLogs: (params) => {
      const qs = params ? `?${new URLSearchParams(params)}` : '';
      return request(`/folder-polling/import-logs${qs}`);
    },
    disconnect: () => request('/folder-polling/disconnect', { method: 'DELETE' }),
    browse: (folderPath) => request('/folder-polling/browse', { method: 'POST', body: JSON.stringify({ path: folderPath }) }),
  },

  // ── Google Drive Integration ───────────────────────────────────
  drive: {
    getStatus: () => request('/drive/status'),
    saveCredentials: (data) => request('/drive/save-credentials', { method: 'POST', body: JSON.stringify(data) }),
    getAuthUrl: () => request('/drive/auth-url'),
    getFolders: (parentId, integrationId) => {
      const params = new URLSearchParams();
      if (parentId) params.set('parentId', parentId);
      if (integrationId) params.set('integrationId', integrationId);
      const qs = params.toString() ? `?${params}` : '';
      return request(`/drive/folders${qs}`);
    },
    addFolder: (data) => request('/drive/add-folder', { method: 'POST', body: JSON.stringify(data) }),
    poll: (integrationId) => request(`/drive/${integrationId}/poll`, { method: 'POST' }),
    pollAll: () => request('/drive/poll-all', { method: 'POST' }),
    getImportLogs: (params) => {
      const qs = params ? `?${new URLSearchParams(params)}` : '';
      return request(`/drive/import-logs${qs}`);
    },
    disconnect: (integrationId) => request(`/drive/${integrationId}/disconnect`, { method: 'DELETE' }),
  },

  // ── Shopify Integration ─────────────────────────────────────────
  shopify: {
    getStatus: () => request('/shopify/status'),
    getAuthUrl: (shop) => request('/shopify/auth-url', { method: 'POST', body: JSON.stringify({ shop }) }),
    sync: () => request('/shopify/sync', { method: 'POST' }),
    syncOrders: () => request('/shopify/sync-orders', { method: 'POST' }),
    getOrders: (params) => {
      const qs = params ? `?${new URLSearchParams(params)}` : '';
      return request(`/shopify/orders${qs}`);
    },
    getImportLogs: (params) => {
      const qs = params ? `?${new URLSearchParams(params)}` : '';
      return request(`/shopify/import-logs${qs}`);
    },
    updateSettings: (settings) => request('/shopify/settings', { method: 'PATCH', body: JSON.stringify(settings) }),
    disconnect: () => request('/shopify/disconnect', { method: 'DELETE' }),
    matchVariants: () => request('/shopify/match-variants', { method: 'POST' }),
    linkVariant: (data) => request('/shopify/match-variants/link', { method: 'POST', body: JSON.stringify(data) }),
    dismissVariant: (shopifyVariantId) => request('/shopify/match-variants/dismiss', { method: 'POST', body: JSON.stringify({ shopifyVariantId }) }),
  },

  // ── Competitor Intelligence ───────────────────────────────────
  competitor: {
    getMonitors: () => request('/competitor/monitors'),
    createMonitor: (data) => request('/competitor/monitors', { method: 'POST', body: JSON.stringify(data) }),
    updateMonitor: (id, data) => request(`/competitor/monitors/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteMonitor: (id) => request(`/competitor/monitors/${id}`, { method: 'DELETE' }),
    addPrice: (monitorId, data) => request(`/competitor/monitors/${monitorId}/prices`, { method: 'POST', body: JSON.stringify(data) }),
    getPriceHistory: (monitorId) => request(`/competitor/monitors/${monitorId}/prices`),
    getWaterfall: (productId) => request(`/competitor/products/${productId}/waterfall`),
    getSupplierComparison: (productId) => request(`/competitor/products/${productId}/suppliers`),
    getSupplierHistory: (productId, supplierId) => request(`/competitor/products/${productId}/supplier-history/${supplierId}`),
    getAiRecommendation: (productId) => request(`/competitor/products/${productId}/ai-recommendation`, { method: 'POST' }),
    getAlerts: () => request('/competitor/alerts'),
    generateAlerts: () => request('/competitor/alerts/generate', { method: 'POST' }),
    updateAlert: (id, data) => request(`/competitor/alerts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  },

  // ── Admin API ──────────────────────────────────────────────────
  admin: {
    // Overview
    getOverviewStats: () => request('/admin/overview/stats'),
    getActivity: (limit) => request(`/admin/overview/activity${limit ? `?limit=${limit}` : ''}`),

    // Tenants
    getTenants: (params) => {
      const qs = params ? `?${new URLSearchParams(params)}` : '';
      return request(`/admin/tenants${qs}`);
    },
    getTenant: (id) => request(`/admin/tenants/${id}`),
    createTenant: (data) => request('/admin/tenants', { method: 'POST', body: JSON.stringify(data) }),
    updateTenant: (id, data) => request(`/admin/tenants/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    lockTenant: (id, reason) => request(`/admin/tenants/${id}/lock`, { method: 'POST', body: JSON.stringify({ reason }) }),
    unlockTenant: (id, reason) => request(`/admin/tenants/${id}/unlock`, { method: 'POST', body: JSON.stringify({ reason }) }),
    updateSubscription: (id, data) => request(`/admin/tenants/${id}/subscription`, { method: 'PATCH', body: JSON.stringify(data) }),

    // API Usage
    getApiUsage: (params) => {
      const qs = params ? `?${new URLSearchParams(params)}` : '';
      return request(`/admin/api-usage${qs}`);
    },
    getApiCalls: (params) => {
      const qs = params ? `?${new URLSearchParams(params)}` : '';
      return request(`/admin/api-usage/calls${qs}`);
    },
    getApiCallDetail: (id) => request(`/admin/api-usage/calls/${id}`),
    getApiAgentUsage: (params) => {
      const qs = params ? `?${new URLSearchParams(params)}` : '';
      return request(`/admin/api-usage/agents${qs}`);
    },

    // Settings
    getSettings: () => request('/admin/settings'),
    updateSettings: (data) => request('/admin/settings', { method: 'PATCH', body: JSON.stringify(data) }),

    // Prompt Management (Admin)
    getPromptAgents: () => request('/admin/prompts/agents'),
    getPromptAgent: (key) => request(`/admin/prompts/agents/${key}`),
    getTenantPrompt: (tenantId, agentKey) => request(`/admin/prompts/tenants/${tenantId}/${agentKey}`),
    getTenantOverrides: (tenantId) => request(`/admin/prompts/tenants/${tenantId}/overrides`),
    getPromptConflicts: () => request('/admin/prompts/conflicts'),
    getPromptChangeLog: (tenantId, limit) => request(`/admin/prompts/change-log/${tenantId}${limit ? `?limit=${limit}` : ''}`),

    // Features & Tiers
    getFeatures: () => request('/admin/tiers/features'),
    createFeature: (data) => request('/admin/tiers/features', { method: 'POST', body: JSON.stringify(data) }),
    updateFeature: (id, data) => request(`/admin/tiers/features/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteFeature: (id) => request(`/admin/tiers/features/${id}`, { method: 'DELETE' }),
    getTiers: () => request('/admin/tiers'),
    getTier: (id) => request(`/admin/tiers/${id}`),
    createTier: (data) => request('/admin/tiers', { method: 'POST', body: JSON.stringify(data) }),
    updateTier: (id, data) => request(`/admin/tiers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteTier: (id) => request(`/admin/tiers/${id}`, { method: 'DELETE' }),
  },

  // POS / Ecommerce Connections
  connect: {
    getSystems: () => request('/connect/systems'),
    getStatus: () => request('/connect/status'),
    getAuthUrl: (system) => request(`/connect/${system}/auth-url`, { method: 'POST' }),
    handleCallback: (system, code) => request(`/connect/${system}/callback`, { method: 'POST', body: JSON.stringify({ code }) }),
    mapStores: (system, data) => request(`/connect/${system}/map-stores`, { method: 'POST', body: JSON.stringify(data) }),
    disconnect: (system) => request(`/connect/${system}`, { method: 'DELETE' }),
  },

  // AI Agents
  agents: {
    getStatus: () => request('/agents/status'),
    getPendingDecisions: () => request('/agents/pending-decisions'),
    getActivity: (limit) => request(`/agents/activity${limit ? `?limit=${limit}` : ''}`),
    getUsage: () => request('/agents/usage'),
    getEvents: (params) => {
      const qs = params ? `?${new URLSearchParams(params)}` : '';
      return request(`/agents/events${qs}`);
    },
    run: () => request('/agents/run', { method: 'POST' }),
  },

  // AI Business Advisor (Chat)
  chat: {
    getConversations: () => request('/chat/conversations'),
    createConversation: (title) =>
      request('/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({ title }),
      }),
    getConversation: (id) => request(`/chat/conversations/${id}`),
    deleteConversation: (id) =>
      request(`/chat/conversations/${id}`, { method: 'DELETE' }),
    updateConversation: (id, data) =>
      request(`/chat/conversations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    sendFeedback: (messageId, rating, comment) =>
      request(`/chat/messages/${messageId}/feedback`, {
        method: 'PATCH',
        body: JSON.stringify({ rating, comment }),
      }),
  },

  // ── Prompt Chat ─────────────────────────────────────────────────
  promptChat: {
    sendMessage: (message) => request('/prompt-chat/message', { method: 'POST', body: JSON.stringify({ message }) }),
    confirmAction: (action) => request('/prompt-chat/confirm', { method: 'POST', body: JSON.stringify({ action }) }),
    getHistory: () => request('/prompt-chat/history'),
    clearHistory: () => request('/prompt-chat/history', { method: 'DELETE' }),
    getChangeLog: (limit) => request(`/prompt-chat/change-log${limit ? `?limit=${limit}` : ''}`),
  },

  // ── Prompt Configuration ────────────────────────────────────────
  prompts: {
    getAgents: () => request('/prompts/agents'),
    getConditions: (agentKey) => request(`/prompts/agents/${agentKey}/conditions`),
    addOverride: (agentKey, data) => request(`/prompts/agents/${agentKey}/overrides`, { method: 'POST', body: JSON.stringify(data) }),
    updateOverride: (id, data) => request(`/prompts/overrides/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteOverride: (id) => request(`/prompts/overrides/${id}`, { method: 'DELETE' }),
    getConflicts: () => request('/prompts/conflicts'),
    resolveConflict: (id, data) => request(`/prompts/conflicts/${id}/resolve`, { method: 'POST', body: JSON.stringify(data) }),
    getChangeLog: (limit) => request(`/prompts/change-log${limit ? `?limit=${limit}` : ''}`),
  },
};

/**
 * Start an SSE stream for a chat message.
 * Returns the raw fetch Response for SSE consumption.
 *
 * @param {string} conversationId
 * @param {string} content — The user's message text
 * @returns {Promise<Response>}
 */
export async function chatStream(conversationId, content) {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE}/chat/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message || error.error || 'Failed to send message');
  }

  return res;
}
