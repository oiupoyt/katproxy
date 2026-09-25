/**
 * katproxy — Minimal Frontend Client
 */

// Configuration & State
const DEFAULT_API_URL = 'https://katproxy-api.oiupoyt.space';
const LOCAL_DEV_URL = 'http://localhost:5050';

const apiBase = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? LOCAL_DEV_URL
  : DEFAULT_API_URL;

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
}

/**
 * Autonomous & Interactive Particle Background (from katdrop)
 */
function initInteractiveParticles() {
  const canvas = document.getElementById('particles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });

  const pointer = {
    x: null,
    y: null,
    radius: 150
  };

  window.addEventListener('mousemove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  });

  window.addEventListener('mouseleave', () => {
    pointer.x = null;
    pointer.y = null;
  });

  window.addEventListener('touchmove', (e) => {
    if (e.touches.length > 0) {
      pointer.x = e.touches[0].clientX;
      pointer.y = e.touches[0].clientY;
    }
  }, { passive: true });

  window.addEventListener('touchend', () => {
    pointer.x = null;
    pointer.y = null;
  });

  window.addEventListener('click', (e) => {
    for (const p of particles) {
      const dx = p.x - e.clientX;
      const dy = p.y - e.clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 220 && dist > 0) {
        const force = (220 - dist) / 220;
        p.disturbVx += (dx / dist) * force * 4;
        p.disturbVy += (dy / dist) * force * 4;
      }
    }
  });

  const particles = [];
  const count = Math.min(80, Math.max(35, Math.floor(width / 20)));

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.35 + Math.random() * 0.45;
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      baseVx: Math.cos(angle) * speed,
      baseVy: Math.sin(angle) * speed,
      disturbVx: 0,
      disturbVy: 0,
      radius: Math.random() * 1.5 + 1,
      phase: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.0018 + Math.random() * 0.0025
    });
  }

  function animate(time) {
    ctx.clearRect(0, 0, width, height);

    // Connect particles to each other (constellation network)
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const distSq = dx * dx + dy * dy;
        if (distSq < 15625) { // 125px
          const dist = Math.sqrt(distSq);
          ctx.strokeStyle = `rgba(255, 255, 255, ${0.075 * (1 - dist / 125)})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }

    // Update & draw each particle
    for (const p of particles) {
      const waveX = Math.sin(time * 0.0012 + p.phase) * 0.22;
      const waveY = Math.cos(time * 0.0015 + p.phase) * 0.22;

      p.x += p.baseVx + p.disturbVx + waveX;
      p.y += p.baseVy + p.disturbVy + waveY;

      p.disturbVx *= 0.94;
      p.disturbVy *= 0.94;

      const pad = 15;
      if (p.x < -pad) p.x = width + pad;
      if (p.x > width + pad) p.x = -pad;
      if (p.y < -pad) p.y = height + pad;
      if (p.y > height + pad) p.y = -pad;

      if (pointer.x !== null && pointer.y !== null) {
        const mdx = pointer.x - p.x;
        const mdy = pointer.y - p.y;
        const mDistSq = mdx * mdx + mdy * mdy;

        if (mDistSq < pointer.radius * pointer.radius) {
          const mDist = Math.sqrt(mDistSq);
          ctx.strokeStyle = `rgba(255, 255, 255, ${0.2 * (1 - mDist / pointer.radius)})`;
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(pointer.x, pointer.y);
          ctx.stroke();

          if (mDist < 75 && mDist > 0) {
            const repel = (75 - mDist) / 75;
            p.disturbVx -= (mdx / mDist) * repel * 1.6;
            p.disturbVy -= (mdy / mDist) * repel * 1.6;
          }
        }
      }

      const alpha = 0.25 + Math.sin(time * p.twinkleSpeed + p.phase) * 0.14;
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  initInteractiveParticles();
  initEvents();
  loadStats();
  loadProxies();
  startTimerLoop();

  // Periodic stats poll every 12 seconds
  setInterval(loadStats, 12000);
});
