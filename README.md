# katproxy

Minimal proxy list aggregator and live TCP latency prober.

- **Frontend**: [katproxy.oiupoyt.space](https://katproxy.oiupoyt.space)
- **Backend API**: [katproxy-api.oiupoyt.space](https://katproxy-api.oiupoyt.space)

---

## Overview

katproxy collects proxies from multiple public repositories (`monosans/proxy-list`, `TheSpeedX/PROXY-List`, `hookzof/socks5_list`), normalizes them, and runs concurrent TCP socket checks to verify responsiveness and record round-trip latency.

The backend runs as a lightweight daemon on an Android tablet (Termux) exposed via Cloudflare Tunnel. The frontend is a static web app hosted on Cloudflare Pages.

---

## API Reference

Base URL: `https://katproxy-api.oiupoyt.space`

| Method | Endpoint | Parameters | Description |
|---|---|---|---|
| `GET` | `/api/health` | — | Service uptime and status |
| `GET` | `/api/stats` | — | Total count, alive count, protocol breakdown, avg latency |
| `GET` | `/api/proxies` | `protocol`, `alive`, `search`, `sort`, `limit`, `page` | Filtered and paginated proxy list |
| `GET` | `/api/raw` | `protocol`, `alive`, `format` (`ip:port` or `url`) | Plaintext list for shell scripts and curl |
| `POST` | `/api/refresh` | — | Trigger upstream re-fetch and verification cycle |

### Usage Examples

```bash
# Fetch fastest alive SOCKS5 proxies
curl "https://katproxy-api.oiupoyt.space/api/proxies?protocol=socks5&alive=true&limit=10"

# Stream raw IP:PORT pairs
curl -s "https://katproxy-api.oiupoyt.space/api/raw?protocol=socks5&alive=true"
```

---

## Architecture

- **Backend (`/backend`)**: Node.js service running on port `5050` with controlled memory allocation (`--max-old-space-size=256`). Includes background socket prober and auto-refresh worker.
- **Frontend (`/public`)**: Vanilla JavaScript, CSS, and HTML with JetBrains Mono typography, auto-refresh countdown, and one-click copy actions.
- **Tunnel**: Managed by `cloudflared` routing `katproxy-api.oiupoyt.space` to `localhost:5050`.

---

## Tablet Service Management

```bash
# Check status and recent logs
~/katproxy-backend/status.sh

# Start or restart daemon
~/katproxy-backend/start.sh

# Stop daemon
~/katproxy-backend/stop.sh
```

---

## License

MIT
