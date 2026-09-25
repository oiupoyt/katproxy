# katproxy

A sleek, minimal, high-performance proxy list stream & active TCP latency prober.

Features dark glassmorphism aesthetics, live SVG countdown timer, one-click copy suite (IP:Port, cURL, raw lists), multi-protocol filtering (HTTP, SOCKS4, SOCKS5), and live round-trip latency metrics.

---

## ⚡ Architecture

- **Backend (Android Tablet / Termux)**:
  - Aggregates thousands of proxies from premier GitHub sources (`monosans/proxy-list`, `TheSpeedX/PROXY-List`, `hookzof/socks5_list`).
  - Active background TCP socket connection tester measuring real round-trip latency (`ms`).
  - REST API running on port `5050`, tunneled via Cloudflare Tunnel as `katproxy-api.oiupoyt.space`.
- **Frontend (Cloudflare Pages)**:
  - Fast, zero-dependency static web application located in `public/`.
  - JetBrains Mono typography, smooth 60fps micro-animations, quick actions, responsive on desktop and mobile.

---

## 🚀 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health status and uptime |
| `GET` | `/api/stats` | Total proxies, verified alive count, protocol counts, avg ping |
| `GET` | `/api/proxies` | Paginated list with `protocol`, `alive`, `search`, `sort`, `country` filters |
| `POST` | `/api/refresh` | Trigger immediate upstream re-fetch and probe cycle |
| `GET` | `/api/raw` | Raw plaintext list (`ip:port` or `format=url`) for curl / bash pipelines |

### Examples

```bash
# Get 5 fastest SOCKS5 proxies
curl "https://katproxy-api.oiupoyt.space/api/proxies?protocol=socks5&alive=true&limit=5"

# Raw IP:PORT stream for CLI scripts
curl -s "https://katproxy-api.oiupoyt.space/api/raw?protocol=socks5&alive=true" | head -n 10
```

---

## 🛠 Cloudflare Pages Deployment (Frontend)

1. Connect this GitHub repository (`oiupoyt/katproxy`) to Cloudflare Pages.
2. Build Settings:
   - **Framework preset**: None
   - **Build command**: None (leave empty)
   - **Build output directory**: `public`
3. Deploy! The frontend automatically connects to `https://katproxy-api.oiupoyt.space`.

---

## 📱 Tablet Backend Setup

```bash
# On the tablet (Termux)
cd ~
git clone https://github.com/oiupoyt/katproxy.git katproxy
cd katproxy/backend
npm install
node --max-old-space-size=256 server.js
```
