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
  getInvoices: () => request('/invoices'),
  getInvoice: (id) => request(`/invoices/${id}`),
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
  getProducts: (source) => request(`/products${source ? `?source=${encodeURIComponent(source)}` : ''}`),
  getProduct: (id) => request(`/products/${id}`),
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
    request('/products/import/confirm', { method: 'POST', body: JSON.stringify(data) }),
  getImportTemplates: () => request('/products/import/templates'),
  getImportTemplate: (systemName) =>
    request(`/products/import/templates/${encodeURIComponent(systemName)}`),
  saveImportTemplate: (systemName, mapping) =>
    request(`/products/import/templates/${encodeURIComponent(systemName)}`, {
      method: 'PUT',
      body: JSON.stringify({ mapping }),
    }),

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
  getExportData: (invoiceId) =>
    request(`/invoices/${invoiceId}/export`),

  // Cross-invoice export
  getExportableInvoices: () => request('/invoices/exportable'),
  getExportItems: (invoiceIds, includeExported = true) => {
    const params = new URLSearchParams({
      invoiceIds: invoiceIds.join(','),
      includeExported: String(includeExported),
    });
    return request(`/invoices/export/items?${params}`);
  },
  markExported: (matchIds) =>
    request('/invoices/export/mark', { method: 'POST', body: JSON.stringify({ matchIds }) }),
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
    poll: () => request('/gmail/poll', { method: 'POST' }),
    getImportLogs: (params) => {
      const qs = params ? `?${new URLSearchParams(params)}` : '';
      return request(`/gmail/import-logs${qs}`);
    },
    disconnect: () => request('/gmail/disconnect', { method: 'DELETE' }),
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
  },

  // ── Shopify Integration ─────────────────────────────────────────
  shopify: {
    getStatus: () => request('/shopify/status'),
    getAuthUrl: (shop) => request('/shopify/auth-url', { method: 'POST', body: JSON.stringify({ shop }) }),
    sync: () => request('/shopify/sync', { method: 'POST' }),
    getImportLogs: (params) => {
      const qs = params ? `?${new URLSearchParams(params)}` : '';
      return request(`/shopify/import-logs${qs}`);
    },
    disconnect: () => request('/shopify/disconnect', { method: 'DELETE' }),
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

    // Settings
    getSettings: () => request('/admin/settings'),
    updateSettings: (data) => request('/admin/settings', { method: 'PATCH', body: JSON.stringify(data) }),

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
};
