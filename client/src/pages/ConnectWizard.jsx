import { useState, useEffect } from 'react';
import { api } from '../services/api';
import PollIntervalInput, { formatPollInterval } from '../components/ui/PollIntervalInput';
import FolderBrowser from '../components/ui/FolderBrowser';
import DriveFolderPicker from '../components/settings/DriveFolderPicker';

/* ═══════════════════════════════════════════════════════════════════
   SVG Icons
   ═══════════════════════════════════════════════════════════════════ */
const icons = {
  mail: (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
    </svg>
  ),
  folder: (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  ),
  check: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  ),
  arrow: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 8.25L21 12m0 0l-3.75 3.75M21 12H3" />
    </svg>
  ),
  back: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 15.75L3 12m0 0l3.75-3.75M3 12h18" />
    </svg>
  ),
  upload: (
    <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  ),
  shield: (
    <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  ),
  close: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  spinner: (
    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  ),
};

/* ═══════════════════════════════════════════════════════════════════
   Integration definitions
   ═══════════════════════════════════════════════════════════════════ */
const INTEGRATION_CATEGORIES = [
  {
    id: 'invoice-sources',
    title: 'Invoice Sources',
    subtitle: 'How invoices arrive into the system',
    integrations: [
      {
        id: 'gmail',
        name: 'Gmail',
        subtitle: 'Google Workspace',
        description: 'Auto-import invoices from supplier emails. AI detects PDF and image attachments.',
        iconBg: 'bg-red-50',
        iconColor: 'text-red-500',
        iconSvg: icons.mail,
        features: ['Auto-detect PDF & image attachments', 'Sender whitelist filtering', '3-layer duplicate detection', 'Gmail label filtering'],
      },
      {
        id: 'outlook',
        name: 'Outlook',
        subtitle: 'Microsoft 365',
        description: 'Auto-import invoices from your Outlook inbox via Microsoft Graph API.',
        iconBg: 'bg-blue-50',
        iconColor: 'text-blue-600',
        iconSvg: icons.mail,
        comingSoon: true,
        features: ['Outlook & Microsoft 365 inboxes', 'Folder-based filtering', 'Shared mailbox support', 'Azure AD authentication'],
      },
      {
        id: 'google-drive',
        name: 'Google Drive',
        subtitle: 'Cloud Storage',
        description: 'Auto-import invoices from a Google Drive folder. Server polls for new PDF and image files automatically.',
        iconBg: 'bg-green-50',
        iconColor: 'text-green-600',
        iconSvg: (
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
          </svg>
        ),
        features: ['PDF, JPG, PNG, WebP support', '3-layer duplicate detection', 'Multiple folder support', 'Watch shared Drive folders'],
      },
      {
        id: 'folder',
        name: 'Folder Watch',
        subtitle: 'Local or Network',
        description: 'Auto-import invoices from a local folder or network share. Files processed and moved automatically.',
        iconBg: 'bg-amber-50',
        iconColor: 'text-amber-600',
        iconSvg: icons.folder,
        features: ['PDF, JPG, PNG, WebP support', 'Files moved to Processed subfolder', 'Network share (UNC) support', 'Configurable poll interval'],
      },
    ],
  },
  {
    id: 'pos-systems',
    title: 'POS Systems',
    subtitle: 'Push prices and sync products with your point-of-sale',
    integrations: [
      {
        id: 'square',
        name: 'Square',
        subtitle: 'POS & Payments',
        description: 'Sync products, push approved prices, and pull sales data from Square POS.',
        iconBg: 'bg-black',
        iconColor: 'text-white',
        iconLetter: '□',
        features: ['Product catalog sync', 'Push price updates to POS', 'Pull daily sales data', 'Multi-location support'],
      },
      {
        id: 'lightspeed',
        name: 'Lightspeed',
        subtitle: 'Retail POS',
        description: 'Connect your Lightspeed Retail POS for product sync and price management.',
        iconBg: 'bg-gradient-to-br from-green-400 to-emerald-600',
        iconColor: 'text-white',
        iconLetter: 'L',
        features: ['Product & variant sync', 'Price push on approval', 'Sales reporting', 'Multi-store support'],
      },
      {
        id: 'shopify-pos',
        name: 'Shopify POS',
        subtitle: 'In-store & Online',
        description: 'Connect Shopify POS for unified pricing across in-store and online channels.',
        iconBg: 'bg-green-600',
        iconColor: 'text-white',
        iconLetter: 'S',
        features: ['Unified POS + online catalog', 'Push prices to all channels', 'Inventory sync', 'Location-based pricing'],
      },
    ],
  },
  {
    id: 'ecommerce',
    title: 'Ecommerce Platforms',
    subtitle: 'Sync products and prices with your online store',
    integrations: [
      {
        id: 'shopify',
        name: 'Shopify',
        subtitle: 'Online Store',
        description: 'Sync your Shopify product catalog and push approved price changes automatically.',
        iconBg: 'bg-green-600',
        iconColor: 'text-white',
        iconLetter: 'S',
        features: ['Product catalog import', 'Automated price updates', 'Collection & tag sync', 'Webhook notifications'],
      },
      {
        id: 'woocommerce',
        name: 'WooCommerce',
        subtitle: 'WordPress',
        description: 'Connect your WooCommerce store for product management and price synchronization.',
        iconBg: 'bg-purple-600',
        iconColor: 'text-white',
        iconLetter: 'W',
        comingSoon: true,
        features: ['Product & variation sync', 'WooCommerce REST API', 'Category mapping', 'Bulk price updates'],
      },
      {
        id: 'csv-import',
        name: 'CSV / Other',
        subtitle: 'Any POS system',
        description: 'Import products from any system via CSV upload. AI auto-detects column mapping.',
        iconBg: 'bg-gray-100',
        iconColor: 'text-gray-500',
        isDashed: true,
        iconSvg: (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        ),
        features: ['Works with any POS export', 'AI column mapping detection', 'CSV, XLSX, TSV support', 'Save mappings for reuse'],
      },
    ],
  },
];

/* ═══════════════════════════════════════════════════════════════════
   Step Progress Bar (reused pattern)
   ═══════════════════════════════════════════════════════════════════ */
function StepProgress({ steps, current }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {steps.map((s, i) => {
        const isDone = i + 1 < current;
        const isActive = i + 1 === current;
        return (
          <div key={s.num} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition ${
                  isDone
                    ? 'bg-green-500 text-white'
                    : isActive
                      ? 'bg-brand-600 text-white'
                      : 'bg-gray-200 text-gray-500'
                }`}
              >
                {isDone ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  s.num
                )}
              </div>
              <span className={`text-xs mt-1 ${isActive ? 'text-brand-700 font-medium' : 'text-gray-400'}`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`w-12 h-0.5 mx-1 mb-5 transition ${isDone ? 'bg-green-400' : isActive ? 'bg-brand-400' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Integration Card
   ═══════════════════════════════════════════════════════════════════ */
function IntegrationCard({ integration, connected, onSetup, onManage }) {
  const { name, subtitle, description, iconBg, iconColor, iconLetter, iconSvg, isDashed, comingSoon } = integration;

  return (
    <div
      className={`group bg-white rounded-xl p-5 transition-all cursor-pointer hover:shadow-lg ${
        isDashed
          ? 'border-2 border-dashed border-gray-300 hover:border-brand-400'
          : 'border-2 border-gray-200 hover:border-brand-400'
      } ${comingSoon ? 'opacity-70' : ''}`}
      onClick={() => {
        if (comingSoon) return;
        if (connected) onManage?.();
        else onSetup?.();
      }}
    >
      <div className="flex items-start gap-4">
        <div
          className={`w-14 h-14 ${iconBg} rounded-xl flex items-center justify-center transition group-hover:scale-110 ${iconColor}`}
        >
          {iconSvg || <span className="text-xl font-bold">{iconLetter}</span>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-lg text-gray-900">{name}</h3>
            {connected && (
              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
                Connected
              </span>
            )}
            {comingSoon && (
              <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-xs font-medium">
                Coming Soon
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500">{subtitle}</p>
          <p className="text-sm text-gray-600 mt-1.5 line-clamp-2">{description}</p>

          {!comingSoon && (
            <div className="mt-3 flex items-center gap-1 text-brand-600 text-sm font-medium">
              {connected ? 'Manage' : `Select ${name}`}
              {icons.arrow}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Gmail Setup Wizard (wired to real api.gmail)
   ═══════════════════════════════════════════════════════════════════ */
function GmailSetupWizard({ onBack, onComplete }) {
  // 'manage' = account list, 'choose' = method selector, 'imap' or 'oauth' = specific flow
  const [mode, setMode] = useState('choose');
  const [step, setStep] = useState(1);
  const [gmailStatus, setGmailStatus] = useState(null);
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingCreds, setSavingCreds] = useState(false);
  const [creds, setCreds] = useState({ googleClientId: '', googleClientSecret: '' });
  // IMAP state
  const [imapCreds, setImapCreds] = useState({ email: '', password: '' });
  const [imapTesting, setImapTesting] = useState(false);
  const [imapTestResult, setImapTestResult] = useState(null);
  const [imapSaving, setImapSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(null); // integration ID being disconnected
  // Shared config
  const [config, setConfig] = useState({
    senderWhitelist: [],
    labelFilter: '',
    pollIntervalMin: 30,
    initialLookbackDays: 7,
  });
  const [whitelistInput, setWhitelistInput] = useState('');
  const [configuring, setConfiguring] = useState(false);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const status = await api.gmail.getStatus();
      setGmailStatus(status);
      setIntegrations(status.integrations || []);

      if (status.integrations?.length > 0) {
        // Show management view when accounts exist
        setMode('manage');
      } else if (status.hasCredentials && status.connectionType !== 'imap') {
        setMode('oauth');
        setStep(2);
      }
      if (status.googleClientId) {
        setCreds((p) => ({ ...p, googleClientId: status.googleClientId }));
      }
    } catch {
      // API not available
    } finally {
      setLoading(false);
    }
  };

  const startAddAccount = () => {
    // Reset wizard state for adding a new account
    setMode('choose');
    setStep(1);
    setImapCreds({ email: '', password: '' });
    setImapTestResult(null);
    setConfig({ senderWhitelist: [], labelFilter: '', pollIntervalMin: 30, initialLookbackDays: 7 });
    setWhitelistInput('');
  };

  const handleDisconnect = async (integrationId, email) => {
    if (!confirm(`Disconnect ${email}? This will stop polling this account and remove its credentials.`)) return;
    setDisconnecting(integrationId);
    try {
      await api.gmail.disconnect(integrationId);
      await loadStatus();
    } catch (err) {
      alert(err.message);
    } finally {
      setDisconnecting(null);
    }
  };

  // ── OAuth handlers ──
  const handleSaveCredentials = async () => {
    if (!creds.googleClientId || !creds.googleClientSecret) return;
    setSavingCreds(true);
    try {
      await api.gmail.saveCredentials(creds);
      setCreds((p) => ({ ...p, googleClientSecret: '' }));
      await loadStatus();
      setStep(2);
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingCreds(false);
    }
  };

  const handleConnect = async () => {
    try {
      const { url } = await api.gmail.getAuthUrl();
      const popup = window.open(url, 'gmail-oauth', 'width=600,height=700,scrollbars=yes');
      if (!popup) window.location.href = url;
      const interval = setInterval(async () => {
        try {
          const status = await api.gmail.getStatus();
          if (status.connected) {
            clearInterval(interval);
            setGmailStatus(status);
            setStep(3);
          }
        } catch { /* keep polling */ }
      }, 2000);
      setTimeout(() => clearInterval(interval), 120000);
    } catch (err) {
      alert(err.message);
    }
  };

  // ── IMAP handlers ──
  const handleImapTest = async () => {
    if (!imapCreds.email || !imapCreds.password) return;
    setImapTesting(true);
    setImapTestResult(null);
    try {
      const result = await api.gmail.imapTestConnection({
        email: imapCreds.email,
        password: imapCreds.password,
      });
      setImapTestResult(result);
    } catch (err) {
      setImapTestResult({ success: false, error: err.message });
    } finally {
      setImapTesting(false);
    }
  };

  const handleImapSave = async () => {
    setImapSaving(true);
    try {
      await api.gmail.imapSaveCredentials({
        email: imapCreds.email,
        password: imapCreds.password,
        ...config,
      });
      // Return to management view after saving
      await loadStatus();
      onComplete?.();
    } catch (err) {
      alert(err.message);
    } finally {
      setImapSaving(false);
    }
  };

  // ── Shared handlers ──
  const handleSaveConfig = async () => {
    setConfiguring(true);
    try {
      await api.gmail.configure(config);
      await loadStatus();
      onComplete?.();
    } catch (err) {
      alert(err.message);
    } finally {
      setConfiguring(false);
    }
  };

  const addToWhitelist = () => {
    if (!whitelistInput.trim()) return;
    setConfig((p) => ({ ...p, senderWhitelist: [...p.senderWhitelist, whitelistInput.trim()] }));
    setWhitelistInput('');
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-400">Loading Gmail status...</div>;
  }

  // ── Management view (connected accounts) ──
  if (mode === 'manage') {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl shadow-lg p-8 slide-up">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center text-red-500">
                {icons.mail}
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Gmail Accounts</h2>
                <p className="text-sm text-gray-500">{integrations.length} account{integrations.length !== 1 ? 's' : ''} connected</p>
              </div>
            </div>
          </div>

          <div className="space-y-3 mb-6">
            {integrations.map((acct) => (
              <div key={acct.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{acct.displayEmail}</p>
                    <p className="text-xs text-gray-400">
                      {acct.connectionType === 'imap' ? 'IMAP' : 'OAuth'} &middot;{' '}
                      {acct.lastPollAt
                        ? `Last polled ${new Date(acct.lastPollAt).toLocaleDateString()}`
                        : 'Not polled yet'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleDisconnect(acct.id, acct.displayEmail)}
                  disabled={disconnecting === acct.id}
                  className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50 transition"
                >
                  {disconnecting === acct.id ? 'Removing...' : 'Disconnect'}
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition flex items-center gap-2"
            >
              {icons.back} Back
            </button>
            <button
              onClick={startAddAccount}
              className="flex-1 px-6 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 transition flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add Another Account
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Mode selector (Simple vs Advanced) ──
  if (mode === 'choose') {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl shadow-lg p-8 slide-up">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center text-red-500">
              {icons.mail}
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Connect Gmail</h2>
              <p className="text-sm text-gray-500">Choose how you'd like to connect your Gmail account</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            {/* Simple Setup — App Password */}
            <button
              onClick={() => { setMode('imap'); setStep(1); }}
              className="text-left border-2 border-gray-200 rounded-xl p-5 hover:border-brand-400 hover:bg-brand-50/30 transition group"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">🔑</span>
                <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded-full uppercase">Recommended</span>
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">Simple Setup</h3>
              <p className="text-xs text-gray-500 mb-3">Use a Google App Password — no developer setup required</p>
              <ul className="space-y-1">
                {['Takes ~2 minutes', 'Just email + App Password', 'Works with Gmail accounts'].map((t) => (
                  <li key={t} className="flex items-center gap-1.5 text-xs text-gray-500">
                    <svg className="w-3.5 h-3.5 text-green-500 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    {t}
                  </li>
                ))}
              </ul>
            </button>

            {/* Advanced Setup — OAuth */}
            <button
              onClick={() => { setMode('oauth'); setStep(1); }}
              className="text-left border-2 border-gray-200 rounded-xl p-5 hover:border-brand-400 hover:bg-brand-50/30 transition group"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">⚙️</span>
                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-[10px] font-bold rounded-full uppercase">Advanced</span>
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">Advanced Setup</h3>
              <p className="text-xs text-gray-500 mb-3">Use Google Cloud OAuth — granular scope control</p>
              <ul className="space-y-1">
                {['Takes ~10 minutes', 'Requires Google Cloud Console', 'Fine-grained permissions'].map((t) => (
                  <li key={t} className="flex items-center gap-1.5 text-xs text-gray-500">
                    <svg className="w-3.5 h-3.5 text-blue-500 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    {t}
                  </li>
                ))}
              </ul>
            </button>
          </div>

          <button
            onClick={integrations.length > 0 ? () => setMode('manage') : onBack}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition flex items-center gap-2"
          >
            {icons.back} {integrations.length > 0 ? 'Back to Accounts' : 'Back'}
          </button>
        </div>
      </div>
    );
  }

  // ── IMAP (Simple Setup) Flow ──
  if (mode === 'imap') {
    const imapSteps = [
      { num: 1, label: 'Credentials' },
      { num: 2, label: 'Configure' },
      { num: 3, label: 'Test' },
      { num: 4, label: 'Done' },
    ];

    return (
      <div className="max-w-2xl mx-auto">
        <StepProgress steps={imapSteps} current={step} />

        {step === 1 && (
          <div className="bg-white rounded-2xl shadow-lg p-8 slide-up">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center text-2xl">🔑</div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Gmail App Password</h2>
                <p className="text-sm text-gray-500">Step 1: Enter your Gmail address and App Password</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-amber-50 rounded-lg p-3 flex items-start gap-2">
                <svg className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <div className="text-xs text-amber-800">
                  <strong>Need an App Password?</strong> You need 2-Step Verification enabled on your Google account, then generate an App Password.{' '}
                  <a href="/app-password-guide.html" target="_blank" rel="noopener noreferrer" className="underline font-medium hover:text-amber-900">
                    View step-by-step guide →
                  </a>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Gmail Address</label>
                <input
                  type="email"
                  value={imapCreds.email}
                  onChange={(e) => setImapCreds((p) => ({ ...p, email: e.target.value }))}
                  placeholder="invoices@yourbusiness.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                />
                <p className="text-xs text-gray-400 mt-1">This can be any Gmail account — it doesn't need to match your login email</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">App Password</label>
                <input
                  type="password"
                  value={imapCreds.password}
                  onChange={(e) => setImapCreds((p) => ({ ...p, password: e.target.value }))}
                  placeholder="xxxx xxxx xxxx xxxx"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                />
                <p className="text-xs text-gray-400 mt-1">16-character password from Google (spaces are OK)</p>
              </div>

              <div className="bg-blue-50 rounded-lg p-3 flex items-start gap-2">
                {icons.shield}
                <p className="text-xs text-blue-700">
                  Your App Password is encrypted with AES-256-GCM before storage. We never store plaintext credentials.
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => setMode('choose')}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition flex items-center gap-2"
                >
                  {icons.back} Back
                </button>
                <button
                  onClick={() => setStep(2)}
                  disabled={!imapCreds.email || !imapCreds.password}
                  className="flex-1 px-6 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="bg-white rounded-2xl shadow-lg p-8 slide-up">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center text-green-500">
                {icons.check}
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Configure Import Settings</h2>
                <p className="text-sm text-gray-500">Step 2: Set up sender filtering and poll schedule</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sender Whitelist</label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={whitelistInput}
                    onChange={(e) => setWhitelistInput(e.target.value)}
                    placeholder="supplier@example.com"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"
                    onKeyDown={(e) => e.key === 'Enter' && addToWhitelist()}
                  />
                  <button onClick={addToWhitelist} className="px-3 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">
                    Add
                  </button>
                </div>
                {config.senderWhitelist.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {config.senderWhitelist.map((email) => (
                      <span key={email} className="px-2 py-0.5 bg-gray-100 rounded text-xs flex items-center gap-1">
                        {email}
                        <button
                          onClick={() => setConfig((p) => ({ ...p, senderWhitelist: p.senderWhitelist.filter((e) => e !== email) }))}
                          className="text-gray-400 hover:text-red-500"
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-1">Leave empty to import from all senders</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Gmail Label / Folder</label>
                <input
                  type="text"
                  value={config.labelFilter}
                  onChange={(e) => setConfig((p) => ({ ...p, labelFilter: e.target.value }))}
                  placeholder="INBOX (default)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Poll Interval</label>
                <PollIntervalInput
                  value={config.pollIntervalMin}
                  onChange={(val) => setConfig((p) => ({ ...p, pollIntervalMin: val }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Initial Lookback</label>
                <select
                  value={config.initialLookbackDays}
                  onChange={(e) => setConfig((p) => ({ ...p, initialLookbackDays: parseInt(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"
                >
                  {[1, 3, 7, 14, 30, 60, 90].map((d) => (
                    <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">How far back to search for invoices on the first poll</p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => setStep(1)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition"
                >
                  Back
                </button>
                <button
                  onClick={() => { setStep(3); handleImapTest(); }}
                  className="flex-1 px-6 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 transition"
                >
                  Test Connection
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="bg-white rounded-2xl shadow-lg p-8 slide-up">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-2xl">🔌</div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Test & Connect</h2>
                <p className="text-sm text-gray-500">Step 3: Verify connection to Gmail via IMAP</p>
              </div>
            </div>

            <div className="space-y-4">
              {imapTesting && (
                <div className="bg-gray-50 rounded-xl p-6 text-center">
                  <div className="animate-spin w-8 h-8 border-3 border-brand-500 border-t-transparent rounded-full mx-auto mb-3"></div>
                  <p className="text-sm text-gray-600 font-medium">Connecting to imap.gmail.com...</p>
                  <p className="text-xs text-gray-400 mt-1">Testing login with your App Password</p>
                </div>
              )}

              {imapTestResult && !imapTesting && (
                <>
                  {imapTestResult.success ? (
                    <div className="bg-green-50 border border-green-200 rounded-xl p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="font-semibold text-green-800">Connection Successful!</span>
                      </div>
                      <p className="text-sm text-green-700 mb-2">
                        Successfully connected to <strong>{imapCreds.email}</strong> via IMAP.
                      </p>
                      {imapTestResult.folders && (
                        <div className="mt-2">
                          <p className="text-xs text-green-600 font-medium mb-1">Mailbox folders found:</p>
                          <div className="flex flex-wrap gap-1">
                            {imapTestResult.folders.slice(0, 8).map((f) => (
                              <span key={f} className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">{f}</span>
                            ))}
                            {imapTestResult.folders.length > 8 && (
                              <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">+{imapTestResult.folders.length - 8} more</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                        </svg>
                        <span className="font-semibold text-red-800">Connection Failed</span>
                      </div>
                      <p className="text-sm text-red-700">{imapTestResult.error}</p>
                      <div className="mt-3 text-xs text-red-600 space-y-1">
                        <p><strong>Common fixes:</strong></p>
                        <ul className="list-disc pl-4 space-y-0.5">
                          <li>Make sure IMAP is enabled in Gmail Settings → Forwarding and POP/IMAP</li>
                          <li>Use an App Password, not your regular Google password</li>
                          <li>Ensure 2-Step Verification is enabled on your Google account</li>
                        </ul>
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => { setStep(2); setImapTestResult(null); }}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition"
                >
                  Back
                </button>
                {imapTestResult?.success ? (
                  <button
                    onClick={handleImapSave}
                    disabled={imapSaving}
                    className="flex-1 px-6 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition"
                  >
                    {imapSaving ? 'Saving...' : 'Complete Setup'}
                  </button>
                ) : !imapTesting ? (
                  <button
                    onClick={handleImapTest}
                    className="flex-1 px-6 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 transition"
                  >
                    Retry Test
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <SuccessScreen
            icon="📧"
            iconBg="bg-red-50"
            title="Gmail Connected!"
            subtitle="Invoice emails will be automatically imported and processed by AI."
            items={[
              { emoji: '📥', title: 'Inbox monitoring active', subtitle: `Checking ${formatPollInterval(config.pollIntervalMin)} for new invoices`, progress: 100 },
              { emoji: '🤖', title: 'AI extraction ready', subtitle: 'PDF and image attachments will be OCR processed automatically' },
              { emoji: '📊', title: 'Duplicate detection enabled', subtitle: '3-layer dedup prevents re-importing the same invoice' },
            ]}
            onDone={onBack}
          />
        )}
      </div>
    );
  }

  // ── OAuth (Advanced Setup) Flow ──
  const oauthSteps = [
    { num: 1, label: 'Credentials' },
    { num: 2, label: 'Authorize' },
    { num: 3, label: 'Configure' },
    { num: 4, label: 'Done' },
  ];

  return (
    <div className="max-w-2xl mx-auto">
      <StepProgress steps={oauthSteps} current={step} />

      {step === 1 && (
        <div className="bg-white rounded-2xl shadow-lg p-8 slide-up">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center text-red-500">
              {icons.mail}
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Connect Gmail (OAuth)</h2>
              <p className="text-sm text-gray-500">Step 1: Enter Google Cloud OAuth credentials</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-blue-50 rounded-lg p-3 flex items-start gap-2">
              {icons.shield}
              <p className="text-xs text-blue-700">
                Create an OAuth 2.0 Client in your Google Cloud Console. Your credentials are encrypted and stored securely.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
              <input
                type="text"
                value={creds.googleClientId}
                onChange={(e) => setCreds((p) => ({ ...p, googleClientId: e.target.value }))}
                placeholder="123456789.apps.googleusercontent.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Client Secret</label>
              <input
                type="password"
                value={creds.googleClientSecret}
                onChange={(e) => setCreds((p) => ({ ...p, googleClientSecret: e.target.value }))}
                placeholder="GOCSPX-..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setMode('choose')}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition flex items-center gap-2"
              >
                {icons.back} Back
              </button>
              <button
                onClick={handleSaveCredentials}
                disabled={savingCreds || !creds.googleClientId || !creds.googleClientSecret}
                className="flex-1 px-6 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition"
              >
                {savingCreds ? 'Saving...' : 'Save & Continue'}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="bg-white rounded-2xl shadow-lg p-8 slide-up">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center text-red-500">
              {icons.mail}
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Authorize Gmail Access</h2>
              <p className="text-sm text-gray-500">Step 2: Sign in with Google to grant access</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-5 space-y-3">
              <p className="text-sm text-gray-700 font-medium">RetailEdge AI will request access to:</p>
              <ul className="space-y-2">
                {['Read email messages and attachments', 'Search for invoices by sender and label', 'Mark imported emails to prevent duplicates'].map((p) => (
                  <li key={p} className="flex items-center gap-2 text-sm text-gray-600">
                    <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    {p}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-blue-50 rounded-lg p-3 flex items-start gap-2">
              {icons.shield}
              <p className="text-xs text-blue-700">
                Your data is secure. RetailEdge AI will never share your data. You can revoke access anytime from your Google account settings.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition"
              >
                Back
              </button>
              <button
                onClick={handleConnect}
                className="flex-1 px-6 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 transition"
              >
                Sign in with Google
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="bg-white rounded-2xl shadow-lg p-8 slide-up">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center text-green-500">
              {icons.check}
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Configure Import Settings</h2>
              <p className="text-sm text-gray-500">Step 3: Set up sender filtering and poll schedule</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sender Whitelist</label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={whitelistInput}
                  onChange={(e) => setWhitelistInput(e.target.value)}
                  placeholder="supplier@example.com"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"
                  onKeyDown={(e) => e.key === 'Enter' && addToWhitelist()}
                />
                <button onClick={addToWhitelist} className="px-3 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">
                  Add
                </button>
              </div>
              {config.senderWhitelist.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {config.senderWhitelist.map((email) => (
                    <span key={email} className="px-2 py-0.5 bg-gray-100 rounded text-xs flex items-center gap-1">
                      {email}
                      <button
                        onClick={() => setConfig((p) => ({ ...p, senderWhitelist: p.senderWhitelist.filter((e) => e !== email) }))}
                        className="text-gray-400 hover:text-red-500"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-400 mt-1">Leave empty to import from all senders</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Gmail Label</label>
              <input
                type="text"
                value={config.labelFilter}
                onChange={(e) => setConfig((p) => ({ ...p, labelFilter: e.target.value }))}
                placeholder="e.g. Invoices"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Poll Interval</label>
              <PollIntervalInput
                value={config.pollIntervalMin}
                onChange={(val) => setConfig((p) => ({ ...p, pollIntervalMin: val }))}
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition"
              >
                Back
              </button>
              <button
                onClick={handleSaveConfig}
                disabled={configuring}
                className="flex-1 px-6 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition"
              >
                {configuring ? 'Saving...' : 'Complete Setup'}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 4 && (
        <SuccessScreen
          icon="📧"
          iconBg="bg-red-50"
          title="Gmail Connected!"
          subtitle="Invoice emails will be automatically imported and processed by AI."
          items={[
            { emoji: '📥', title: 'Inbox monitoring active', subtitle: `Checking ${formatPollInterval(config.pollIntervalMin)} for new invoices`, progress: 100 },
            { emoji: '🤖', title: 'AI extraction ready', subtitle: 'PDF and image attachments will be OCR processed automatically' },
            { emoji: '📊', title: 'Duplicate detection enabled', subtitle: '3-layer dedup prevents re-importing the same invoice' },
          ]}
          onDone={onBack}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Folder Watch Setup Wizard (wired to real api.folderPolling)
   ═══════════════════════════════════════════════════════════════════ */
function FolderSetupWizard({ onBack, onComplete }) {
  const [step, setStep] = useState(1);
  const [folderStatus, setFolderStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [config, setConfig] = useState({
    folderPath: '',
    filePatterns: ['*.pdf', '*.jpg', '*.jpeg', '*.png', '*.webp'],
    pollIntervalMin: 30,
  });
  const [patternInput, setPatternInput] = useState('');
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const status = await api.folderPolling.getStatus();
      setFolderStatus(status);
      if (status.connected) {
        setStep(3);
        setConfig({
          folderPath: status.integration?.folderPath || '',
          filePatterns: status.integration?.filePatterns || ['*.pdf', '*.jpg', '*.jpeg', '*.png', '*.webp'],
          pollIntervalMin: status.integration?.pollIntervalMin || 30,
        });
      }
    } catch {
      // API not available
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    if (!config.folderPath.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.folderPolling.testConnection({ folderPath: config.folderPath.trim() });
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.folderPolling.configure(config);
      setStep(3);
      onComplete?.();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addPattern = () => {
    const p = patternInput.trim();
    if (!p) return;
    const formatted = p.startsWith('*.') ? p : `*.${p}`;
    if (config.filePatterns.includes(formatted)) return;
    setConfig((prev) => ({ ...prev, filePatterns: [...prev.filePatterns, formatted] }));
    setPatternInput('');
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-400">Loading folder status...</div>;
  }

  const wizardSteps = [
    { num: 1, label: 'Configure' },
    { num: 2, label: 'Verify' },
    { num: 3, label: 'Done' },
  ];

  return (
    <div className="max-w-2xl mx-auto">
      <StepProgress steps={wizardSteps} current={step} />

      {step === 1 && (
        <div className="bg-white rounded-2xl shadow-lg p-8 slide-up">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600">
              {icons.folder}
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Set Up Folder Watch</h2>
              <p className="text-sm text-gray-500">Point to a folder that receives invoice files</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Folder Path</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={config.folderPath}
                  onChange={(e) => setConfig((p) => ({ ...p, folderPath: e.target.value }))}
                  placeholder="C:\Invoices  or  \\server\share\Invoices"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                />
                <button
                  type="button"
                  onClick={() => setShowFolderBrowser(true)}
                  className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                  title="Browse folders"
                >
                  <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                  </svg>
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Local paths and UNC network paths are supported
              </p>
              <FolderBrowser
                isOpen={showFolderBrowser}
                onClose={() => setShowFolderBrowser(false)}
                onSelect={(path) => setConfig((p) => ({ ...p, folderPath: path }))}
                initialPath={config.folderPath || null}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">File Patterns</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={patternInput}
                  onChange={(e) => setPatternInput(e.target.value)}
                  placeholder="*.pdf"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"
                  onKeyDown={(e) => e.key === 'Enter' && addPattern()}
                />
                <button onClick={addPattern} className="px-3 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">
                  Add
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {config.filePatterns.map((p) => (
                  <span key={p} className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded text-xs flex items-center gap-1">
                    {p}
                    <button
                      onClick={() => setConfig((prev) => ({ ...prev, filePatterns: prev.filePatterns.filter((x) => x !== p) }))}
                      className="text-amber-400 hover:text-red-500"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Poll Interval</label>
              <PollIntervalInput
                value={config.pollIntervalMin}
                onChange={(val) => setConfig((p) => ({ ...p, pollIntervalMin: val }))}
              />
              <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                The folder will be scanned immediately when you save, then on the schedule above.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={onBack}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition flex items-center gap-2"
              >
                {icons.back} Back
              </button>
              <button
                onClick={() => {
                  if (!config.folderPath.trim()) {
                    alert('Enter a folder path first.');
                    return;
                  }
                  setStep(2);
                }}
                className="flex-1 px-6 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition"
              >
                Next: Verify Connection
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="bg-white rounded-2xl shadow-lg p-8 slide-up">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600">
              {icons.folder}
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Verify Connection</h2>
              <p className="text-sm text-gray-500">Test that the server can access the folder</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-sm text-gray-700 font-medium">Folder Path</p>
              <p className="text-sm font-mono text-gray-900 mt-1">{config.folderPath}</p>
              <p className="text-xs text-gray-500 mt-1">
                Patterns: {config.filePatterns.join(', ')} · Polling {formatPollInterval(config.pollIntervalMin)}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleTest}
                disabled={testing}
                className="px-6 py-2.5 bg-gray-800 text-white rounded-xl text-sm font-medium hover:bg-gray-900 disabled:opacity-50 transition flex items-center gap-2"
              >
                {testing ? icons.spinner : null}
                {testing ? 'Testing...' : 'Test Connection'}
              </button>

              {testResult && (
                <span className={`text-sm font-medium ${testResult.success ? 'text-emerald-600' : 'text-red-600'}`}>
                  {testResult.success ? `✓ ${testResult.message}` : `✗ ${testResult.error}`}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition"
              >
                Back
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !testResult?.success}
                className="flex-1 px-6 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {saving ? 'Saving...' : 'Save & Enable'}
              </button>
            </div>

            {!testResult?.success && config.folderPath.trim() && (
              <p className="text-xs text-gray-400">Test the connection before saving</p>
            )}
          </div>
        </div>
      )}

      {step === 3 && (
        <SuccessScreen
          icon="📁"
          iconBg="bg-amber-50"
          title="Folder Watch Active!"
          subtitle={`Monitoring ${config.folderPath} for new invoice files.`}
          items={[
            { emoji: '👁️', title: 'Folder monitoring active', subtitle: `Checking ${formatPollInterval(config.pollIntervalMin)} for new files`, progress: 100 },
            { emoji: '📄', title: 'Auto-processing enabled', subtitle: `Watching for ${config.filePatterns.join(', ')} files` },
            { emoji: '📂', title: 'Processed folder ready', subtitle: 'Imported files will be moved to a "Processed" subfolder' },
          ]}
          onDone={onBack}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   POS / Ecommerce Setup Wizard (mock OAuth flow)
   ═══════════════════════════════════════════════════════════════════ */
function POSSetupWizard({ system, onBack, onComplete }) {
  const [step, setStep] = useState(1);
  const [connecting, setConnecting] = useState(false);
  const [showOAuth, setShowOAuth] = useState(false);
  const [stores, setStores] = useState(null);
  const [storeMappings, setStoreMappings] = useState({});
  const [existingStores, setExistingStores] = useState([]);
  const [syncSettings, setSyncSettings] = useState({
    importProducts: true,
    importSales: true,
    pushPrices: true,
    syncInventory: false,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadExistingStores();
  }, []);

  const loadExistingStores = async () => {
    try {
      const data = await api.getStores();
      setExistingStores(data || []);
    } catch {
      // API not available — use mock data
      setExistingStores([
        { id: 'store-1', name: 'Main Street Store', type: 'POS' },
        { id: 'store-2', name: 'Online Store', type: 'ECOMMERCE' },
      ]);
    }
  };

  const handleAuthorize = () => {
    setConnecting(true);
    setShowOAuth(true);
  };

  const handleOAuthAllow = () => {
    setShowOAuth(false);
    setConnecting(false);
    // Mock discovered locations
    const mockStores = getMockStores(system.id);
    setStores(mockStores);
    const defaultMappings = {};
    mockStores.forEach((s, i) => {
      defaultMappings[s.id] = existingStores[i]?.id || 'new';
    });
    setStoreMappings(defaultMappings);
    setStep(3);
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      await api.connect.mapStores(system.id, { mappings: storeMappings, syncSettings });
    } catch {
      // Expected if backend not implemented yet — continue with mock
    }
    setSaving(false);
    setStep(4);
    onComplete?.();
  };

  const wizardSteps = [
    { num: 1, label: 'Select' },
    { num: 2, label: 'Sign In' },
    { num: 3, label: 'Map Stores' },
    { num: 4, label: 'Done' },
  ];

  return (
    <div className="max-w-2xl mx-auto">
      <StepProgress steps={wizardSteps} current={step} />

      {/* OAuth Modal Overlay */}
      {showOAuth && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
          <div className="w-[480px] bg-white rounded-2xl shadow-2xl overflow-hidden slide-up">
            {/* Provider header */}
            <div className={`px-6 py-4 flex items-center justify-between ${getSystemHeaderBg(system.id)}`}>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center text-white font-bold">
                  {system.iconLetter || '○'}
                </div>
                <span className="text-white font-medium">{system.name}</span>
              </div>
              <button onClick={() => { setShowOAuth(false); setConnecting(false); }} className="text-white/70 hover:text-white">
                {icons.close}
              </button>
            </div>

            {/* Auth content */}
            <div className="p-8">
              <h3 className="text-xl font-bold text-gray-900 text-center mb-1">Authorize RetailEdge AI</h3>
              <p className="text-sm text-gray-500 text-center mb-6">
                RetailEdge AI is requesting access to your {system.name} account
              </p>

              <div className="bg-gray-50 rounded-xl p-4 mb-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">RetailEdge AI</p>
                    <p className="text-xs text-gray-500">by RetailEdge Pty Ltd</p>
                  </div>
                </div>

                <ul className="space-y-2">
                  {getPermissions(system.id).map((perm) => (
                    <li key={perm} className="flex items-center gap-2 text-sm text-gray-600">
                      <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      {perm}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-blue-50 rounded-lg p-3 flex items-start gap-2 mb-6">
                {icons.shield}
                <p className="text-xs text-blue-700">
                  Your data is secure. RetailEdge will never share your data with third parties. You can revoke access anytime from your {system.name} settings.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => { setShowOAuth(false); setConnecting(false); }}
                  className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition"
                >
                  Deny
                </button>
                <button
                  onClick={handleOAuthAllow}
                  className={`flex-1 px-4 py-2.5 text-white rounded-xl text-sm font-medium transition ${getSystemButtonBg(system.id)}`}
                >
                  Allow Access
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="bg-white rounded-2xl shadow-lg p-8 slide-up">
          <div className="flex items-center gap-3 mb-6">
            <div className={`w-14 h-14 ${system.iconBg} rounded-xl flex items-center justify-center ${system.iconColor}`}>
              {system.iconSvg || <span className="text-xl font-bold">{system.iconLetter}</span>}
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Connect {system.name}</h2>
              <p className="text-sm text-gray-500">{system.subtitle}</p>
            </div>
          </div>

          <p className="text-sm text-gray-600 mb-4">{system.description}</p>

          <div className="bg-gray-50 rounded-xl p-4 mb-6">
            <p className="text-sm font-medium text-gray-700 mb-2">What you'll get:</p>
            <ul className="space-y-1.5">
              {system.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                  <svg className="w-4 h-4 text-brand-500 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition flex items-center gap-2"
            >
              {icons.back} Back
            </button>
            <button
              onClick={() => setStep(2)}
              className="flex-1 px-6 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 transition"
            >
              Continue to Sign In
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="bg-white rounded-2xl shadow-lg p-8 slide-up text-center">
          <div className={`w-20 h-20 ${system.iconBg} rounded-2xl flex items-center justify-center ${system.iconColor} mx-auto mb-4`}>
            {system.iconSvg || <span className="text-3xl font-bold">{system.iconLetter}</span>}
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Sign in to {system.name}</h2>
          <p className="text-sm text-gray-500 mb-6">
            You'll be redirected to {system.name} to authorize RetailEdge AI access to your account.
          </p>

          <div className="flex items-center gap-3 max-w-sm mx-auto">
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition"
            >
              Back
            </button>
            <button
              onClick={handleAuthorize}
              disabled={connecting}
              className={`flex-1 px-6 py-2.5 text-white rounded-xl text-sm font-medium transition flex items-center justify-center gap-2 ${getSystemButtonBg(system.id)} disabled:opacity-50`}
            >
              {connecting ? icons.spinner : null}
              {connecting ? 'Connecting...' : `Sign in with ${system.name}`}
            </button>
          </div>
        </div>
      )}

      {step === 3 && stores && (
        <div className="bg-white rounded-2xl shadow-lg p-8 slide-up">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Map Your Stores</h2>
          <p className="text-sm text-gray-500 mb-6">
            We found {stores.length} location{stores.length !== 1 ? 's' : ''} in your {system.name} account. Map each to a RetailEdge store.
          </p>

          <div className="space-y-4 mb-6">
            {stores.map((store) => (
              <div key={store.id} className="bg-gray-50 rounded-xl p-5 border border-gray-200">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-10 h-10 ${system.iconBg} rounded-lg flex items-center justify-center ${system.iconColor}`}>
                    {system.iconSvg || <span className="text-sm font-bold">{system.iconLetter}</span>}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{store.name}</p>
                    <p className="text-xs text-gray-500">{system.name} Location ID: {store.id}</p>
                  </div>
                  <span className="px-2 py-0.5 bg-green-50 text-green-700 text-xs rounded-full">
                    {store.productCount} products
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-gray-400">{icons.arrow}</span>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 mb-1 block">Map to RetailEdge store:</label>
                    <select
                      value={storeMappings[store.id] || 'new'}
                      onChange={(e) => setStoreMappings((p) => ({ ...p, [store.id]: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                    >
                      {existingStores.map((es) => (
                        <option key={es.id} value={es.id}>
                          {es.name} ({es.type})
                        </option>
                      ))}
                      <option value="new">+ Create new store</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Sync Settings */}
          <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 mb-6">
            <h4 className="font-medium text-brand-900 text-sm mb-3">Sync Settings</h4>
            <div className="space-y-2">
              {[
                { key: 'importProducts', label: `Import product catalog from ${system.name}` },
                { key: 'importSales', label: 'Import daily sales data' },
                { key: 'pushPrices', label: `Push price updates to ${system.name} when approved` },
                { key: 'syncInventory', label: 'Sync inventory levels (bidirectional)' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 text-sm text-brand-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncSettings[key]}
                    onChange={(e) => setSyncSettings((p) => ({ ...p, [key]: e.target.checked }))}
                    className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition"
            >
              Back
            </button>
            <button
              onClick={handleComplete}
              disabled={saving}
              className="flex-1 px-6 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition"
            >
              {saving ? 'Saving...' : 'Complete Setup & Start Sync'}
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <SuccessScreen
          icon={getSystemEmoji(system.id)}
          iconBg="bg-green-50"
          title="You're All Set! 🎉"
          subtitle={`${system.name} is now connected. Your product catalog is syncing in the background.`}
          items={[
            {
              emoji: '📦',
              title: 'Product catalog syncing now...',
              subtitle: `${stores?.[0]?.productCount || 0} products importing from ${stores?.[0]?.name || 'your store'}`,
              progress: 45,
            },
            {
              emoji: '📊',
              title: 'Sales data will start flowing in',
              subtitle: 'Historical sales from last 30 days will import within the hour',
            },
            {
              emoji: '💰',
              title: 'Price updates push automatically',
              subtitle: `When approved in RetailEdge, prices are instantly pushed to ${system.name}`,
            },
          ]}
          onDone={onBack}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   CSV Import Wizard
   ═══════════════════════════════════════════════════════════════════ */
function CSVImportWizard({ onBack }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [mappingResult, setMappingResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [saveMapping, setSaveMapping] = useState(true);

  const handleUpload = async (selectedFile) => {
    setFile(selectedFile);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      const result = await api.uploadProductFile(formData);
      setMappingResult(result);
    } catch (err) {
      // Use mock mapping for demo
      setMappingResult({
        fileName: selectedFile.name,
        rowCount: 847,
        detectedSystem: 'Hike POS',
        columns: [
          { source: 'Product Name', mapped: 'productName', confidence: 0.99 },
          { source: 'Retail Price', mapped: 'salePrice', confidence: 0.95 },
          { source: 'Cost', mapped: 'currentCost', confidence: 0.97 },
          { source: 'Units Sold', mapped: 'quantitySold', confidence: 0.92 },
          { source: 'SKU', mapped: 'sku', confidence: 0.99 },
          { source: 'Date', mapped: 'date', confidence: 0.98 },
        ],
        preview: [
          { 'Product Name': 'Free Range Eggs 700g', SKU: 'EGG-FR-700', Cost: '$5.20', 'Retail Price': '$6.50', 'Units Sold': '24', Date: '16 Mar' },
          { 'Product Name': 'Organic Milk 2L', SKU: 'MLK-ORG-2L', Cost: '$3.40', 'Retail Price': '$5.99', 'Units Sold': '18', Date: '16 Mar' },
          { 'Product Name': 'Sourdough Loaf 750g', SKU: 'BRD-SD-750', Cost: '$3.20', 'Retail Price': '$6.99', 'Units Sold': '15', Date: '16 Mar' },
        ],
      });
    } finally {
      setUploading(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const result = await api.confirmProductImport({
        fileName: mappingResult.fileName,
        mapping: Object.fromEntries(mappingResult.columns.map((c) => [c.source, c.mapped])),
        saveMapping,
      });
      setImportResult(result);
    } catch {
      setImportResult({ imported: mappingResult.rowCount, skipped: 0 });
    } finally {
      setImporting(false);
    }
  };

  const FIELD_OPTIONS = [
    { value: 'productName', label: 'Product Name' },
    { value: 'sku', label: 'SKU' },
    { value: 'currentCost', label: 'Cost Price' },
    { value: 'salePrice', label: 'Retail Price' },
    { value: 'quantitySold', label: 'Quantity Sold' },
    { value: 'date', label: 'Date' },
    { value: 'category', label: 'Category' },
    { value: 'barcode', label: 'Barcode' },
    { value: 'ignore', label: '— Ignore —' },
  ];

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white rounded-2xl shadow-lg p-8 slide-up">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center text-gray-500">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Smart CSV Import</h2>
            <p className="text-sm text-gray-500">AI automatically detects your column mapping</p>
          </div>
        </div>

        {!mappingResult && !importResult && (
          <>
            {/* Drop zone */}
            <label className="block border-2 border-dashed border-gray-300 rounded-xl p-8 text-center mb-6 hover:border-brand-400 transition cursor-pointer">
              {uploading ? (
                <div className="flex flex-col items-center gap-3">
                  {icons.spinner}
                  <p className="text-sm text-gray-500">Analyzing file...</p>
                </div>
              ) : (
                <>
                  {icons.upload}
                  <p className="text-sm text-gray-700 mt-3">
                    {file ? file.name : 'Drag & drop your POS export file here'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">CSV, XLSX, or TSV — max 10MB</p>
                  <span className="inline-block mt-3 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">
                    Browse Files
                  </span>
                </>
              )}
              <input
                type="file"
                accept=".csv,.xlsx,.tsv,.xls"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
              />
            </label>
          </>
        )}

        {mappingResult && !importResult && (
          <>
            {/* AI Column Detection */}
            <div className="bg-brand-50 border border-brand-200 rounded-xl p-5 mb-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xl">🤖</span>
                <div>
                  <p className="text-sm font-medium text-brand-900">AI detected your column mapping</p>
                  <p className="text-xs text-brand-700">
                    {mappingResult.fileName} — {mappingResult.rowCount} rows detected
                    {mappingResult.detectedSystem ? ` from ${mappingResult.detectedSystem}` : ''}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {mappingResult.columns.map((col) => (
                  <div key={col.source} className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-28 truncate">{col.source}</span>
                    <span className="text-gray-400">{icons.arrow}</span>
                    <select
                      value={col.mapped}
                      onChange={(e) => {
                        setMappingResult((prev) => ({
                          ...prev,
                          columns: prev.columns.map((c) =>
                            c.source === col.source ? { ...c, mapped: e.target.value } : c,
                          ),
                        }));
                      }}
                      className="flex-1 px-2 py-1 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-brand-500"
                    >
                      {FIELD_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                ))}
              </div>

              <p className="text-xs text-green-700 font-medium mt-3">
                All {mappingResult.columns.length} columns mapped automatically. Confirm to import, or adjust any mapping.
              </p>
            </div>

            {/* Data Preview */}
            {mappingResult.preview?.length > 0 && (
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Preview (first {mappingResult.preview.length} rows)</h4>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        {Object.keys(mappingResult.preview[0]).map((key) => (
                          <th key={key} className="px-3 py-2 text-left font-medium text-gray-500">
                            {key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {mappingResult.preview.map((row, i) => (
                        <tr key={i}>
                          {Object.values(row).map((val, j) => (
                            <td key={j} className="px-3 py-2 text-gray-700">
                              {val}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveMapping}
                  onChange={(e) => setSaveMapping(e.target.checked)}
                  className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                Save this mapping for future imports{mappingResult.detectedSystem ? ` from "${mappingResult.detectedSystem}"` : ''}
              </label>
              <button
                onClick={handleImport}
                disabled={importing}
                className="px-6 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition"
              >
                {importing ? 'Importing...' : `Import ${mappingResult.rowCount} Rows`}
              </button>
            </div>
          </>
        )}

        {importResult && (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Import Complete!</h3>
            <p className="text-sm text-gray-500 mb-6">
              {importResult.imported} products imported successfully
              {importResult.skipped > 0 ? `, ${importResult.skipped} skipped` : ''}.
            </p>
            <button
              onClick={onBack}
              className="px-8 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 transition"
            >
              Back to Integrations
            </button>
          </div>
        )}

        {!mappingResult && !importResult && (
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition flex items-center gap-2"
            >
              {icons.back} Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Success Screen (shared by all wizards)
   ═══════════════════════════════════════════════════════════════════ */
function SuccessScreen({ icon, iconBg, title, subtitle, items, onDone }) {
  return (
    <div className="max-w-lg mx-auto py-8 text-center slide-up">
      <div className={`w-24 h-24 ${iconBg} rounded-3xl flex items-center justify-center mx-auto mb-6`}>
        <span className="text-4xl">{icon}</span>
      </div>
      <h2 className="text-3xl font-bold text-gray-900 mb-2">{title}</h2>
      <p className="text-gray-500 mb-8">{subtitle}</p>

      <div className="bg-white rounded-2xl shadow-lg p-6 text-left mb-8">
        <h4 className="text-sm font-semibold text-gray-700 mb-4">What happens next:</h4>
        <div className="space-y-4">
          {items.map((item) => (
            <div key={item.title} className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                item.emoji === '📦' ? 'bg-blue-50'
                  : item.emoji === '📊' || item.emoji === '👁️' ? 'bg-green-50'
                    : item.emoji === '💰' ? 'bg-amber-50'
                      : 'bg-gray-50'
              }`}>
                <span className="text-lg">{item.emoji}</span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{item.title}</p>
                <p className="text-xs text-gray-500">{item.subtitle}</p>
                {item.progress != null && (
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
                    <div className="bg-brand-500 h-1.5 rounded-full transition-all" style={{ width: `${item.progress}%` }} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={onDone}
        className="px-8 py-3 bg-brand-600 text-white rounded-xl text-lg font-medium hover:bg-brand-700 transition"
      >
        Back to Integrations
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Helper functions
   ═══════════════════════════════════════════════════════════════════ */
function getMockStores(systemId) {
  const storeMap = {
    square: [
      { id: 'LX4F2K9M', name: 'Green Grocer — Main Street', productCount: 234 },
      { id: 'MN8P3Q7R', name: 'Green Grocer — Market Hall', productCount: 156 },
    ],
    lightspeed: [
      { id: 'LS-001', name: 'Main Street Store', productCount: 412 },
    ],
    'shopify-pos': [
      { id: 'SP-MAIN', name: 'Shopify POS — Main Street', productCount: 287 },
      { id: 'SP-ONLINE', name: 'Shopify Online Store', productCount: 342 },
    ],
    shopify: [
      { id: 'SHOP-MAIN', name: 'Online Store', productCount: 342 },
    ],
  };
  return storeMap[systemId] || [{ id: 'STORE-1', name: 'Default Store', productCount: 100 }];
}

function getPermissions(systemId) {
  const perms = {
    square: ['Read product catalog and variants', 'Update product prices', 'Read order and sales data', 'Read inventory levels'],
    lightspeed: ['Read product catalog', 'Update product pricing', 'Read sales transactions', 'Manage inventory'],
    'shopify-pos': ['Read products and collections', 'Write product prices', 'Read orders', 'Read inventory'],
    shopify: ['Read products and collections', 'Write product prices', 'Read orders', 'Read inventory'],
  };
  return perms[systemId] || ['Read data', 'Write data'];
}

function getSystemHeaderBg(systemId) {
  const map = {
    square: 'bg-black',
    lightspeed: 'bg-gradient-to-r from-green-500 to-emerald-600',
    'shopify-pos': 'bg-green-600',
    shopify: 'bg-green-600',
  };
  return map[systemId] || 'bg-gray-800';
}

function getSystemButtonBg(systemId) {
  const map = {
    square: 'bg-black hover:bg-gray-800',
    lightspeed: 'bg-emerald-600 hover:bg-emerald-700',
    'shopify-pos': 'bg-green-600 hover:bg-green-700',
    shopify: 'bg-green-600 hover:bg-green-700',
  };
  return map[systemId] || 'bg-gray-800 hover:bg-gray-900';
}

function getSystemEmoji(systemId) {
  const map = {
    square: '⬛',
    lightspeed: '⚡',
    'shopify-pos': '🛒',
    shopify: '🛍️',
  };
  return map[systemId] || '✅';
}

/* ═══════════════════════════════════════════════════════════════════
   Google Drive Setup Wizard (per-tenant OAuth credentials)
   ═══════════════════════════════════════════════════════════════════ */
const DRIVE_STEPS = [
  { num: 1, label: 'Credentials' },
  { num: 2, label: 'Connect' },
  { num: 3, label: 'Select Folder' },
  { num: 4, label: 'Done' },
];

function GoogleDriveSetupWizard({ onBack, onComplete }) {
  const [step, setStep] = useState(1);
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [pendingIntegrationId, setPendingIntegrationId] = useState(null);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [addingFolder, setAddingFolder] = useState(false);
  const [lastAddedFolder, setLastAddedFolder] = useState(null);
  const [disconnecting, setDisconnecting] = useState(null);
  const [driveCreds, setDriveCreds] = useState({ googleClientId: '', googleClientSecret: '' });
  const [savingCreds, setSavingCreds] = useState(false);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const status = await api.drive.getStatus();
      setIntegrations(status.integrations || []);
      if (status.integrations?.length > 0) {
        setStep(4); // management view
      } else if (status.pendingOAuth?.email) {
        // OAuth done but no folder selected yet
        setPendingIntegrationId(status.pendingOAuth.id);
        setStep(3);
      } else if (status.hasCredentials) {
        // Credentials saved but OAuth not done
        setStep(2);
      }
    } catch {
      // API not available
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCredentials = async () => {
    if (!driveCreds.googleClientId || !driveCreds.googleClientSecret) return;
    setSavingCreds(true);
    try {
      await api.drive.saveCredentials(driveCreds);
      setDriveCreds((p) => ({ ...p, googleClientSecret: '' }));
      setStep(2);
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingCreds(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
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
            setPendingIntegrationId(status.pendingOAuth.id);
            setConnecting(false);
            setStep(3);
          }
        } catch { /* keep polling */ }
      }, 2000);
      setTimeout(() => {
        clearInterval(interval);
        setConnecting(false);
      }, 120000);
    } catch (err) {
      alert(err.message);
      setConnecting(false);
    }
  };

  const handleFolderSelected = async (folder) => {
    if (!pendingIntegrationId) return;
    setAddingFolder(true);
    try {
      await api.drive.addFolder({
        integrationId: pendingIntegrationId,
        folderId: folder.id,
        folderName: folder.name,
      });
      setLastAddedFolder(folder.name);
      setPendingIntegrationId(null);
      await loadStatus();
      setStep(4);
      onComplete?.();
    } catch (err) {
      alert(err.message);
    } finally {
      setAddingFolder(false);
    }
  };

  const handleAddAnotherFolder = () => {
    // Start a new OAuth flow to add another folder (credentials already saved, skip to step 2)
    setLastAddedFolder(null);
    setStep(2);
  };

  const handleDisconnect = async (integrationId, folderName) => {
    if (!confirm(`Remove "${folderName}" from watched folders? This will stop polling and remove the connection.`)) return;
    setDisconnecting(integrationId);
    try {
      await api.drive.disconnect(integrationId);
      await loadStatus();
    } catch (err) {
      alert(err.message);
    } finally {
      setDisconnecting(null);
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-400">Loading Google Drive status...</div>;
  }

  // ── Step 4: Management / Done view ──
  if (step === 4) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl shadow-lg p-8 slide-up">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center text-green-600">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Google Drive Folders</h2>
                <p className="text-sm text-gray-500">{integrations.length} folder{integrations.length !== 1 ? 's' : ''} connected</p>
              </div>
            </div>
          </div>

          {/* Success banner for just-added folder */}
          {lastAddedFolder && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
              <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-green-800">
                <strong>{lastAddedFolder}</strong> is now being watched for invoice files.
              </span>
            </div>
          )}

          {/* Connected folders list */}
          <div className="space-y-3 mb-6">
            {integrations.map((int) => (
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
                <button
                  onClick={() => handleDisconnect(int.id, int.driveFolderName || 'this folder')}
                  disabled={disconnecting === int.id}
                  className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50"
                >
                  {disconnecting === int.id ? 'Removing...' : 'Remove'}
                </button>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-100">
            <button
              onClick={onBack}
              className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition"
            >
              {icons.back}
              Back to Integrations
            </button>
            <button
              onClick={handleAddAnotherFolder}
              className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add Another Folder
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Steps 1 & 2: Connect + Select Folder ──
  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl shadow-lg p-8 slide-up">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="text-gray-400 hover:text-gray-600 transition">
            {icons.back}
          </button>
          <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center text-green-600">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Connect Google Drive</h2>
            <p className="text-sm text-gray-500">Auto-import invoices from a Drive folder</p>
          </div>
        </div>

        <StepProgress steps={DRIVE_STEPS} current={step} />

        {/* ── Step 1: Credentials ── */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <div className="flex items-start gap-2">
                {icons.shield}
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">Google Cloud Setup Required</p>
                  <p>
                    You need to create an OAuth 2.0 Client in your own Google Cloud Console.
                    This gives you full control over the credentials and permissions.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
              <input
                type="text"
                value={driveCreds.googleClientId}
                onChange={(e) => setDriveCreds((p) => ({ ...p, googleClientId: e.target.value }))}
                placeholder="123456789.apps.googleusercontent.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Client Secret</label>
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
                className="text-sm text-teal-600 hover:text-teal-700 underline"
              >
                Need help? View setup guide
              </a>
              <button
                onClick={handleSaveCredentials}
                disabled={savingCreds || !driveCreds.googleClientId || !driveCreds.googleClientSecret}
                className="px-6 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition disabled:opacity-50"
              >
                {savingCreds ? 'Saving...' : 'Save & Continue'}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Connect ── */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <div className="flex items-start gap-2">
                {icons.shield}
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">What happens next</p>
                  <p>
                    You&apos;ll be redirected to Google to sign in and grant RetailEdge
                    <strong> read-only access</strong> to your Drive files. We only read
                    files from the folder you select — nothing else is accessed or modified.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 bg-gray-50 rounded-xl">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Permissions requested</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  View files and folders in Google Drive (read-only)
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  View your email address (for display purposes)
                </li>
                <li className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span className="text-gray-400">Cannot modify, delete, or share your files</span>
                </li>
              </ul>
            </div>

            <div className="flex items-center justify-between">
              <a
                href="/drive-setup-guide.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-brand-600 hover:text-brand-700 underline"
              >
                How does this work?
              </a>
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="px-6 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition disabled:opacity-50 flex items-center gap-2"
              >
                {connecting ? (
                  <>
                    {icons.spinner}
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

        {/* ── Step 3: Select Folder ── */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
              <div className="flex items-center gap-2 text-sm text-green-800">
                <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span><strong>Connected!</strong> Now choose which folder to watch for invoice files.</span>
              </div>
            </div>

            <div className="text-center py-6">
              <p className="text-sm text-gray-600 mb-4">
                Browse your Google Drive and select the folder where your invoice PDFs and images are stored.
              </p>
              <button
                onClick={() => setShowFolderPicker(true)}
                disabled={addingFolder}
                className="px-6 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition flex items-center gap-2 mx-auto disabled:opacity-50"
              >
                {addingFolder ? (
                  <>
                    {icons.spinner}
                    Saving...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                    Browse Google Drive
                  </>
                )}
              </button>
            </div>

            <DriveFolderPicker
              isOpen={showFolderPicker}
              onClose={() => setShowFolderPicker(false)}
              onSelect={handleFolderSelected}
              integrationId={pendingIntegrationId}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Main Connect Wizard Page
   ═══════════════════════════════════════════════════════════════════ */
export default function ConnectWizard() {
  const [activeWizard, setActiveWizard] = useState(null); // { type, system }
  const [connectionStatus, setConnectionStatus] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConnectionStatuses();
  }, []);

  const loadConnectionStatuses = async () => {
    const statuses = {};
    try {
      // Check Gmail status
      const gmail = await api.gmail.getStatus();
      statuses.gmail = gmail.connected;
    } catch { /* not available */ }
    try {
      // Check folder status
      const folder = await api.folderPolling.getStatus();
      statuses.folder = folder.connected;
    } catch { /* not available */ }
    try {
      // Check Google Drive status
      const drive = await api.drive.getStatus();
      statuses['google-drive'] = drive.integrations?.length > 0;
    } catch { /* not available */ }
    try {
      // Check POS/ecommerce connections
      const connectStatus = await api.connect.getStatus();
      if (connectStatus.connections) {
        connectStatus.connections.forEach((c) => {
          statuses[c.system] = c.connected;
        });
      }
    } catch { /* not available */ }
    setConnectionStatus(statuses);
    setLoading(false);
  };

  const handleSetup = (integration) => {
    if (integration.id === 'gmail') {
      setActiveWizard({ type: 'gmail' });
    } else if (integration.id === 'google-drive') {
      setActiveWizard({ type: 'google-drive' });
    } else if (integration.id === 'folder') {
      setActiveWizard({ type: 'folder' });
    } else if (integration.id === 'csv-import') {
      setActiveWizard({ type: 'csv' });
    } else if (['square', 'lightspeed', 'shopify-pos', 'shopify'].includes(integration.id)) {
      setActiveWizard({ type: 'pos', system: integration });
    }
  };

  const handleBack = () => {
    setActiveWizard(null);
    loadConnectionStatuses();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 gap-3">
        {icons.spinner}
        <span>Loading integrations...</span>
      </div>
    );
  }

  // If a wizard is active, render it
  if (activeWizard) {
    return (
      <div className="max-w-4xl mx-auto py-6 px-6">
        {activeWizard.type === 'gmail' && (
          <GmailSetupWizard onBack={handleBack} onComplete={() => setConnectionStatus((p) => ({ ...p, gmail: true }))} />
        )}
        {activeWizard.type === 'google-drive' && (
          <GoogleDriveSetupWizard onBack={handleBack} onComplete={() => setConnectionStatus((p) => ({ ...p, 'google-drive': true }))} />
        )}
        {activeWizard.type === 'folder' && (
          <FolderSetupWizard onBack={handleBack} onComplete={() => setConnectionStatus((p) => ({ ...p, folder: true }))} />
        )}
        {activeWizard.type === 'pos' && (
          <POSSetupWizard
            system={activeWizard.system}
            onBack={handleBack}
            onComplete={() => setConnectionStatus((p) => ({ ...p, [activeWizard.system.id]: true }))}
          />
        )}
        {activeWizard.type === 'csv' && <CSVImportWizard onBack={handleBack} />}
      </div>
    );
  }

  // Main overview
  const connectedCount = Object.values(connectionStatus).filter(Boolean).length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.044a4.5 4.5 0 00-1.242-7.244l4.5-4.5a4.5 4.5 0 016.364 6.364l-1.757 1.757" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Connect Your Systems</h2>
            <p className="text-sm text-gray-500">
              {connectedCount > 0
                ? `${connectedCount} integration${connectedCount !== 1 ? 's' : ''} connected`
                : 'Set up integrations to automate your workflow'}
            </p>
          </div>
        </div>
      </div>

      {/* Pipeline Overview */}
      <div className="bg-gradient-to-r from-brand-50 to-blue-50 rounded-2xl p-6 border border-brand-200/50">
        <h3 className="text-sm font-semibold text-brand-900 uppercase tracking-wide mb-3">End-to-End Pipeline</h3>
        <div className="flex items-center justify-between">
          {[
            { emoji: '📧', label: 'Invoice Arrives', sub: 'Email or folder', connected: connectionStatus.gmail || connectionStatus.folder },
            { emoji: '🤖', label: 'AI Extracts', sub: 'OCR & parse', connected: true },
            { emoji: '🔗', label: 'AI Matches', sub: 'Products & prices', connected: true },
            { emoji: '💰', label: 'Price Recs', sub: 'AI suggestions', connected: true },
            { emoji: '📤', label: 'Push to POS', sub: 'Auto-sync', connected: connectionStatus.square || connectionStatus.lightspeed || connectionStatus['shopify-pos'] },
          ].map((step, i, arr) => (
            <div key={step.label} className="flex items-center">
              <div className="text-center">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-1 ${step.connected ? 'bg-brand-600' : 'bg-gray-200'}`}>
                  <span className={`text-lg ${step.connected ? '' : 'grayscale opacity-60'}`}>{step.emoji}</span>
                </div>
                <p className="text-xs font-medium text-gray-900">{step.label}</p>
                <p className="text-[10px] text-gray-500">{step.sub}</p>
              </div>
              {i < arr.length - 1 && (
                <div className={`w-8 h-0.5 mx-1 mb-6 ${step.connected ? 'bg-brand-400' : 'bg-gray-300'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Integration Categories */}
      {INTEGRATION_CATEGORIES.map((category) => (
        <div key={category.id}>
          <div className="mb-3">
            <h3 className="text-lg font-bold text-gray-900">{category.title}</h3>
            <p className="text-sm text-gray-500">{category.subtitle}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {category.integrations.map((integration) => (
              <IntegrationCard
                key={integration.id}
                integration={integration}
                connected={connectionStatus[integration.id]}
                onSetup={() => handleSetup(integration)}
                onManage={() => handleSetup(integration)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
