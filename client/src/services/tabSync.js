/**
 * TabSyncService — Multi-tab detection with conditional polling.
 *
 * Uses BroadcastChannel for cross-tab communication:
 * - Heartbeats detect when multiple tabs are open
 * - Data change notifications alert other tabs immediately
 * - Conditional polling kicks in only when multi-tab + sensitive screen
 *
 * Graceful degradation: if BroadcastChannel is unsupported, multi-tab
 * detection is disabled. Server-side dataVersion checks still protect.
 */

import { api } from './api';

const CHANNEL_NAME = 'retailedge_tab_sync';
const HEARTBEAT_INTERVAL = 30_000; // 30 seconds
const STALE_TAB_TIMEOUT = 60_000;  // 2 missed heartbeats = tab gone
const POLL_INTERVAL = 60_000;      // 60 seconds when polling is active

function generateTabId() {
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

class TabSyncService {
  constructor() {
    this.tabId = generateTabId();
    this.otherTabs = new Map(); // tabId → lastHeartbeat timestamp
    this.channel = null;
    this.heartbeatTimer = null;
    this.cleanupTimer = null;
    this.pollTimer = null;
    this.isMultiTab = false;
    this.sensitiveScreen = null; // { screen, invoiceId, dataVersion }
    this.onStaleData = null;     // callback when stale data detected
    this._boundBeforeUnload = null;
    this._boundVisibilityChange = null;

    this._init();
  }

  _init() {
    if (typeof BroadcastChannel === 'undefined') return; // graceful degradation

    try {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (e) => this._handleMessage(e.data);
    } catch {
      return; // browser blocked BroadcastChannel
    }

    // Start heartbeat
    this._sendHeartbeat();
    this.heartbeatTimer = setInterval(() => this._sendHeartbeat(), HEARTBEAT_INTERVAL);

    // Cleanup stale tabs every 30s
    this.cleanupTimer = setInterval(() => this._cleanupStaleTabs(), HEARTBEAT_INTERVAL);

    // Notify on tab close
    this._boundBeforeUnload = () => this._sendMessage('closing', { tabId: this.tabId });
    window.addEventListener('beforeunload', this._boundBeforeUnload);

    // Pause/resume polling on visibility change
    this._boundVisibilityChange = () => this._onVisibilityChange();
    document.addEventListener('visibilitychange', this._boundVisibilityChange);
  }

  _sendMessage(type, data = {}) {
    if (!this.channel) return;
    try {
      this.channel.postMessage({ type, tabId: this.tabId, ...data });
    } catch {
      // Channel may be closed
    }
  }

  _sendHeartbeat() {
    this._sendMessage('heartbeat');
  }

  _handleMessage(msg) {
    if (msg.tabId === this.tabId) return; // ignore own messages

    switch (msg.type) {
      case 'heartbeat':
        this.otherTabs.set(msg.tabId, Date.now());
        this._updateMultiTabState();
        break;

      case 'closing':
        this.otherTabs.delete(msg.tabId);
        this._updateMultiTabState();
        break;

      case 'data_changed':
        // Another tab made a mutation — check if it affects our screen
        if (this.sensitiveScreen && this.onStaleData) {
          if (this.sensitiveScreen.screen === msg.screen || !msg.screen) {
            this.onStaleData();
          }
        }
        break;
    }
  }

  _cleanupStaleTabs() {
    const now = Date.now();
    for (const [tabId, lastSeen] of this.otherTabs) {
      if (now - lastSeen > STALE_TAB_TIMEOUT) {
        this.otherTabs.delete(tabId);
      }
    }
    this._updateMultiTabState();
  }

  _updateMultiTabState() {
    const wasMulti = this.isMultiTab;
    this.isMultiTab = this.otherTabs.size > 0;

    if (this.isMultiTab && !wasMulti) {
      this._startPollingIfNeeded();
    } else if (!this.isMultiTab && wasMulti) {
      this._stopPolling();
    }
  }

  _onVisibilityChange() {
    if (document.hidden) {
      this._stopPolling();
    } else if (this.isMultiTab && this.sensitiveScreen) {
      this._startPollingIfNeeded();
    }
  }

  _startPollingIfNeeded() {
    if (!this.isMultiTab || !this.sensitiveScreen || document.hidden) return;
    if (this.pollTimer) return; // already polling

    this.pollTimer = setInterval(() => this._pollDataVersion(), POLL_INTERVAL);
  }

  _stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async _pollDataVersion() {
    if (!this.sensitiveScreen) return;

    try {
      const params = { screen: this.sensitiveScreen.screen };
      if (this.sensitiveScreen.invoiceId) params.invoiceId = this.sensitiveScreen.invoiceId;

      const qs = new URLSearchParams(params).toString();
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/invoices/data-version?${qs}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;

      const { dataVersion } = await res.json();
      if (dataVersion && this.sensitiveScreen.dataVersion && dataVersion !== this.sensitiveScreen.dataVersion) {
        if (this.onStaleData) this.onStaleData();
      }
    } catch {
      // Poll failure is silent — server-side checks are the safety net
    }
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Register the current screen as sensitive (enables polling when multi-tab).
   * @param {string} screen - Screen name (invoice_detail, export)
   * @param {string} dataVersion - The dataVersion loaded with the screen data
   * @param {object} [opts] - Additional params (e.g. { invoiceId })
   */
  setSensitiveScreen(screen, dataVersion, opts = {}) {
    this.sensitiveScreen = { screen, dataVersion, ...opts };
    this._startPollingIfNeeded();
  }

  /**
   * Clear the sensitive screen registration (on unmount).
   */
  clearSensitiveScreen() {
    this.sensitiveScreen = null;
    this._stopPolling();
  }

  /**
   * Update the stored dataVersion (after a successful mutation).
   */
  updateDataVersion(newDataVersion) {
    if (this.sensitiveScreen) {
      this.sensitiveScreen.dataVersion = newDataVersion;
    }
  }

  /**
   * Broadcast that data has changed (after a successful mutation).
   * Other tabs receive this immediately and show the stale banner.
   * @param {string} screen - Which screen's data changed
   * @param {string} newDataVersion - The new dataVersion
   */
  notifyDataChanged(screen, newDataVersion) {
    this.updateDataVersion(newDataVersion);
    this._sendMessage('data_changed', { screen, dataVersion: newDataVersion });
  }

  /**
   * Tear down the service (cleanup timers, channel, listeners).
   */
  destroy() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this._stopPolling();
    if (this._boundBeforeUnload) window.removeEventListener('beforeunload', this._boundBeforeUnload);
    if (this._boundVisibilityChange) document.removeEventListener('visibilitychange', this._boundVisibilityChange);
    if (this.channel) {
      try { this.channel.close(); } catch {}
    }
  }
}

// Singleton — one instance per tab
const tabSync = new TabSyncService();
export default tabSync;
