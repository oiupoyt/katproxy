# katproxy

minimal proxy list aggregator and live TCP latency prober.

↗ [katproxy.oiupoyt.space](https://katproxy.oiupoyt.space)

## features

- autofetches public proxy lists from multiple upstream sources
- concurrent non-blocking TCP socket prober measuring live round-trip latency
- clean, square brutalist dark interface with interactive constellation background
- protocol filters (HTTP, HTTPS, SOCKS4, SOCKS5)
- instant search, sort by latency, and alive-only filter
- one-click copy for `host:port`, cURL commands, and proxy URLs
- export full proxy lists as `.txt` or copy all visible to clipboard
- auto-refresh timer loop with manual re-probe trigger

## backend (rust)

```bash
cd backend

# run in development
cargo run

# or run optimized release
cargo run --release
```

Environment variables:
- `PORT` (default: `5050`)
- `HOST` (default: `0.0.0.0`)

## license

MIT
