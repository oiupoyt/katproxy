const https = require('https');
const http = require('http');

/**
 * Helper to fetch text or JSON over HTTPS with timeout
 */
function fetchUrl(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'katproxy/1.0' } }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`Failed to fetch ${url}, status: ${res.statusCode}`));
      }
      let rawData = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => resolve(rawData));
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

/**
 * Fetch and merge proxies from multiple premier GitHub repositories
 */
async function fetchAllProxies() {
  console.log('[Fetcher] Starting proxy list aggregation...');
  const proxyMap = new Map();

  // Helper to add or merge a proxy
  function addProxy(host, port, protocol, extra = {}) {
    if (!host || !port) return;
    const cleanHost = String(host).trim();
    const cleanPort = parseInt(port, 10);
    if (isNaN(cleanPort) || cleanPort <= 0 || cleanPort > 65535) return;
    // Basic IP validation regex
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(cleanHost)) return;

    const key = `${cleanHost}:${cleanPort}`;
    const existing = proxyMap.get(key);

    const protoClean = (protocol || 'http').toLowerCase();

    if (!existing) {
      proxyMap.set(key, {
        id: key,
        host: cleanHost,
        port: cleanPort,
        protocols: [protoClean],
        country: (extra.country || 'UN').toUpperCase(),
        countryName: extra.countryName || 'Unknown',
        city: extra.city || '',
        org: extra.org || '',
        latency: extra.latency != null ? Math.round(extra.latency * 1000) : null,
        alive: extra.alive !== undefined ? extra.alive : null,
        lastChecked: extra.lastChecked || null,
        sources: [extra.source || 'upstream']
      });
    } else {
      if (!existing.protocols.includes(protoClean)) {
        existing.protocols.push(protoClean);
      }
      if (existing.country === 'UN' && extra.country) {
        existing.country = extra.country.toUpperCase();
        existing.countryName = extra.countryName || existing.countryName;
      }
      if (!existing.org && extra.org) {
        existing.org = extra.org;
      }
      if (extra.source && !existing.sources.includes(extra.source)) {
        existing.sources.push(extra.source);
      }
    }
  }

  // 1. Fetch monosans structured JSON (provides rich metadata: country, org, timeout)
  try {
    console.log('[Fetcher] Fetching monosans/proxy-list JSON...');
    const monosansData = await fetchUrl('https://raw.githubusercontent.com/monosans/proxy-list/main/proxies.json', 15000);
    const parsed = JSON.parse(monosansData);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const countryCode = item.geolocation?.country?.iso_code || 'UN';
        const countryName = item.geolocation?.country?.names?.en || 'Unknown';
        const city = item.geolocation?.city?.names?.en || '';
        const org = item.asn?.autonomous_system_organization || '';
        const latencyMs = item.timeout ? Math.round(item.timeout * 1000) : null;

        addProxy(item.host, item.port, item.protocol, {
          country: countryCode,
          countryName,
          city,
          org,
          latency: item.timeout != null ? item.timeout : null,
          alive: true,
          source: 'monosans'
        });
      }
      console.log(`[Fetcher] monosans parsed: ${parsed.length} proxies`);
    }
  } catch (err) {
    console.warn('[Fetcher] Warning: monosans JSON fetch failed:', err.message);
  }

  // 2. TheSpeedX lists (HTTP, SOCKS4, SOCKS5)
  const speedXTasks = [
    { url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt', protocol: 'http' },
    { url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt', protocol: 'socks4' },
    { url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt', protocol: 'socks5' }
  ];

  await Promise.allSettled(
    speedXTasks.map(async (task) => {
      try {
        const text = await fetchUrl(task.url);
        const lines = text.split('\n');
        let count = 0;
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const [host, port] = trimmed.split(':');
          if (host && port) {
            addProxy(host, port, task.protocol, { source: 'thespeedx' });
            count++;
          }
        }
        console.log(`[Fetcher] TheSpeedX ${task.protocol} parsed: ${count} proxies`);
      } catch (err) {
        console.warn(`[Fetcher] TheSpeedX ${task.protocol} error:`, err.message);
      }
    })
  );

  // 3. hookzof SOCKS5 list
  try {
    const hookzofText = await fetchUrl('https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt');
    const lines = hookzofText.split('\n');
    let count = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [host, port] = trimmed.split(':');
      if (host && port) {
        addProxy(host, port, 'socks5', { source: 'hookzof' });
        count++;
      }
    }
    console.log(`[Fetcher] hookzof SOCKS5 parsed: ${count} proxies`);
  } catch (err) {
    console.warn('[Fetcher] hookzof SOCKS5 error:', err.message);
  }

  const results = Array.from(proxyMap.values());
  console.log(`[Fetcher] Completed aggregation. Total unique proxies: ${results.length}`);
  return results;
}

module.exports = {
  fetchAllProxies
};
