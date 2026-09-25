#!/data/data/com.termux/files/usr/bin/bash
cd "$(dirname "$0")"

/data/data/com.termux/files/usr/bin/termux-wake-lock 2>/dev/null || true

if [ -f katproxy.pid ]; then
  kill $(cat katproxy.pid) 2>/dev/null || true
  rm -f katproxy.pid
fi
sleep 0.5

if [ -f katproxy.log ]; then
  tail -n 200 katproxy.log > katproxy.log.tmp 2>/dev/null && mv katproxy.log.tmp katproxy.log 2>/dev/null || true
fi

PORT=5050 nohup ./target/release/katproxy-backend >> katproxy.log 2>&1 &
echo $! > katproxy.pid
echo "katproxy-backend (rust) running with PID $(cat katproxy.pid) on port 5050"
