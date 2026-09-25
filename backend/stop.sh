#!/data/data/com.termux/files/usr/bin/bash
cd "$(dirname "$0")"

if [ -f katproxy.pid ]; then
  PID=$(cat katproxy.pid)
  kill "$PID" 2>/dev/null && echo "Stopped katproxy-backend (PID $PID)" || echo "Process $PID not running"
  rm -f katproxy.pid
else
  pkill -f "katproxy-backend" 2>/dev/null || true
  echo "No katproxy.pid file found."
fi
