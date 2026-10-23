#!/usr/bin/env bash
# Forwards a rig's Chrome debugging port (9222) to this Mac, through Session Manager, so the harness
# attaches with `--remote <port>`. Runs until stopped (Ctrl-C): leave it in its own terminal, one per
# rig. A forward is not for ever: the session ends on its own after some tens of minutes, and one
# opened in the seconds after a machine's agent comes online can hang open without ever passing a
# connection. So this keeps watch: the session is opened again whenever it ends, and killed and
# opened again when Chrome has not answered through it for 30 s. A sample in flight when that
# happens is lost, and the chain (`chain.mjs`) puts that job back on the queue.
#
#   tools/frame-budget/rig/forward.sh <instance id> [local port, 9333 by default]
set -uo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: $0 <instance id> [local port]" >&2
  exit 2
fi

instance="$1"
port="${2:-9333}"
# Seconds without an answer from Chrome through the forward before it is opened again.
quiet_limit=30

say() { echo "$(date '+%H:%M:%S') forward ${port}: $*" >&2; }

session=""
cleanup() {
  [ -n "$session" ] && kill "$session" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

while :; do
  started=$(date +%s)
  aws ssm start-session --region us-east-1 --target "$instance" \
    --document-name AWS-StartPortForwardingSession \
    --parameters "portNumber=9222,localPortNumber=${port}" &
  session=$!
  quiet=0
  while kill -0 "$session" 2>/dev/null; do
    sleep 5
    if curl -s --max-time 4 "http://127.0.0.1:${port}/json/version" >/dev/null; then
      quiet=0
    else
      quiet=$((quiet + 5))
      if [ "$quiet" -ge "$quiet_limit" ]; then
        say "no answer from Chrome for ${quiet} s: opening the session again"
        kill "$session" 2>/dev/null
        break
      fi
    fi
  done
  wait "$session" 2>/dev/null
  session=""
  say "session ended after $(( $(date +%s) - started )) s; opening it again in 5 s"
  sleep 5
done
