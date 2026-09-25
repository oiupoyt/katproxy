#!/data/data/com.termux/files/usr/bin/bash
cd "$(dirname "$0")"

# Acquire Android partial wake-lock so CPU does not sleep when screen turns off
/data/data/com.termux/files/usr/bin/termux-wake-lock 2>/dev/null || true

# Stop existing backend instance if running
if [ -f katproxy.pid ]; then
  kill $(cat katproxy.pid) 2>/dev/null || true
  rm -f katproxy.pid
fi
sleep 0.5

# Rotate log file to save tablet storage
if [ -f katproxy.log ]; then
  tail -n 200 katproxy.log > katproxy.log.tmp 2>/dev/null && mv katproxy.log.tmp katproxy.log 2>/dev/null || true
fi

# Start backend with 256MB capped V8 heap for ARM Android stability
PORT=5050 nohup node --max-old-space-size=256 server.js >> katproxy.log 2>&1 &
echo $! > katproxy.pid
echo "katproxy-backend running with PID $(cat katproxy.pid) on port 5050"
