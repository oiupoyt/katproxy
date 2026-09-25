const net = require('net');

/**
 * Probe a single proxy host:port via TCP socket to check if open and measure round-trip latency (ms)
 */
function probeProxy(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();

    let resolved = false;
    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setTimeout(timeoutMs);

    socket.connect(port, host, () => {
      if (!resolved) {
        resolved = true;
        const latency = Date.now() - startTime;
        cleanup();
        resolve({ alive: true, latency });
      }
    });

    socket.on('timeout', () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({ alive: false, latency: null, reason: 'timeout' });
      }
    });

    socket.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({ alive: false, latency: null, reason: err.code || 'error' });
      }
    });
  });
}

/**
 * Check a batch of proxies with concurrency limit
 */
async function batchCheckProxies(proxies, concurrency = 50, timeoutMs = 2000, onProgress = null) {
  let index = 0;
  let active = 0;
  let completed = 0;
  const total = proxies.length;

  return new Promise((resolve) => {
    if (total === 0) return resolve();

    function next() {
      while (active < concurrency && index < total) {
        const currentIndex = index++;
        const proxy = proxies[currentIndex];
        active++;

        probeProxy(proxy.host, proxy.port, timeoutMs).then((res) => {
          proxy.alive = res.alive;
          if (res.alive) {
            proxy.latency = res.latency;
          }
          proxy.lastChecked = Date.now();
          active--;
          completed++;

          if (onProgress && completed % 25 === 0) {
            onProgress(completed, total);
          }

          if (completed === total) {
            resolve();
          } else {
            next();
          }
        });
      }
    }

    next();
  });
}

module.exports = {
  probeProxy,
  batchCheckProxies
};
