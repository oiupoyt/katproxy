#!/data/data/com.termux/files/usr/bin/bash
cd "$(dirname "$0")"

echo "=== KatProxy Backend (Rust) Status ==="
if [ -f katproxy.pid ]; then
  PID=$(cat katproxy.pid)
  if ps -p "$PID" > /dev/null 2>&1; then
    echo "Status: RUNNING (PID $PID)"
    ps -o pid,user,%cpu,%mem,vsz,rss,stat,start,time,comm -p "$PID" 2>/dev/null || ps -p "$PID"
  else
    echo "Status: STALE PID FILE (Process $PID not active)"
  fi
else
  echo "Status: STOPPED (no katproxy.pid)"
fi

echo ""
echo "=== Last Log Lines ==="
if [ -f katproxy.log ]; then
  tail -n 15 katproxy.log
else
  echo "No katproxy.log found."
fi
