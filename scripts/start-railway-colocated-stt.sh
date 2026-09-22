#!/bin/sh
set -eu

STT_PORT="${RONS_STT_PORT:-7869}"
WEB_PORT="${PORT:-3000}"
export RONS_STT_PORT="$STT_PORT"

python3 /app/ronsas-stt/server.py &
stt_pid=$!

cleanup() {
  kill "$stt_pid" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

ready=0
attempt=1
while [ "$attempt" -le 90 ]; do
  if ! kill -0 "$stt_pid" 2>/dev/null; then
    echo "Hosted STT process exited before readiness." >&2
    exit 1
  fi
  if curl -fsS "http://127.0.0.1:${STT_PORT}/health/ready" >/tmp/rons-stt-ready.json 2>/dev/null; then
    ready=1
    break
  fi
  sleep 1
  attempt=$((attempt + 1))
done

if [ "$ready" -ne 1 ]; then
  echo "Hosted STT did not become ready within the bounded startup window." >&2
  exit 1
fi

echo "Hosted STT ready on loopback port ${STT_PORT}; starting ePublisher on port ${WEB_PORT}."
trap - INT TERM EXIT
exec npm exec -- vite preview --host 0.0.0.0 --port "$WEB_PORT"
