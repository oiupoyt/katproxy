const express = require('express');
const cors = require('cors');
const path = require('path');
const { fetchAllProxies } = require('./fetcher');
const { batchCheckProxies } = require('./checker');

const app = express();
const PORT = process.env.PORT || 5050;
const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// State
let proxyStore = [];
let lastUpdated = null;
let nextRefreshTime = null;
let isRefreshing = false;
let isChecking = false;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Optional: serve static frontend if public directory exists
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));

/**
 * Trigger full refresh cycle
 */
async function refreshCycle() {
  if (isRefreshing) return;
  isRefreshing = true;
  console.log(`[Server] Starting auto-refresh at ${new Date().toISOString()}`);

  try {
    const rawList = await fetchAllProxies();
    if (rawList && rawList.length > 0) {
      proxyStore = rawList;
      lastUpdated = Date.now();
      nextRefreshTime = Date.now() + REFRESH_INTERVAL_MS;
      console.log(`[Server] Aggregated ${proxyStore.length} proxies successfully.`);

      // Launch background latency checker on the first batch of proxies
      // Check high-priority proxies (e.g. up to 300) without hogging CPU/sockets
      probeTopProxiesInBackground();
    }
  } catch (err) {
    console.error('[Server] Refresh cycle error:', err);
  } finally {
    isRefreshing = false;
  }
}

/**
 * Background latency verification pool
 */
async function probeTopProxiesInBackground() {
  if (isChecking || proxyStore.length === 0) return;
  isChecking = true;
  console.log('[Server] Starting background TCP latency verification...');

  try {
    // Select top 300 proxies to probe (or all if fewer)
    const targetProxies = proxyStore.slice(0, 350);
    await batchCheckProxies(targetProxies, 40, 2000, (completed, total) => {
      if (completed % 100 === 0 || completed === total) {
        console.log(`[Checker] Latency probe progress: ${completed}/${total}`);
      }
    });
    console.log('[Checker] Latency probing completed.');
  } catch (err) {
    console.error('[Checker] Latency probing error:', err);
  } finally {
    isChecking = false;
  }
}

// Routes

// 1. Health
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'katproxy-backend',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// 2. Stats
app.get('/api/stats', (req, res) => {
  const total = proxyStore.length;
  const aliveList = proxyStore.filter(p => p.alive === true);
  
  const protocols = { http: 0, socks4: 0, socks5: 0 };
  const countryCounts = {};

  for (const p of proxyStore) {
    for (const proto of p.protocols) {
      if (protocols[proto] !== undefined) protocols[proto]++;
    }
    const c = p.country || 'UN';
    countryCounts[c] = (countryCounts[c] || 0) + 1;
  }

  // Top 10 countries
  const topCountries = Object.entries(countryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([country, count]) => ({ country, count }));

  // Average latency of alive proxies
  const latencies = aliveList.filter(p => p.latency != null).map(p => p.latency);
  const avgLatency = latencies.length > 0 
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) 
    : 0;

  res.json({
    total,
    aliveCount: aliveList.length,
    protocols,
    topCountries,
    avgLatency,
    lastUpdated,
    nextRefreshTime,
    remainingSeconds: nextRefreshTime ? Math.max(0, Math.round((nextRefreshTime - Date.now()) / 1000)) : 0,
    isRefreshing,
    isChecking
  });
});

// 3. Proxies list with filter, search, sort, pagination
app.get('/api/proxies', (req, res) => {
  let {
    protocol,
    country,
    alive,
    maxLatency,
    search,
    sort = 'latency_asc',
    limit = 100,
    page = 1
  } = req.query;

  limit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 1000);
  page = Math.max(parseInt(page, 10) || 1, 1);

  let results = proxyStore;

  // Filter: protocol
  if (protocol && protocol !== 'all') {
    const protoLower = protocol.toLowerCase();
    results = results.filter(p => p.protocols.includes(protoLower));
  }

  // Filter: country
  if (country && country !== 'all') {
    const countryUpper = country.toUpperCase();
    results = results.filter(p => p.country === countryUpper);
  }

  // Filter: alive
  if (alive === 'true') {
    results = results.filter(p => p.alive === true);
  } else if (alive === 'false') {
    results = results.filter(p => p.alive === false);
  }

  // Filter: max latency
  if (maxLatency) {
    const maxMs = parseInt(maxLatency, 10);
    if (!isNaN(maxMs)) {
      results = results.filter(p => p.latency != null && p.latency <= maxMs);
    }
  }

  // Filter: search query (IP, port, country name, org, city)
  if (search && typeof search === 'string' && search.trim()) {
    const q = search.trim().toLowerCase();
    results = results.filter(p => 
      p.host.includes(q) ||
      String(p.port).includes(q) ||
      p.country.toLowerCase().includes(q) ||
      (p.countryName && p.countryName.toLowerCase().includes(q)) ||
      (p.org && p.org.toLowerCase().includes(q)) ||
      (p.city && p.city.toLowerCase().includes(q))
    );
  }

  // Sort
  results = results.slice().sort((a, b) => {
    if (sort === 'latency_asc') {
      const latA = a.latency != null ? a.latency : 999999;
      const latB = b.latency != null ? b.latency : 999999;
      return latA - latB;
    }
    if (sort === 'latency_desc') {
      const latA = a.latency != null ? a.latency : -1;
      const latB = b.latency != null ? b.latency : -1;
      return latB - latA;
    }
    if (sort === 'country') {
      return (a.country || '').localeCompare(b.country || '');
    }
    if (sort === 'port') {
      return a.port - b.port;
    }
    return 0;
  });

  const totalMatches = results.length;
  const startIndex = (page - 1) * limit;
  const paginated = results.slice(startIndex, startIndex + limit);

  res.json({
    total: totalMatches,
    page,
    limit,
    totalPages: Math.ceil(totalMatches / limit),
    proxies: paginated
  });
});

// 4. Manual Refresh Trigger
app.post('/api/refresh', async (req, res) => {
  if (isRefreshing) {
    return res.status(429).json({ error: 'Refresh already in progress' });
  }
  refreshCycle().catch(console.error);
  res.json({ success: true, message: 'Proxy aggregation started in background' });
});

// 5. Raw Text Export (for curl / bash scripts)
app.get('/api/raw', (req, res) => {
  const { protocol, alive, format } = req.query;
  let results = proxyStore;

  if (protocol && protocol !== 'all') {
    results = results.filter(p => p.protocols.includes(protocol.toLowerCase()));
  }
  if (alive === 'true') {
    results = results.filter(p => p.alive === true);
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  if (format === 'url') {
    const lines = results.map(p => {
      const proto = p.protocols[0] || 'http';
      return `${proto}://${p.host}:${p.port}`;
    });
    return res.send(lines.join('\n'));
  }

  // Default: IP:PORT
  const lines = results.map(p => `${p.host}:${p.port}`);
  res.send(lines.join('\n'));
});

// Fallback for spa / static index if accessed directly
app.get('*', (req, res, next) => {
  if (req.accepts('html')) {
    return res.sendFile(path.join(publicDir, 'index.html'), (err) => {
      if (err) res.status(404).send('KatProxy API Server is running.');
    });
  }
  next();
});

// Start server and launch initial fetch
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] katproxy backend listening on http://0.0.0.0:${PORT}`);
  refreshCycle();
  setInterval(refreshCycle, REFRESH_INTERVAL_MS);
});
