import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import PollIntervalInput from '../ui/PollIntervalInput';
import FolderBrowser from '../ui/FolderBrowser';
import DriveFolderPicker from './DriveFolderPicker';

export default function IntegrationsTab() {
  const [gmailStatus, setGmailStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [configuring, setConfiguring] = useState(false);
  const [polling, setPolling] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [importLogs, setImportLogs] = useState([]);
  const [config, setConfig] = useState({
    senderWhitelist: [],
    labelFilter: '',
    pollIntervalMin: 30,
    initialLookbackDays: 7,
  });
  const [whitelistInput, setWhitelistInput] = useState('');
  const [creds, setCreds] = useState({ googleClientId: '', googleClientSecret: '' });

  // ── Folder Polling state ──
  const [folderStatus, setFolderStatus] = useState(null);
  const [folderSaving, setFolderSaving] = useState(false);
  const [folderTesting, setFolderTesting] = useState(false);
  const [folderTestResult, setFolderTestResult] = useState(null);
  const [folderPolling, setFolderPolling] = useState(false);
  const [folderConfiguring, setFolderConfiguring] = useState(false);
  const [folderImportLogs, setFolderImportLogs] = useState([]);
  const [folderConfig, setFolderConfig] = useState({
    folderPath: '',
    filePatterns: ['*.pdf', '*.jpg', '*.jpeg', '*.png', '*.webp'],
    pollIntervalMin: 30,
  });
  const [patternInput, setPatternInput] = useState('');
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);

  // ── Google Drive state ──
  const [driveIntegrations, setDriveIntegrations] = useState([]);
  const [driveLoading, setDriveLoading] = useState(true);
  const [drivePolling, setDrivePolling] = useState(null); // integration ID being polled
  const [driveDisconnecting, setDriveDisconnecting] = useState(null);
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [drivePendingId, setDrivePendingId] = useState(null);
  const [showDriveFolderPicker, setShowDriveFolderPicker] = useState(false);
  const [driveAddingFolder, setDriveAddingFolder] = useState(false);
  const [driveImportLogs, setDriveImportLogs] = useState([]);
  const [driveCreds, setDriveCreds] = useState({ googleClientId: '', googleClientSecret: '' });
  const [driveSavingCreds, setDriveSavingCreds] = useState(false);
  const [driveHasCredentials, setDriveHasCredentials] = useState(false);

  // ── Shopify state ──
  const [shopifyStatus, setShopifyStatus] = useState(null);
  const [shopifyShop, setShopifyShop] = useState('');
  const [shopifyConnecting, setShopifyConnecting] = useState(false);
  const [shopifySyncing, setShopifySyncing] = useState(false);
  const [shopifyOrderSyncing, setShopifyOrderSyncing] = useState(false);
  const [shopifyImportLogs, setShopifyImportLogs] = useState([]);
  const [shopifyOrders, setShopifyOrders] = useState([]);
  const [shopifyOrdersLoaded, setShopifyOrdersLoaded] = useState(false);
  const [shopifyOrdersPage, setShopifyOrdersPage] = useState(1);
  const [shopifyOrdersTotal, setShopifyOrdersTotal] = useState(0);
  const [shopifyActiveTab, setShopifyActiveTab] = useState('products'); // 'products' | 'orders' | 'match'
  const [shopifyMatching, setShopifyMatching] = useState(false);
  const [shopifyMatchResult, setShopifyMatchResult] = useState(null);
  const [shopifyLinking, setShopifyLinking] = useState(null);
  const [shopifySearchQuery, setShopifySearchQuery] = useState('');
  const [shopifySearchResults, setShopifySearchResults] = useState([]);
  const [shopifySearchingFor, setShopifySearchingFor] = useState(null);

  useEffect(() => {
    loadStatus();
    loadFolderStatus();
    loadDriveStatus();
    loadShopifyStatus();

    // Handle OAuth redirect — check URL params set by the callback
    const params = new URLSearchParams(window.location.search);
    if (params.get('gmail') === 'connected') {
      window.history.replaceState({}, '', '/settings');
      loadStatus();
    } else if (params.get('gmail') === 'error') {
      const reason = params.get('reason') || 'unknown error';
      alert(`Gmail connection failed: ${reason}`);
      window.history.replaceState({}, '', '/settings');
    }
    // Handle Google Drive OAuth redirect
    if (params.get('drive') === 'connected') {
      window.history.replaceState({}, '', '/settings');
      loadDriveStatus();
    } else if (params.get('drive') === 'error') {
      const reason = params.get('reason') || 'unknown error';
      alert(`Google Drive connection failed: ${reason}`);
      window.history.replaceState({}, '', '/settings');
    }
    // Handle Shopify OAuth redirect
    if (params.get('shopify') === 'connected') {
      window.history.replaceState({}, '', '/settings');
      loadShopifyStatus();
    } else if (params.get('shopify') === 'error') {
      const reason = params.get('reason') || 'unknown error';
      alert(`Shopify connection failed: ${reason}`);
      window.history.replaceState({}, '', '/settings');
    }
  }, []);

  const loadStatus = async () => {
    try {
      const status = await api.gmail.getStatus();
      setGmailStatus(status);
      if (status.connected) {
        setConfig({
          senderWhitelist: status.integration.senderWhitelist || [],
          labelFilter: status.integration.labelFilter || '',
          pollIntervalMin: status.integration.pollIntervalMin || 30,
          initialLookbackDays: status.integration.initialLookbackDays || 7,
        });
        const logData = await api.gmail.getImportLogs();
        setImportLogs(logData.logs || []);
      }
      // Pre-fill client ID if already saved
      if (status.googleClientId) {
        setCreds((prev) => ({ ...prev, googleClientId: status.googleClientId }));
      }
    } catch (err) {
      console.error('Failed to load Gmail status:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCredentials = async () => {
    if (!creds.googleClientId || !creds.googleClientSecret) {
      alert('Both Client ID and Client Secret are required.');
      return;
    }
    setSavingCreds(true);
    try {
      await api.gmail.saveCredentials(creds);
      setCreds((prev) => ({ ...prev, googleClientSecret: '' }));
      await loadStatus();
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingCreds(false);
    }
  };

  const handleConnect = async () => {
    try {
      const { url } = await api.gmail.getAuthUrl();
      // Open Google OAuth consent in a popup window
      const popup = window.open(url, 'gmail-oauth', 'width=600,height=700,scrollbars=yes');
      if (!popup) {
        // Popup blocked — fall back to redirect
        window.location.href = url;
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSaveConfig = async () => {
    setConfiguring(true);
    try {
      await api.gmail.configure(config);
      await loadStatus();
    } catch (err) {
      alert(err.message);
    } finally {
      setConfiguring(false);
    }
  };

  const handlePoll = async () => {
    setPolling(true);
    try {
      const result = await api.gmail.poll();
      alert(result.message || `Processed: ${result.processed}, Imported: ${result.imported}, Duplicates: ${result.duplicates}`);
      await loadStatus();
    } catch (err) {
      alert(err.message);
    } finally {
      setPolling(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect all Gmail accounts? This will remove all tokens and credentials.')) return;
    try {
      await api.gmail.disconnect();
      setGmailStatus({ connected: false, hasCredentials: false, integrations: [] });
      setImportLogs([]);
      setCreds({ googleClientId: '', googleClientSecret: '' });
    } catch (err) {
      alert(err.message);
    }
  };

  const addToWhitelist = () => {
    if (!whitelistInput.trim()) return;
    setConfig((prev) => ({
      ...prev,
      senderWhitelist: [...prev.senderWhitelist, whitelistInput.trim()],
    }));
    setWhitelistInput('');
  };

  const removeFromWhitelist = (email) => {
    setConfig((prev) => ({
      ...prev,
      senderWhitelist: prev.senderWhitelist.filter((e) => e !== email),
    }));
  };

  // ── Folder Polling handlers ──

  const loadFolderStatus = async () => {
    try {
      const status = await api.folderPolling.getStatus();
      setFolderStatus(status);
      if (status.connected) {
        setFolderConfig({
          folderPath: status.integration.folderPath || '',
          filePatterns: status.integration.filePatterns || ['*.pdf', '*.jpg', '*.jpeg', '*.png', '*.webp'],
          pollIntervalMin: status.integration.pollIntervalMin || 30,
        });
        const logData = await api.folderPolling.getImportLogs();
        setFolderImportLogs(logData.logs || []);
      }
    } catch (err) {
      console.error('Failed to load folder status:', err);
    }
  };

  const handleFolderTestConnection = async () => {
    if (!folderConfig.folderPath.trim()) {
      alert('Enter a folder path first.');
      return;
    }
    setFolderTesting(true);
    setFolderTestResult(null);
    try {
      const result = await api.folderPolling.testConnection({ folderPath: folderConfig.folderPath.trim() });
      setFolderTestResult(result);
    } catch (err) {
      setFolderTestResult({ success: false, error: err.message });
    } finally {
      setFolderTesting(false);
    }
  };

  const handleFolderSave = async () => {
    if (!folderConfig.folderPath.trim()) {
      alert('Folder path is required.');
      return;
    }
    setFolderSaving(true);
    try {
      await api.folderPolling.configure(folderConfig);
      await loadFolderStatus();
      setFolderTestResult(null);
    } catch (err) {
      alert(err.message);
    } finally {
      setFolderSaving(false);
    }
  };

  const handleFolderSaveConfig = async () => {
    setFolderConfiguring(true);
    try {
      await api.folderPolling.configure(folderConfig);
      await loadFolderStatus();
    } catch (err) {
      alert(err.message);
    } finally {
      setFolderConfiguring(false);
    }
  };

  const handleFolderPoll = async () => {
    setFolderPolling(true);
    try {
      const result = await api.folderPolling.poll();
      alert(`Processed: ${result.processed}, Imported: ${result.imported}, Duplicates: ${result.duplicates}, Failed: ${result.failed}`);
      await loadFolderStatus();
    } catch (err) {
      alert(err.message);
    } finally {
      setFolderPolling(false);
    }
  };

  const handleFolderDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect folder polling? This will remove the folder configuration.')) return;
    try {
      await api.folderPolling.disconnect();
      setFolderStatus({ connected: false });
      setFolderImportLogs([]);
      setFolderConfig({ folderPath: '', filePatterns: ['*.pdf', '*.jpg', '*.jpeg', '*.png'], pollIntervalMin: 30 });
      setFolderTestResult(null);
    } catch (err) {
      alert(err.message);
    }
  };

  const addPattern = () => {
    const p = patternInput.trim();
    if (!p) return;
    const formatted = p.startsWith('*.') ? p : `*.${p}`;
    if (folderConfig.filePatterns.includes(formatted)) return;
    setFolderConfig((prev) => ({
      ...prev,
      filePatterns: [...prev.filePatterns, formatted],
    }));
    setPatternInput('');
  };

  const removePattern = (pattern) => {
    setFolderConfig((prev) => ({
      ...prev,
      filePatterns: prev.filePatterns.filter((p) => p !== pattern),
    }));
  };

  // ── Google Drive handlers ──

  const loadDriveStatus = async () => {
    try {
      const status = await api.drive.getStatus();
      setDriveIntegrations(status.integrations || []);
      setDriveHasCredentials(!!status.hasCredentials);
      if (status.pendingOAuth) {
        setDrivePendingId(status.pendingOAuth.id);
      }
      if (status.pendingOAuth?.googleClientId) {
        setDriveCreds((p) => ({ ...p, googleClientId: status.pendingOAuth.googleClientId }));
      }
      if (status.integrations?.length > 0) {
        const logData = await api.drive.getImportLogs();
        setDriveImportLogs(logData.logs || []);
      }
    } catch (err) {
      console.error('Failed to load Drive status:', err);
    } finally {
      setDriveLoading(false);
    }
  };

  const handleDriveSaveCredentials = async () => {
    if (!driveCreds.googleClientId || !driveCreds.googleClientSecret) {
      alert('Both Client ID and Client Secret are required.');
      return;
    }
    setDriveSavingCreds(true);
    try {
      await api.drive.saveCredentials(driveCreds);
      setDriveCreds((prev) => ({ ...prev, googleClientSecret: '' }));
      setDriveHasCredentials(true);
      await loadDriveStatus();
    } catch (err) {
      alert(err.message);
    } finally {
      setDriveSavingCreds(false);
    }
  };

  const handleDriveConnect = async () => {
    setDriveConnecting(true);
    try {
      const { url } = await api.drive.getAuthUrl();
      const popup = window.open(url, 'drive-oauth', 'width=600,height=700,scrollbars=yes');
      if (!popup) {
        window.location.href = url;
        return;
      }
      // Poll for completion
      const interval = setInterval(async () => {
        try {
          const status = await api.drive.getStatus();
          if (status.pendingOAuth?.email) {
            clearInterval(interval);
            setDrivePendingId(status.pendingOAuth.id);
            setDriveConnecting(false);
            setShowDriveFolderPicker(true);
          }
        } catch { /* keep polling */ }
      }, 2000);
      setTimeout(() => {
        clearInterval(interval);
        setDriveConnecting(false);
      }, 120000);
    } catch (err) {
      alert(err.message);
      setDriveConnecting(false);
    }
  };

  const handleDriveFolderSelected = async (folder) => {
    if (!drivePendingId) return;
    setDriveAddingFolder(true);
    try {
      await api.drive.addFolder({
        integrationId: drivePendingId,
        driveFolderId: folder.id,
        driveFolderName: folder.name,
      });
      setDrivePendingId(null);
      setShowDriveFolderPicker(false);
      await loadDriveStatus();
    } catch (err) {
      alert(err.message);
    } finally {
      setDriveAddingFolder(false);
    }
  };

  const handleDrivePoll = async (integrationId) => {
    setDrivePolling(integrationId);
    try {
      const result = await api.drive.poll(integrationId);
      alert(result.message || `Processed: ${result.processed}, Imported: ${result.imported}, Duplicates: ${result.duplicates}`);
      await loadDriveStatus();
    } catch (err) {
      alert(err.message);
    } finally {
      setDrivePolling(null);
    }
  };

  const handleDriveDisconnect = async (integrationId, folderName) => {
    if (!confirm(`Remove "${folderName}"? This will stop polling this folder and remove the connection.`)) return;
    setDriveDisconnecting(integrationId);
    try {
      await api.drive.disconnect(integrationId);
      await loadDriveStatus();
    } catch (err) {
      alert(err.message);
    } finally {
      setDriveDisconnecting(null);
    }
  };

  // ── Shopify handlers ──

  const loadShopifyStatus = async () => {
    try {
      const status = await api.shopify.getStatus();
      setShopifyStatus(status);
      if (status.connected) {
        const logData = await api.shopify.getImportLogs();
        setShopifyImportLogs(logData.logs || []);
      }
    } catch (err) {
      // Plan-gated — 403 means feature not available (gracefully hide)
      if (err.message?.includes('403') || err.message?.includes('requires')) {
        setShopifyStatus({ unavailable: true });
      } else {
        console.error('Failed to load Shopify status:', err);
      }
    }
  };

  const handleShopifyConnect = async () => {
    if (!shopifyShop.trim()) {
      alert('Enter your Shopify shop domain.');
      return;
    }
    setShopifyConnecting(true);
    try {
      const { url } = await api.shopify.getAuthUrl(shopifyShop.trim());
      // Full-page redirect to Shopify consent screen
      window.location.href = url;
    } catch (err) {
      alert(err.message);
      setShopifyConnecting(false);
    }
  };

  const handleShopifySync = async () => {
    setShopifySyncing(true);
    try {
      const result = await api.shopify.sync();
      // Auto-match variants after sync
      const matchResult = await api.shopify.matchVariants();
      alert(
        `Synced: ${result.productsCreated} created, ${result.productsUpdated} updated, ${result.variantsCreated} variants.\n` +
        `Matched: ${matchResult.matched?.length || 0} variants linked, ${matchResult.unmatched?.length || 0} unmatched.`
      );
      setShopifyMatchResult(matchResult);
      await loadShopifyStatus();
    } catch (err) {
      alert(err.message);
    } finally {
      setShopifySyncing(false);
    }
  };

  const handleShopifyOrderSync = async () => {
    setShopifyOrderSyncing(true);
    try {
      const result = await api.shopify.syncOrders();
      alert(
        result.message ||
          `Orders synced: ${result.ordersCreated} new, ${result.ordersUpdated} updated`
      );
      await loadShopifyStatus();
      // Reload orders list
      const ordersData = await api.shopify.getOrders({ page: 1 });
      setShopifyOrders(ordersData.orders || []);
      setShopifyOrdersTotal(ordersData.pagination?.total || 0);
      setShopifyOrdersPage(1);
    } catch (err) {
      alert(err.message);
    } finally {
      setShopifyOrderSyncing(false);
    }
  };

  const loadShopifyOrders = async (page = 1) => {
    try {
      const data = await api.shopify.getOrders({ page, limit: 20 });
      setShopifyOrders(data.orders || []);
      setShopifyOrdersTotal(data.pagination?.total || 0);
      setShopifyOrdersPage(page);
      setShopifyOrdersLoaded(true);
    } catch (err) {
      console.error('Failed to load Shopify orders:', err);
    }
  };

  const handleShopifyTabChange = async (tab) => {
    setShopifyActiveTab(tab);
    if (tab === 'orders' && !shopifyOrdersLoaded) {
      await loadShopifyOrders(1);
    }
  };

  const handlePushPricesToggle = async (checked) => {
    try {
      await api.shopify.updateSettings({ pushPricesOnExport: checked });
      setShopifyStatus((prev) => ({ ...prev, pushPricesOnExport: checked }));
    } catch (err) {
      alert(err.message);
    }
  };

  // ── Shopify variant matching handlers ──

  const handleShopifyAutoMatch = async () => {
    setShopifyMatching(true);
    try {
      const result = await api.shopify.matchVariants();
      setShopifyMatchResult(result);
    } catch (err) {
      alert(err.message);
    } finally {
      setShopifyMatching(false);
    }
  };

  const handleShopifyLink = async (shopifyVariant, localVariant) => {
    setShopifyLinking(shopifyVariant.shopifyVariantId);
    try {
      await api.shopify.linkVariant({
        shopifyVariantId: shopifyVariant.shopifyVariantId,
        shopifyProductId: shopifyVariant.shopifyProductId,
        localVariantId: localVariant.variantId,
      });
      setShopifyMatchResult((prev) => ({
        ...prev,
        matched: [...(prev.matched || []), {
          ...shopifyVariant,
          shopifyTitle: shopifyVariant.title,
          localVariantName: localVariant.name,
          localSku: localVariant.sku,
          matchMethod: 'manual',
        }],
        unmatched: (prev.unmatched || []).filter(
          (u) => u.shopifyVariantId !== shopifyVariant.shopifyVariantId
        ),
      }));
      setShopifySearchingFor(null);
      setShopifySearchQuery('');
      setShopifySearchResults([]);
    } catch (err) {
      alert(err.message);
    } finally {
      setShopifyLinking(null);
    }
  };

  const handleShopifyDismiss = async (shopifyVariantId) => {
    try {
      await api.shopify.dismissVariant(shopifyVariantId);
      setShopifyMatchResult((prev) => ({
        ...prev,
        unmatched: (prev.unmatched || []).filter((u) => u.shopifyVariantId !== shopifyVariantId),
        dismissed: (prev.dismissed || 0) + 1,
      }));
    } catch (err) {
      alert(err.message);
    }
  };

  const handleShopifyVariantSearch = async (query) => {
    setShopifySearchQuery(query);
    if (query.length < 2) {
      setShopifySearchResults([]);
      return;
    }
    try {
      const results = await api.searchProducts(query);
      const flattened = [];
      for (const product of results) {
        for (const variant of (product.variants || [])) {
          flattened.push({
            variantId: variant.id,
            productId: product.id,
            name: variant.name || product.name,
            sku: variant.sku,
            storeName: variant.store?.name,
          });
        }
      }
      setShopifySearchResults(flattened);
    } catch (err) {
      console.error('Search failed:', err);
    }
  };

  const handleShopifyDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect Shopify? Your synced products will be preserved.')) return;
    try {
      await api.shopify.disconnect();
      setShopifyStatus({ connected: false });
      setShopifyImportLogs([]);
      setShopifyShop('');
      setShopifyOrders([]);
      setShopifyOrdersLoaded(false);
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-400">Loading integrations...</div>;
  }

  const statusBadge = {
    imported: 'bg-emerald-100 text-emerald-700',
    duplicate: 'bg-amber-100 text-amber-700',
    failed: 'bg-red-100 text-red-700',
    skipped: 'bg-gray-100 text-gray-500',
  };

  return (
    <div className="space-y-6">
      {/* Gmail Integration Card */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-5 border-b border-gray-100 flex items-center gap-3">
          {/* Gmail icon */}
          <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-red-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">Gmail Integration</h3>
            <p className="text-sm text-gray-500">Auto-import invoices from your Gmail inbox</p>
          </div>
          {gmailStatus?.connected && (
            <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
              Connected
            </span>
          )}
          {!gmailStatus?.connected && gmailStatus?.hasCredentials && (
            <span className="px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
              Credentials Saved
            </span>
          )}
        </div>

        <div className="p-5">
          {!gmailStatus?.connected ? (
            /* Not connected state — two-step setup */
            <div className="space-y-6">
              {/* Feature overview */}
              <div className="text-center space-y-2">
                <p className="text-sm text-gray-600">
                  Connect your Gmail account to automatically import invoices from supplier emails.
                </p>
                <ul className="text-sm text-gray-500 space-y-1">
                  <li>Auto-detect PDF and image attachments</li>
                  <li>Filter by sender whitelist or Gmail labels</li>
                  <li>3-layer duplicate detection prevents re-imports</li>
                </ul>
              </div>

              {/* Step 1: Google Cloud Credentials */}
              <div className="space-y-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center gap-2">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    gmailStatus?.hasCredentials
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-brand-100 text-brand-700'
                  }`}>
                    {gmailStatus?.hasCredentials ? '✓' : '1'}
                  </span>
                  <h4 className="text-sm font-medium text-gray-900">Google Cloud Credentials</h4>
                </div>

                <p className="text-xs text-gray-500 ml-8">
                  Create an OAuth 2.0 Client in your{' '}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-600 underline"
                  >
                    Google Cloud Console
                  </a>{' '}
                  and paste the credentials below. Set the redirect URI to:{' '}
                  <code className="text-xs bg-gray-200 px-1 py-0.5 rounded">
                    {window.location.origin.replace(/:\d+$/, ':3001')}/api/gmail/oauth/callback
                  </code>
                </p>

                <div className="ml-8 mt-2 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-brand-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                  </svg>
                  <a
                    href="/gmail-setup-guide.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-brand-600 font-medium hover:underline"
                  >
                    Need help? Follow our step-by-step setup guide &rarr;
                  </a>
                </div>

                <div className="ml-8 space-y-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Client ID</label>
                    <input
                      type="text"
                      value={creds.googleClientId}
                      onChange={(e) => setCreds((p) => ({ ...p, googleClientId: e.target.value }))}
                      placeholder="123456789.apps.googleusercontent.com"
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Client Secret</label>
                    <input
                      type="password"
                      value={creds.googleClientSecret}
                      onChange={(e) => setCreds((p) => ({ ...p, googleClientSecret: e.target.value }))}
                      placeholder={gmailStatus?.hasCredentials ? '••••••• (saved)' : 'GOCSPX-...'}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-mono"
                    />
                  </div>
                  <button
                    onClick={handleSaveCredentials}
                    disabled={savingCreds || (!creds.googleClientId && !creds.googleClientSecret)}
                    className="px-4 py-1.5 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-50 transition"
                  >
                    {savingCreds ? 'Saving...' : gmailStatus?.hasCredentials ? 'Update Credentials' : 'Save Credentials'}
                  </button>
                </div>
              </div>

              {/* Step 2: Connect Gmail */}
              <div className={`space-y-3 p-4 rounded-lg border ${
                gmailStatus?.hasCredentials
                  ? 'bg-gray-50 border-gray-200'
                  : 'bg-gray-50/50 border-gray-100'
              }`}>
                <div className="flex items-center gap-2">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    gmailStatus?.hasCredentials
                      ? 'bg-brand-100 text-brand-700'
                      : 'bg-gray-100 text-gray-400'
                  }`}>
                    2
                  </span>
                  <h4 className={`text-sm font-medium ${gmailStatus?.hasCredentials ? 'text-gray-900' : 'text-gray-400'}`}>
                    Connect Gmail Account
                  </h4>
                </div>

                <div className="ml-8">
                  <button
                    onClick={handleConnect}
                    disabled={!gmailStatus?.hasCredentials}
                    className="px-6 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    Connect Gmail
                  </button>
                  {!gmailStatus?.hasCredentials && (
                    <p className="text-xs text-gray-400 mt-2">Save your Google Cloud credentials first</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Connected state */
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-900">{gmailStatus.integration.email}</div>
                  <div className="text-xs text-gray-500">
                    Last polled: {gmailStatus.integration.lastPollAt
                      ? new Date(gmailStatus.integration.lastPollAt).toLocaleString()
                      : 'Never'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handlePoll}
                    disabled={polling}
                    className="px-3 py-1.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                  >
                    {polling ? 'Polling...' : 'Poll Now'}
                  </button>
                  <button
                    onClick={handleDisconnect}
                    className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50"
                  >
                    Disconnect
                  </button>
                </div>
              </div>

              {/* Import stats */}
              {gmailStatus.integration.stats && (
                <div className="flex gap-4">
                  {Object.entries(gmailStatus.integration.stats).map(([status, count]) => (
                    <div key={status} className="text-center">
                      <div className="text-lg font-bold text-gray-900">{count}</div>
                      <div className="text-xs text-gray-500 capitalize">{status}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Configuration */}
              <div className="space-y-4 pt-4 border-t border-gray-100">
                <h4 className="text-sm font-medium text-gray-700">Filters & Configuration</h4>

                {/* Sender whitelist */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Sender Whitelist</label>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={whitelistInput}
                      onChange={(e) => setWhitelistInput(e.target.value)}
                      placeholder="supplier@example.com"
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                      onKeyDown={(e) => e.key === 'Enter' && addToWhitelist()}
                    />
                    <button onClick={addToWhitelist} className="px-3 py-1.5 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">
                      Add
                    </button>
                  </div>
                  {config.senderWhitelist.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {config.senderWhitelist.map((email) => (
                        <span key={email} className="px-2 py-0.5 bg-gray-100 rounded text-xs flex items-center gap-1">
                          {email}
                          <button onClick={() => removeFromWhitelist(email)} className="text-gray-400 hover:text-red-500">&times;</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-gray-400 mt-1">Leave empty to import from all senders</p>
                </div>

                {/* Label filter */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Gmail Label</label>
                  <input
                    type="text"
                    value={config.labelFilter}
                    onChange={(e) => setConfig((p) => ({ ...p, labelFilter: e.target.value }))}
                    placeholder="e.g. Invoices"
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                  />
                </div>

                {/* Poll interval */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Poll Interval</label>
                  <PollIntervalInput
                    value={config.pollIntervalMin}
                    onChange={(val) => setConfig((p) => ({ ...p, pollIntervalMin: val }))}
                  />
                </div>

                {/* Initial lookback window */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Initial Lookback</label>
                  <select
                    value={config.initialLookbackDays}
                    onChange={(e) => setConfig((p) => ({ ...p, initialLookbackDays: Number(e.target.value) }))}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value={1}>1 day</option>
                    <option value={3}>3 days</option>
                    <option value={7}>7 days</option>
                    <option value={14}>14 days</option>
                    <option value={30}>30 days</option>
                    <option value={60}>60 days</option>
                    <option value={90}>90 days</option>
                  </select>
                  <p className="text-xs text-gray-400 mt-1">How far back to search on the first poll</p>
                </div>

                <button
                  onClick={handleSaveConfig}
                  disabled={configuring}
                  className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  {configuring ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Gmail Import History */}
      {gmailStatus?.connected && importLogs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-5 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Gmail Import History</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-left text-xs font-medium text-gray-500 uppercase">
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Sender</th>
                <th className="px-5 py-3">File</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {importLogs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-gray-700">{log.senderEmail}</td>
                  <td className="px-5 py-3 text-gray-700">{log.attachmentName}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusBadge[log.status] || 'bg-gray-100 text-gray-500'}`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {log.duplicateReason || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* Folder Polling Integration Card                                */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-5 border-b border-gray-100 flex items-center gap-3">
          {/* Folder icon */}
          <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">Folder Polling</h3>
            <p className="text-sm text-gray-500">Auto-import invoices from a local or network folder</p>
          </div>
          {folderStatus?.connected && (
            <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
              Connected
            </span>
          )}
        </div>

        <div className="p-5">
          {!folderStatus?.connected ? (
            /* ── Not connected state ── */
            <div className="space-y-6">
              {/* Feature overview */}
              <div className="text-center space-y-2">
                <p className="text-sm text-gray-600">
                  Point to a local folder or network share to automatically import invoice files.
                </p>
                <ul className="text-sm text-gray-500 space-y-1">
                  <li>Auto-detect PDF and image files (JPG, PNG, WebP)</li>
                  <li>Files moved to a &quot;Processed&quot; subfolder after import</li>
                  <li>3-layer duplicate detection prevents re-imports</li>
                  <li>Configurable polling schedule</li>
                </ul>
              </div>

              {/* Setup form */}
              <div className="space-y-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                {/* Folder path */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Folder Path</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={folderConfig.folderPath}
                      onChange={(e) => setFolderConfig((p) => ({ ...p, folderPath: e.target.value }))}
                      placeholder="C:\Invoices  or  \\server\share\Invoices"
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowFolderBrowser(true)}
                      className="px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                      title="Browse folders"
                    >
                      <svg className="w-4.5 h-4.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Enter the full path to a folder the server can access. Local paths and UNC network paths are supported.
                  </p>
                  <FolderBrowser
                    isOpen={showFolderBrowser}
                    onClose={() => setShowFolderBrowser(false)}
                    onSelect={(path) => setFolderConfig((p) => ({ ...p, folderPath: path }))}
                    initialPath={folderConfig.folderPath || null}
                  />
                </div>

                {/* File patterns */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">File Patterns</label>
                  <p className="text-xs text-gray-500 mb-2">To add a new file pattern, type *.extension (e.g. *.jpeg, *.tiff) and click Add</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={patternInput}
                      onChange={(e) => setPatternInput(e.target.value)}
                      placeholder="*.pdf"
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                      onKeyDown={(e) => e.key === 'Enter' && addPattern()}
                    />
                    <button onClick={addPattern} className="px-3 py-1.5 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">
                      Add
                    </button>
                  </div>
                  {folderConfig.filePatterns.length > 0 && (
                    <div className="mt-2">
                      <span className="text-xs text-gray-500 mb-1 block">Active patterns:</span>
                      <div className="flex flex-wrap gap-1.5">
                        {folderConfig.filePatterns.map((p) => (
                          <span key={p} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs flex items-center gap-1">
                            {p}
                            <button onClick={() => removePattern(p)} className="text-blue-400 hover:text-red-500">&times;</button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Poll interval */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Poll Interval</label>
                  <PollIntervalInput
                    value={folderConfig.pollIntervalMin}
                    onChange={(val) => setFolderConfig((p) => ({ ...p, pollIntervalMin: val }))}
                  />
                  <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    The folder will be scanned immediately when you save, then on the schedule above.
                  </p>
                </div>

                {/* Test connection */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleFolderTestConnection}
                    disabled={folderTesting || !folderConfig.folderPath.trim()}
                    className="px-4 py-1.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-100 disabled:opacity-50 transition"
                  >
                    {folderTesting ? 'Testing...' : 'Test Connection'}
                  </button>

                  {folderTestResult && (
                    <span className={`text-xs font-medium ${folderTestResult.success ? 'text-emerald-600' : 'text-red-600'}`}>
                      {folderTestResult.success
                        ? folderTestResult.message
                        : folderTestResult.error}
                    </span>
                  )}
                </div>

                {/* Save & Enable */}
                <button
                  onClick={handleFolderSave}
                  disabled={folderSaving || !folderConfig.folderPath.trim() || !folderTestResult?.success}
                  className="px-6 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {folderSaving ? 'Saving...' : 'Save & Enable'}
                </button>

                {!folderTestResult?.success && folderConfig.folderPath.trim() && (
                  <p className="text-xs text-gray-400">Test the connection before saving</p>
                )}
              </div>
            </div>
          ) : (
            /* ── Connected state ── */
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-900 font-mono">{folderStatus.integration.folderPath}</div>
                  <div className="text-xs text-gray-500">
                    Last polled: {folderStatus.integration.lastPollAt
                      ? new Date(folderStatus.integration.lastPollAt).toLocaleString()
                      : 'Never'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleFolderPoll}
                    disabled={folderPolling}
                    className="px-3 py-1.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                  >
                    {folderPolling ? 'Polling...' : 'Poll Now'}
                  </button>
                  <button
                    onClick={handleFolderDisconnect}
                    className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50"
                  >
                    Disconnect
                  </button>
                </div>
              </div>

              {/* Import stats */}
              {folderStatus.integration.stats && (
                <div className="flex gap-4">
                  {Object.entries(folderStatus.integration.stats).map(([status, count]) => (
                    <div key={status} className="text-center">
                      <div className="text-lg font-bold text-gray-900">{count}</div>
                      <div className="text-xs text-gray-500 capitalize">{status}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Configuration */}
              <div className="space-y-4 pt-4 border-t border-gray-100">
                <h4 className="text-sm font-medium text-gray-700">Configuration</h4>

                {/* File patterns */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">File Patterns</label>
                  <p className="text-xs text-gray-500 mb-2">To add a new file pattern, type *.extension (e.g. *.jpeg, *.tiff) and click Add</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={patternInput}
                      onChange={(e) => setPatternInput(e.target.value)}
                      placeholder="*.pdf"
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                      onKeyDown={(e) => e.key === 'Enter' && addPattern()}
                    />
                    <button onClick={addPattern} className="px-3 py-1.5 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">
                      Add
                    </button>
                  </div>
                  {folderConfig.filePatterns.length > 0 && (
                    <div className="mt-2">
                      <span className="text-xs text-gray-500 mb-1 block">Active patterns:</span>
                      <div className="flex flex-wrap gap-1.5">
                        {folderConfig.filePatterns.map((p) => (
                          <span key={p} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs flex items-center gap-1">
                            {p}
                            <button onClick={() => removePattern(p)} className="text-blue-400 hover:text-red-500">&times;</button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Poll interval */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Poll Interval</label>
                  <PollIntervalInput
                    value={folderConfig.pollIntervalMin}
                    onChange={(val) => setFolderConfig((p) => ({ ...p, pollIntervalMin: val }))}
                  />
                </div>

                <button
                  onClick={handleFolderSaveConfig}
                  disabled={folderConfiguring}
                  className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  {folderConfiguring ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Folder Import History */}
      {folderStatus?.connected && folderImportLogs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-5 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Folder Import History</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-left text-xs font-medium text-gray-500 uppercase">
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">File</th>
                <th className="px-5 py-3">Size</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {folderImportLogs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-gray-700">{log.fileName}</td>
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {log.fileSize >= 1024 * 1024
                      ? `${(log.fileSize / 1024 / 1024).toFixed(1)} MB`
                      : `${Math.round(log.fileSize / 1024)} KB`}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusBadge[log.status] || 'bg-gray-100 text-gray-500'}`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {log.duplicateReason || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* Google Drive Integration Card                                   */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-5 border-b border-gray-100 flex items-center gap-3">
          {/* Drive cloud icon */}
          <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">Google Drive</h3>
            <p className="text-sm text-gray-500">Auto-import invoices from Google Drive folders</p>
          </div>
          {driveIntegrations.length > 0 && (
            <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
              {driveIntegrations.length} folder{driveIntegrations.length !== 1 ? 's' : ''} connected
            </span>
          )}
        </div>

        <div className="p-5">
          {driveLoading ? (
            <div className="text-center py-6 text-gray-400 text-sm">Loading Google Drive status...</div>
          ) : driveIntegrations.length === 0 ? (
            /* ── Not connected state ── */
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <p className="text-sm text-gray-600">
                  Connect Google Drive to automatically import invoice files from a watched folder.
                </p>
                <ul className="text-sm text-gray-500 space-y-1">
                  <li>PDF, JPG, PNG, WebP files auto-detected</li>
                  <li>3-layer duplicate detection</li>
                  <li>Read-only access &mdash; your files are never modified</li>
                  <li>Watch multiple folders across accounts</li>
                </ul>
              </div>

              {/* Step 1: Google Cloud Credentials */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-5 h-5 bg-teal-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</span>
                  <span className="text-sm font-semibold text-gray-700">Google Cloud Credentials</span>
                </div>
                {driveHasCredentials ? (
                  <div className="flex items-center gap-2 text-sm text-green-700">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    Credentials saved
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Client ID</label>
                      <input
                        type="text"
                        value={driveCreds.googleClientId}
                        onChange={(e) => setDriveCreds((p) => ({ ...p, googleClientId: e.target.value }))}
                        placeholder="123456789.apps.googleusercontent.com"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Client Secret</label>
                      <input
                        type="password"
                        value={driveCreds.googleClientSecret}
                        onChange={(e) => setDriveCreds((p) => ({ ...p, googleClientSecret: e.target.value }))}
                        placeholder="GOCSPX-..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <a
                        href="/drive-setup-guide.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-teal-600 hover:text-teal-700 underline"
                      >
                        View setup guide
                      </a>
                      <button
                        onClick={handleDriveSaveCredentials}
                        disabled={driveSavingCreds || !driveCreds.googleClientId || !driveCreds.googleClientSecret}
                        className="px-4 py-1.5 bg-teal-600 text-white rounded-lg text-xs font-medium hover:bg-teal-700 transition disabled:opacity-50"
                      >
                        {driveSavingCreds ? 'Saving...' : 'Save Credentials'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Step 2: Connect (only shown after credentials saved) */}
              {driveHasCredentials && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-5 h-5 bg-teal-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</span>
                    <span className="text-sm font-semibold text-gray-700">Connect Google Account</span>
                  </div>
                  <div className="flex justify-center">
                    <button
                      onClick={handleDriveConnect}
                      disabled={driveConnecting}
                      className="px-5 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition disabled:opacity-50 flex items-center gap-2"
                    >
                      {driveConnecting ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Waiting for Google...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                          </svg>
                          Connect Google Drive
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ── Connected state ── */
            <div className="space-y-4">
              {/* Connected folders list */}
              {driveIntegrations.map((int) => (
                <div key={int.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{int.driveFolderName || 'Google Drive Folder'}</p>
                      <p className="text-xs text-gray-500">{int.email || 'Google Account'}</p>
                      {int.lastPollAt && (
                        <p className="text-xs text-gray-400">Last polled: {new Date(int.lastPollAt).toLocaleString()}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDrivePoll(int.id)}
                      disabled={drivePolling === int.id}
                      className="px-3 py-1.5 bg-brand-50 text-brand-700 rounded-lg text-xs font-medium hover:bg-brand-100 transition disabled:opacity-50"
                    >
                      {drivePolling === int.id ? 'Polling...' : 'Poll Now'}
                    </button>
                    <button
                      onClick={() => handleDriveDisconnect(int.id, int.driveFolderName || 'this folder')}
                      disabled={driveDisconnecting === int.id}
                      className="px-3 py-1.5 text-red-500 hover:text-red-700 text-xs font-medium disabled:opacity-50"
                    >
                      {driveDisconnecting === int.id ? 'Removing...' : 'Remove'}
                    </button>
                  </div>
                </div>
              ))}

              {/* Add another folder */}
              <div className="flex justify-center pt-2">
                <button
                  onClick={handleDriveConnect}
                  disabled={driveConnecting}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition disabled:opacity-50 flex items-center gap-2"
                >
                  {driveConnecting ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Connecting...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      Add Another Folder
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Drive folder picker modal */}
      <DriveFolderPicker
        isOpen={showDriveFolderPicker}
        onClose={() => setShowDriveFolderPicker(false)}
        onSelect={handleDriveFolderSelected}
        integrationId={drivePendingId}
      />

      {/* Drive import log table */}
      {driveImportLogs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h4 className="text-sm font-semibold text-gray-700">Google Drive Import History</h4>
          </div>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">File</th>
                <th className="px-5 py-3">Size</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {driveImportLogs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-gray-700">{log.fileName}</td>
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {log.fileSize >= 1024 * 1024
                      ? `${(log.fileSize / 1024 / 1024).toFixed(1)} MB`
                      : `${Math.round(log.fileSize / 1024)} KB`}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      log.status === 'imported' ? 'bg-green-100 text-green-700' :
                      log.status === 'duplicate' ? 'bg-amber-100 text-amber-700' :
                      log.status === 'failed' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-500'
                    }`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {log.duplicateReason || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* Shopify Integration Card                                       */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {!shopifyStatus?.unavailable && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-5 border-b border-gray-100 flex items-center gap-3">
            {/* Shopify bag icon */}
            <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-green-600" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.337 3.415c-.15-.082-.337-.012-.382.158l-.547 2.356c-.265 0-.537.032-.818.084a4.6 4.6 0 00-.932-1.64c-.517-.554-1.227-.834-2.1-.834-3.18 0-4.726 3.97-5.2 5.987L3.2 10.23c-.468.146-.483.16-.546.604L.96 22.45l11.68 2.063L21 22.572c0 0-3.885-17.86-3.905-17.97-.02-.11-.065-.158-.16-.197-.094-.038-1.593-.99-1.598-.99z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900">Shopify Integration</h3>
              <p className="text-sm text-gray-500">Sync products from your Shopify store</p>
            </div>
            {shopifyStatus?.connected && (
              <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
                Connected
              </span>
            )}
          </div>

          <div className="p-5">
            {!shopifyStatus?.connected ? (
              /* ── Not connected state ── */
              <div className="space-y-6">
                {/* Feature overview */}
                <div className="text-center space-y-2">
                  <p className="text-sm text-gray-600">
                    Connect your Shopify store to automatically sync products and pricing.
                  </p>
                  <ul className="text-sm text-gray-500 space-y-1">
                    <li>One-click OAuth connection — no API keys needed</li>
                    <li>Sync products, variants, and pricing from Shopify</li>
                    <li>Push price updates back to Shopify on export</li>
                  </ul>
                </div>

                {/* Connect form */}
                <div className="space-y-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Shopify Store Name</label>
                    <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden bg-white focus-within:ring-1 focus-within:ring-teal-500 focus-within:border-teal-500">
                      <input
                        type="text"
                        value={shopifyShop}
                        onChange={(e) => setShopifyShop(e.target.value)}
                        placeholder="your-store-name"
                        className="flex-1 px-3 py-1.5 text-sm font-mono border-none outline-none bg-transparent"
                        onKeyDown={(e) => e.key === 'Enter' && handleShopifyConnect()}
                      />
                      <span className="px-3 py-1.5 text-sm text-gray-400 bg-gray-50 border-l border-gray-300 shrink-0">.myshopify.com</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Find this in your Shopify admin URL: <span className="font-mono">your-store-name.myshopify.com</span>. Not your custom domain.
                    </p>
                  </div>

                  <button
                    onClick={handleShopifyConnect}
                    disabled={shopifyConnecting || !shopifyShop.trim()}
                    className="px-6 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    {shopifyConnecting ? 'Redirecting to Shopify...' : 'Connect Shopify'}
                  </button>
                </div>
              </div>
            ) : (
              /* ── Connected state ── */
              <div className="space-y-5">
                {/* Header row: shop info + action buttons */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{shopifyStatus.shop}</div>
                    <div className="text-xs text-gray-500">
                      Connected {shopifyStatus.connectedAt ? new Date(shopifyStatus.connectedAt).toLocaleDateString() : ''}
                      {shopifyStatus.isActive ? (
                        <span className="ml-2 text-emerald-600">· Active</span>
                      ) : (
                        <span className="ml-2 text-amber-600">· Paused</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={handleShopifyDisconnect}
                    className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50"
                  >
                    Disconnect
                  </button>
                </div>

                {/* Sync stats */}
                <div className="flex gap-6">
                  <div className="text-center">
                    <div className="text-lg font-bold text-gray-900">{shopifyStatus.productCount || 0}</div>
                    <div className="text-xs text-gray-500">Products</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-gray-900">{shopifyStatus.orderCount || 0}</div>
                    <div className="text-xs text-gray-500">Orders</div>
                  </div>
                </div>

                {/* Push prices toggle */}
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div>
                    <div className="text-sm font-medium text-gray-800">Push prices to Shopify on export</div>
                    <div className="text-xs text-gray-500">
                      When you export an invoice, updated cost and sale prices are pushed to matched Shopify variants
                    </div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={shopifyStatus.pushPricesOnExport}
                    onClick={() => handlePushPricesToggle(!shopifyStatus.pushPricesOnExport)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                      shopifyStatus.pushPricesOnExport ? 'bg-green-600' : 'bg-gray-300'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      shopifyStatus.pushPricesOnExport ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>

                {/* Tabs: Products | Orders */}
                <div className="border-b border-gray-200">
                  <div className="flex gap-4">
                    {['products', 'orders', 'match'].map((tab) => (
                      <button
                        key={tab}
                        onClick={() => handleShopifyTabChange(tab)}
                        className={`pb-2 text-sm font-medium capitalize border-b-2 transition-colors ${
                          shopifyActiveTab === tab
                            ? 'border-green-600 text-green-700'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Products tab */}
                {shopifyActiveTab === 'products' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-500">
                        Last product sync: {shopifyStatus.lastSyncAt
                          ? new Date(shopifyStatus.lastSyncAt).toLocaleString()
                          : 'Never'}
                      </div>
                      <button
                        onClick={handleShopifySync}
                        disabled={shopifySyncing}
                        className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                      >
                        {shopifySyncing ? 'Syncing & Matching...' : 'Sync & Match Products'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Orders tab */}
                {shopifyActiveTab === 'orders' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-500">
                        Last order sync: {shopifyStatus.lastOrderSyncAt
                          ? new Date(shopifyStatus.lastOrderSyncAt).toLocaleString()
                          : 'Never'}
                      </div>
                      <button
                        onClick={handleShopifyOrderSync}
                        disabled={shopifyOrderSyncing}
                        className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                      >
                        {shopifyOrderSyncing ? 'Syncing...' : 'Sync Orders'}
                      </button>
                    </div>

                    {shopifyOrders.length > 0 ? (
                      <>
                        <div className="overflow-x-auto rounded-lg border border-gray-200">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 border-b border-gray-100">
                              <tr className="text-left text-xs font-medium text-gray-500 uppercase">
                                <th className="px-4 py-2">Order</th>
                                <th className="px-4 py-2">Customer</th>
                                <th className="px-4 py-2">Date</th>
                                <th className="px-4 py-2">Items</th>
                                <th className="px-4 py-2 text-right">Total</th>
                                <th className="px-4 py-2">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {shopifyOrders.map((order) => (
                                <tr key={order.shopifyOrderId} className="hover:bg-gray-50">
                                  <td className="px-4 py-2 font-mono text-xs text-gray-700">#{order.orderNumber}</td>
                                  <td className="px-4 py-2 text-gray-700">
                                    {order.customerName || order.customerEmail || <span className="text-gray-400">Guest</span>}
                                  </td>
                                  <td className="px-4 py-2 text-xs text-gray-500">
                                    {new Date(order.orderedAt).toLocaleDateString()}
                                  </td>
                                  <td className="px-4 py-2 text-gray-600">{order.lines?.length || 0}</td>
                                  <td className="px-4 py-2 text-right font-medium text-gray-800">
                                    {order.currency} ${parseFloat(order.totalPrice).toFixed(2)}
                                  </td>
                                  <td className="px-4 py-2">
                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                      order.financialStatus === 'paid' ? 'bg-emerald-100 text-emerald-700' :
                                      order.financialStatus === 'pending' ? 'bg-amber-100 text-amber-700' :
                                      'bg-gray-100 text-gray-600'
                                    }`}>
                                      {order.financialStatus || 'unknown'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {/* Pagination */}
                        {shopifyOrdersTotal > 20 && (
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            <span>{shopifyOrdersTotal} total orders</span>
                            <div className="flex gap-2">
                              <button
                                onClick={() => loadShopifyOrders(shopifyOrdersPage - 1)}
                                disabled={shopifyOrdersPage <= 1}
                                className="px-2 py-1 border rounded disabled:opacity-40"
                              >
                                Previous
                              </button>
                              <span>Page {shopifyOrdersPage} of {Math.ceil(shopifyOrdersTotal / 20)}</span>
                              <button
                                onClick={() => loadShopifyOrders(shopifyOrdersPage + 1)}
                                disabled={shopifyOrdersPage >= Math.ceil(shopifyOrdersTotal / 20)}
                                className="px-2 py-1 border rounded disabled:opacity-40"
                              >
                                Next
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-center py-8 text-gray-400 text-sm">
                        {shopifyOrdersLoaded
                          ? 'No orders synced yet. Click "Sync Orders" to pull orders from Shopify.'
                          : 'Loading orders...'}
                      </div>
                    )}
                  </div>
                )}

                {/* Match Products tab */}
                {shopifyActiveTab === 'match' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-gray-800">Link Shopify variants to local products</div>
                        <div className="text-xs text-gray-500">Match by SKU, barcode, or product name</div>
                      </div>
                      <button
                        onClick={handleShopifyAutoMatch}
                        disabled={shopifyMatching}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                      >
                        {shopifyMatching ? 'Matching...' : 'Auto-Match Products'}
                      </button>
                    </div>

                    {shopifyMatchResult && (
                      <>
                        <div className="flex gap-3">
                          <div className="flex-1 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-center">
                            <div className="text-lg font-bold text-emerald-700">{shopifyMatchResult.matched?.length || 0}</div>
                            <div className="text-xs text-emerald-600">Matched</div>
                          </div>
                          <div className="flex-1 p-3 bg-amber-50 border border-amber-200 rounded-lg text-center">
                            <div className="text-lg font-bold text-amber-700">{shopifyMatchResult.unmatched?.length || 0}</div>
                            <div className="text-xs text-amber-600">Unmatched</div>
                          </div>
                          <div className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-lg text-center">
                            <div className="text-lg font-bold text-gray-500">{shopifyMatchResult.dismissed || 0}</div>
                            <div className="text-xs text-gray-500">Dismissed</div>
                          </div>
                        </div>

                        {/* Unmatched list */}
                        {shopifyMatchResult.unmatched?.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="text-sm font-medium text-gray-700">
                              Unmatched Shopify Variants ({shopifyMatchResult.unmatched.length})
                            </h4>
                            <div className="space-y-2 max-h-96 overflow-y-auto">
                              {shopifyMatchResult.unmatched.map((sv) => (
                                <div key={sv.shopifyVariantId} className="p-3 border border-gray-200 rounded-lg bg-white">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-medium text-gray-900 truncate">
                                        {sv.title}
                                        {sv.variantTitle && <span className="text-gray-500"> — {sv.variantTitle}</span>}
                                      </div>
                                      <div className="flex gap-3 text-xs text-gray-500 mt-0.5">
                                        {sv.sku && <span>SKU: {sv.sku}</span>}
                                        {sv.barcode && <span>Barcode: {sv.barcode}</span>}
                                        {sv.price && <span>${sv.price}</span>}
                                      </div>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                      <button
                                        onClick={() => {
                                          setShopifySearchingFor(
                                            shopifySearchingFor?.shopifyVariantId === sv.shopifyVariantId ? null : sv
                                          );
                                          setShopifySearchQuery('');
                                          setShopifySearchResults([]);
                                        }}
                                        className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                                      >
                                        Link
                                      </button>
                                      <button
                                        onClick={() => handleShopifyDismiss(sv.shopifyVariantId)}
                                        className="px-2 py-1 text-xs bg-gray-50 text-gray-500 rounded hover:bg-gray-100"
                                      >
                                        Dismiss
                                      </button>
                                    </div>
                                  </div>

                                  {shopifySearchingFor?.shopifyVariantId === sv.shopifyVariantId && (
                                    <div className="mt-2 pt-2 border-t border-gray-100">
                                      <input
                                        type="text"
                                        placeholder="Search local products by name, SKU, or barcode..."
                                        value={shopifySearchQuery}
                                        onChange={(e) => handleShopifyVariantSearch(e.target.value)}
                                        className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                                        autoFocus
                                      />
                                      {shopifySearchResults.length > 0 && (
                                        <div className="mt-1 max-h-40 overflow-y-auto border border-gray-200 rounded">
                                          {shopifySearchResults.map((lr) => (
                                            <button
                                              key={lr.variantId}
                                              onClick={() => handleShopifyLink(sv, lr)}
                                              disabled={shopifyLinking === sv.shopifyVariantId}
                                              className="w-full text-left px-3 py-2 hover:bg-green-50 text-sm border-b border-gray-50 last:border-0"
                                            >
                                              <div className="font-medium text-gray-800">{lr.name}</div>
                                              <div className="text-xs text-gray-500">
                                                SKU: {lr.sku} {lr.storeName && `| Store: ${lr.storeName}`}
                                              </div>
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Matched list (collapsed by default) */}
                        {shopifyMatchResult.matched?.length > 0 && (
                          <details className="mt-2">
                            <summary className="text-sm font-medium text-gray-700 cursor-pointer">
                              Matched Variants ({shopifyMatchResult.matched.length})
                            </summary>
                            <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200">
                              <table className="w-full text-sm">
                                <thead className="bg-gray-50 border-b border-gray-100">
                                  <tr className="text-left text-xs font-medium text-gray-500 uppercase">
                                    <th className="px-3 py-2">Shopify Product</th>
                                    <th className="px-3 py-2">Local Variant</th>
                                    <th className="px-3 py-2">Method</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                  {shopifyMatchResult.matched.map((m) => (
                                    <tr key={m.shopifyVariantId} className="hover:bg-gray-50">
                                      <td className="px-3 py-2 text-gray-700">
                                        {m.shopifyTitle}
                                        {m.shopifyVariantTitle && ` — ${m.shopifyVariantTitle}`}
                                      </td>
                                      <td className="px-3 py-2 text-gray-700">{m.localVariantName}</td>
                                      <td className="px-3 py-2">
                                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                          m.matchMethod === 'sku' ? 'bg-blue-100 text-blue-700'
                                            : m.matchMethod === 'barcode' ? 'bg-purple-100 text-purple-700'
                                            : m.matchMethod === 'manual' ? 'bg-green-100 text-green-700'
                                            : 'bg-amber-100 text-amber-700'
                                        }`}>
                                          {m.matchMethod}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        )}
                      </>
                    )}

                    {!shopifyMatchResult && !shopifyMatching && (
                      <div className="text-center py-8 text-gray-400 text-sm">
                        Click &quot;Auto-Match Products&quot; to link Shopify variants to your existing local products.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Shopify Sync History */}
      {shopifyStatus?.connected && shopifyImportLogs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-5 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Shopify Sync History</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-left text-xs font-medium text-gray-500 uppercase">
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Pulled</th>
                <th className="px-5 py-3">Created</th>
                <th className="px-5 py-3">Updated</th>
                <th className="px-5 py-3">Variants</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {shopifyImportLogs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-gray-700">{log.productsPulled}</td>
                  <td className="px-5 py-3 text-gray-700">{log.productsCreated}</td>
                  <td className="px-5 py-3 text-gray-700">{log.productsUpdated}</td>
                  <td className="px-5 py-3 text-gray-700">{log.variantsCreated}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      log.status === 'success' ? 'bg-emerald-100 text-emerald-700' :
                      log.status === 'partial' ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {log.durationMs ? `${(log.durationMs / 1000).toFixed(1)}s` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
