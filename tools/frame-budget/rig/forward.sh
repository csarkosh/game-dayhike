#!/usr/bin/env bash
# Forwards the rig's Chrome debugging port (9222) to this Mac, through Session Manager, so the
# harness attaches with `--remote <port>`. Runs until stopped (Ctrl-C): leave it in its own terminal.
#
#   tools/frame-budget/rig/forward.sh <instance id> [local port, 9333 by default]
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: $0 <instance id> [local port]" >&2
  exit 2
fi

instance="$1"
port="${2:-9333}"

exec aws ssm start-session --region us-east-1 --target "$instance" \
  --document-name AWS-StartPortForwardingSession \
  --parameters "portNumber=9222,localPortNumber=${port}"
