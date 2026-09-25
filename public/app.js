/**
 * katproxy — Minimal Frontend Client
 */

// Configuration & State
const DEFAULT_TUNNEL_URL = 'https://katproxy-api.oiupoyt.space';
const LOCAL_DEV_URL = 'http://localhost:5050';

let apiBase = localStorage.getItem('katproxy_api_url') || (
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? LOCAL_DEV_URL 
    : DEFAULT_TUNNEL_URL
);

const state = {
  protocol: 'all',
  aliveOnly: true,
  search: '',
  sort: 'latency_asc',
  page: 1,
  limit: 60,
  totalPages: 1,
  totalProxies: 0,
  proxies: [],
  timerInterval: null,
  nextRefreshSeconds: 0,
  refreshTotalDuration: 900 // 15 mins default
};

// DOM Elements
const el = {
  statTotal: document.getElementById('stat-total'),
  statAlive: document.getElementById('stat-alive'),
  statLatency: document.getElementById('stat-latency'),
  timerText: document.getElementById('timer-text'),
  progressCircle: document.getElementById('progress-circle'),
  btnManualRefresh: document.getElementById('btn-manual-refresh'),
  btnSettings: document.getElementById('btn-settings'),
  protocolFilters: document.getElementById('protocol-filters'),
  toggleAlive: document.getElementById('toggle-alive'),
  searchInput: document.getElementById('search-input'),
  searchClear: document.getElementById('search-clear'),
  sortSelect: document.getElementById('sort-select'),
  btnCopyAll: document.getElementById('btn-copy-all'),
  btnExportTxt: document.getElementById('btn-export-txt'),
  resultsCount: document.getElementById('results-count'),
  checkingIndicator: document.getElementById('checking-indicator'),
  proxyGrid: document.getElementById('proxy-grid'),
  emptyState: document.getElementById('empty-state'),
  btnResetFilters: document.getElementById('btn-reset-filters'),
  paginationBar: document.getElementById('pagination-bar'),
  btnPrev: document.getElementById('btn-prev'),
  btnNext: document.getElementById('btn-next'),
  pageIndicator: document.getElementById('page-indicator'),
  linkRawApi: document.getElementById('link-raw-api'),
  settingsModal: document.getElementById('settings-modal'),
  modalClose: document.getElementById('modal-close'),
  modalCancel: document.getElementById('modal-cancel'),
  modalSave: document.getElementById('modal-save'),
  apiUrlInput: document.getElementById('api-url-input'),
  toastContainer: document.getElementById('toast-container')
};

// SVG Circle circumference: 2 * Math.PI * 6 ≈ 37.7
const CIRCUMFERENCE = 37.7;

/**
 * Toast Notification Helper
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span class="toast-dot"></span><span>${escapeHtml(message)}</span>`;
  el.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 250);
  }, 2400);
}

/**
 * HTML Escaper
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}

/**
 * Convert 2-letter ISO country code to Emoji Flag
 */
function getCountryFlag(countryCode) {
  if (!countryCode || countryCode === 'UN' || countryCode.length !== 2) return '🌐';
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(c => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

/**
 * Fetch System Statistics
 */
async function loadStats() {
  try {
    const res = await fetch(`${apiBase}/api/stats`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    el.statTotal.textContent = data.total?.toLocaleString() || '0';
    el.statAlive.textContent = data.aliveCount?.toLocaleString() || '0';
    el.statLatency.textContent = data.avgLatency ? `${data.avgLatency}ms` : '—';

    if (data.isChecking) {
      el.checkingIndicator.classList.remove('hidden');
    } else {
      el.checkingIndicator.classList.add('hidden');
    }

    if (data.remainingSeconds != null) {
      state.nextRefreshSeconds = data.remainingSeconds;
      updateTimerDisplay();
    }

    // Update Raw API link
    el.linkRawApi.href = `${apiBase}/api/raw`;
  } catch (err) {
    console.warn('[katproxy] Could not fetch stats:', err.message);
    el.statTotal.textContent = 'Err';
    el.statAlive.textContent = 'Err';
  }
}

/**
 * Update Timer UI
 */
function updateTimerDisplay() {
  const s = Math.max(0, state.nextRefreshSeconds);
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  el.timerText.textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

  const ratio = Math.min(1, Math.max(0, s / state.refreshTotalDuration));
  const offset = CIRCUMFERENCE - (ratio * CIRCUMFERENCE);
  el.progressCircle.style.strokeDashoffset = offset;
}

/**
 * Start Local Timer Countdown
 */
function startTimerLoop() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    if (state.nextRefreshSeconds > 0) {
      state.nextRefreshSeconds--;
      updateTimerDisplay();
    } else {
      loadStats();
      loadProxies();
    }
  }, 1000);
}

/**
 * Load Proxies from Backend
 */
async function loadProxies() {
  el.resultsCount.textContent = 'Fetching proxies...';

  const params = new URLSearchParams({
    page: state.page,
    limit: state.limit,
    sort: state.sort
  });

  if (state.protocol !== 'all') {
    params.set('protocol', state.protocol);
  }
  if (state.aliveOnly) {
    params.set('alive', 'true');
  }
  if (state.search.trim()) {
    params.set('search', state.search.trim());
  }

  try {
    const res = await fetch(`${apiBase}/api/proxies?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    state.proxies = data.proxies || [];
    state.totalProxies = data.total || 0;
    state.totalPages = data.totalPages || 1;

    renderProxies();
  } catch (err) {
    console.error('[katproxy] Load proxies failed:', err);
    el.resultsCount.textContent = `Backend connection error (${err.message})`;
    el.proxyGrid.innerHTML = '';
    el.emptyState.classList.remove('hidden');
    el.paginationBar.classList.add('hidden');
  }
}

/**
 * Render Proxies Grid
 */
function renderProxies() {
  el.proxyGrid.innerHTML = '';

  if (state.proxies.length === 0) {
    el.emptyState.classList.remove('hidden');
    el.paginationBar.classList.add('hidden');
    el.resultsCount.textContent = '0 matching proxies';
    return;
  }

  el.emptyState.classList.add('hidden');
  el.paginationBar.classList.remove('hidden');
  el.resultsCount.textContent = `Showing ${(state.page - 1) * state.limit + 1}–${Math.min(state.page * state.limit, state.totalProxies)} of ${state.totalProxies.toLocaleString()} proxies`;

  el.pageIndicator.textContent = `Page ${state.page} of ${state.totalPages}`;
  el.btnPrev.disabled = state.page <= 1;
  el.btnNext.disabled = state.page >= state.totalPages;

  const fragment = document.createDocumentFragment();

  for (const proxy of state.proxies) {
    const card = document.createElement('div');
    card.className = 'proxy-card';

    // Latency badge class & display
    let latencyClass = 'latency-slow';
    let latencyText = 'untested';
    if (proxy.latency != null) {
      if (proxy.latency < 200) latencyClass = 'latency-fast';
      else if (proxy.latency < 600) latencyClass = 'latency-med';
      latencyText = `${proxy.latency} ms`;
    }

    // Protocol pills
    const protoPills = proxy.protocols.map(p => 
      `<span class="proto-tag proto-${p.toLowerCase()}">${p.toUpperCase()}</span>`
    ).join(' ');

    const flag = getCountryFlag(proxy.country);
    const countryName = proxy.countryName && proxy.countryName !== 'Unknown' 
      ? proxy.countryName 
      : (proxy.country || 'Global');

    const orgInfo = proxy.org ? escapeHtml(proxy.org) : (proxy.city ? escapeHtml(proxy.city) : 'Public Node');

    card.innerHTML = `
      <div class="card-top">
        <div class="endpoint-group">
          <span class="ip-text">${escapeHtml(proxy.host)}</span>
          <span class="port-text">:${proxy.port}</span>
        </div>
        <button class="copy-hint-btn" title="Click to copy host:port">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        </button>
      </div>

      <div class="card-middle">
        <div class="badge-row">
          ${protoPills}
        </div>
        <div class="latency-badge ${latencyClass}" title="TCP connect ping">
          <span class="latency-dot"></span>
          <span>${latencyText}</span>
        </div>
      </div>

      <div class="card-bottom">
        <div class="geo-info" title="${escapeHtml(countryName)} • ${orgInfo}">
          <span class="country-flag">${flag}</span>
          <span>${escapeHtml(countryName)}</span>
        </div>
        <div class="card-actions-quick">
          <button class="quick-action-link btn-curl" title="Copy cURL syntax">cURL</button>
          <button class="quick-action-link btn-proxy-url" title="Copy URL format">URL</button>
        </div>
      </div>
    `;

    // Click on card body -> copy IP:Port
    card.addEventListener('click', (e) => {
      if (e.target.closest('.quick-action-link')) return;
      copyToClipboard(`${proxy.host}:${proxy.port}`, `Copied ${proxy.host}:${proxy.port}`);
    });

    // Copy cURL
    const btnCurl = card.querySelector('.btn-curl');
    btnCurl.addEventListener('click', (e) => {
      e.stopPropagation();
      const proto = proxy.protocols[0] || 'http';
      const cmd = `curl -x ${proto}://${proxy.host}:${proxy.port} https://ifconfig.me`;
      copyToClipboard(cmd, `Copied cURL command for ${proxy.host}:${proxy.port}`);
    });

    // Copy URL
    const btnUrl = card.querySelector('.btn-proxy-url');
    btnUrl.addEventListener('click', (e) => {
      e.stopPropagation();
      const proto = proxy.protocols[0] || 'http';
      const url = `${proto}://${proxy.host}:${proxy.port}`;
      copyToClipboard(url, `Copied ${url}`);
    });

    fragment.appendChild(card);
  }

  el.proxyGrid.appendChild(fragment);
}

/**
 * Clipboard Copy Helper
 */
async function copyToClipboard(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch (err) {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast(successMessage);
  }
}

/**
 * Event Handlers Setup
 */
function initEvents() {
  // Protocol Filter Pills
  el.protocolFilters.addEventListener('click', (e) => {
    const btn = e.target.closest('.pill-btn');
    if (!btn) return;
    el.protocolFilters.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.protocol = btn.dataset.protocol;
    state.page = 1;
    loadProxies();
  });

  // Alive Toggle
  el.toggleAlive.addEventListener('change', (e) => {
    state.aliveOnly = e.target.checked;
    state.page = 1;
    loadProxies();
  });

  // Debounced Search Input
  let searchTimer = null;
  el.searchInput.addEventListener('input', (e) => {
    const val = e.target.value;
    if (val) {
      el.searchClear.classList.remove('hidden');
    } else {
      el.searchClear.classList.add('hidden');
    }
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = val;
      state.page = 1;
      loadProxies();
    }, 280);
  });

  // Search Clear Button
  el.searchClear.addEventListener('click', () => {
    el.searchInput.value = '';
    el.searchClear.classList.add('hidden');
    state.search = '';
    state.page = 1;
    loadProxies();
  });

  // Sort Select
  el.sortSelect.addEventListener('change', (e) => {
    state.sort = e.target.value;
    state.page = 1;
    loadProxies();
  });

  // Copy Visible Proxies
  el.btnCopyAll.addEventListener('click', () => {
    if (state.proxies.length === 0) {
      showToast('No proxies to copy');
      return;
    }
    const lines = state.proxies.map(p => `${p.host}:${p.port}`).join('\n');
    copyToClipboard(lines, `Copied ${state.proxies.length} proxies to clipboard`);
  });

  // Export TXT
  el.btnExportTxt.addEventListener('click', () => {
    if (state.proxies.length === 0) {
      showToast('No proxies to export');
      return;
    }
    const lines = state.proxies.map(p => `${p.host}:${p.port}`).join('\n');
    const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `katproxy-${state.protocol}-${Date.now()}.txt`;
    link.click();
    showToast(`Exported ${state.proxies.length} proxies to file`);
  });

  // Manual Upstream Refresh Trigger
  el.btnManualRefresh.addEventListener('click', async () => {
    el.btnManualRefresh.classList.add('spinning');
    showToast('Triggering upstream proxy refresh...');
    try {
      const res = await fetch(`${apiBase}/api/refresh`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || 'Refresh initiated');
      } else {
        showToast(data.error || 'Refresh already running');
      }
      setTimeout(() => {
        loadStats();
        loadProxies();
        el.btnManualRefresh.classList.remove('spinning');
      }, 2000);
    } catch (err) {
      showToast(`Refresh error: ${err.message}`);
      el.btnManualRefresh.classList.remove('spinning');
    }
  });

  // Reset Filters Button
  el.btnResetFilters.addEventListener('click', () => {
    state.protocol = 'all';
    state.aliveOnly = false;
    state.search = '';
    state.page = 1;
    el.searchInput.value = '';
    el.toggleAlive.checked = false;
    el.protocolFilters.querySelectorAll('.pill-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.protocol === 'all');
    });
    loadProxies();
  });

  // Pagination
  el.btnPrev.addEventListener('click', () => {
    if (state.page > 1) {
      state.page--;
      loadProxies();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  el.btnNext.addEventListener('click', () => {
    if (state.page < state.totalPages) {
      state.page++;
      loadProxies();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  // Settings Modal
  el.btnSettings.addEventListener('click', () => {
    el.apiUrlInput.value = apiBase;
    el.settingsModal.classList.remove('hidden');
  });

  el.modalClose.addEventListener('click', () => el.settingsModal.classList.add('hidden'));
  el.modalCancel.addEventListener('click', () => el.settingsModal.classList.add('hidden'));

  // Quick preset buttons in modal
  el.settingsModal.querySelectorAll('.quick-endpoints button').forEach(btn => {
    btn.addEventListener('click', () => {
      el.apiUrlInput.value = btn.dataset.url;
    });
  });

  el.modalSave.addEventListener('click', () => {
    const newUrl = el.apiUrlInput.value.trim().replace(/\/+$/, '');
    if (newUrl) {
      apiBase = newUrl;
      localStorage.setItem('katproxy_api_url', newUrl);
      showToast(`API endpoint updated to ${newUrl}`);
      el.settingsModal.classList.add('hidden');
      loadStats();
      loadProxies();
    }
  });
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  initEvents();
  loadStats();
  loadProxies();
  startTimerLoop();

  // Periodic stats poll every 12 seconds
  setInterval(loadStats, 12000);
});
