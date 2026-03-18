import { Router } from 'express';

const router = Router();

/**
 * POS / Ecommerce Connection Routes
 *
 * These routes handle OAuth-based connections to external POS and ecommerce
 * systems (Square, Lightspeed, Shopify, etc.). Currently returns mock data
 * to support the frontend wizard flow. Real OAuth integration requires
 * registering apps with each provider and implementing their specific
 * token exchange flows.
 */

// Supported POS / ecommerce systems
const SYSTEMS = [
  {
    id: 'square',
    name: 'Square',
    type: 'POS',
    oauthUrl: 'https://connect.squareup.com/oauth2/authorize',
    scopes: ['ITEMS_READ', 'ITEMS_WRITE', 'ORDERS_READ', 'INVENTORY_READ'],
  },
  {
    id: 'lightspeed',
    name: 'Lightspeed',
    type: 'POS',
    oauthUrl: 'https://cloud.lightspeedapp.com/oauth/authorize',
    scopes: ['employee:products', 'employee:inventory', 'employee:reports'],
  },
  {
    id: 'shopify-pos',
    name: 'Shopify POS',
    type: 'POS',
    oauthUrl: 'https://{shop}.myshopify.com/admin/oauth/authorize',
    scopes: ['read_products', 'write_products', 'read_orders', 'read_inventory'],
  },
  {
    id: 'shopify',
    name: 'Shopify',
    type: 'ECOMMERCE',
    oauthUrl: 'https://{shop}.myshopify.com/admin/oauth/authorize',
    scopes: ['read_products', 'write_products', 'read_orders', 'read_inventory'],
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    type: 'ECOMMERCE',
    oauthUrl: null,
    scopes: [],
    comingSoon: true,
  },
];

// In-memory connection state (per tenant) — would be stored in DB in production
const connections = new Map();

function getKey(tenantId, systemId) {
  return `${tenantId}:${systemId}`;
}

/**
 * GET /api/connect/systems
 * List all available POS/ecommerce systems
 */
router.get('/systems', (_req, res) => {
  res.json(SYSTEMS.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    comingSoon: s.comingSoon || false,
  })));
});

/**
 * GET /api/connect/status
 * Get connection status for all systems for the current tenant
 */
router.get('/status', (req, res) => {
  const tenantId = req.tenantId;
  const result = SYSTEMS.map((s) => {
    const conn = connections.get(getKey(tenantId, s.id));
    return {
      system: s.id,
      name: s.name,
      type: s.type,
      connected: !!conn?.connected,
      connectedAt: conn?.connectedAt || null,
      stores: conn?.stores || [],
    };
  });
  res.json({ connections: result });
});

/**
 * POST /api/connect/:system/auth-url
 * Generate an OAuth authorization URL for the given system
 */
router.post('/:system/auth-url', (req, res) => {
  const { system } = req.params;
  const sysConfig = SYSTEMS.find((s) => s.id === system);

  if (!sysConfig) {
    return res.status(404).json({ message: `Unknown system: ${system}` });
  }

  if (sysConfig.comingSoon) {
    return res.status(400).json({ message: `${sysConfig.name} integration is coming soon` });
  }

  // In production, this would generate a real OAuth URL with state parameter
  // For now, return a mock URL that the frontend wizard simulates
  const state = Buffer.from(JSON.stringify({
    tenantId: req.tenantId,
    system,
  })).toString('base64');

  const redirectUri = `${req.protocol}://${req.get('host')}/api/connect/${system}/callback`;

  res.json({
    url: `${sysConfig.oauthUrl}?client_id=MOCK_CLIENT_ID&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${sysConfig.scopes.join('+')}&state=${state}`,
    system: sysConfig.id,
  });
});

/**
 * POST /api/connect/:system/callback
 * Handle OAuth callback (exchange code for token)
 */
router.post('/:system/callback', (req, res) => {
  const { system } = req.params;
  const { code } = req.body;
  const tenantId = req.tenantId;
  const sysConfig = SYSTEMS.find((s) => s.id === system);

  if (!sysConfig) {
    return res.status(404).json({ message: `Unknown system: ${system}` });
  }

  // In production, exchange the code for access + refresh tokens
  // For now, store a mock connection
  connections.set(getKey(tenantId, system), {
    connected: true,
    connectedAt: new Date().toISOString(),
    accessToken: 'mock_access_token',
    refreshToken: 'mock_refresh_token',
    stores: [],
    syncSettings: {},
  });

  res.json({ success: true, message: `Connected to ${sysConfig.name}` });
});

/**
 * POST /api/connect/:system/map-stores
 * Save store mappings and sync settings
 */
router.post('/:system/map-stores', (req, res) => {
  const { system } = req.params;
  const { mappings, syncSettings } = req.body;
  const tenantId = req.tenantId;
  const key = getKey(tenantId, system);

  const conn = connections.get(key);
  if (!conn) {
    // Auto-create connection for the wizard flow
    connections.set(key, {
      connected: true,
      connectedAt: new Date().toISOString(),
      accessToken: 'mock_access_token',
      refreshToken: 'mock_refresh_token',
      stores: [],
      syncSettings: {},
    });
  }

  const updatedConn = connections.get(key);
  updatedConn.storeMappings = mappings;
  updatedConn.syncSettings = syncSettings || {};
  updatedConn.stores = Object.entries(mappings || {}).map(([externalId, internalId]) => ({
    externalId,
    internalId,
    syncing: true,
  }));
  connections.set(key, updatedConn);

  res.json({
    success: true,
    message: 'Store mappings saved',
    mappings: updatedConn.storeMappings,
  });
});

/**
 * DELETE /api/connect/:system
 * Disconnect a POS/ecommerce system
 */
router.delete('/:system', (req, res) => {
  const { system } = req.params;
  const tenantId = req.tenantId;
  const sysConfig = SYSTEMS.find((s) => s.id === system);

  if (!sysConfig) {
    return res.status(404).json({ message: `Unknown system: ${system}` });
  }

  connections.delete(getKey(tenantId, system));
  res.json({ success: true, message: `Disconnected from ${sysConfig.name}` });
});

export default router;
