#!/usr/bin/env bash
# A round of experiments in one command, on as many rigs as it has jobs: starts that many machines
# (`rig_count`, copies from the root's image, Chrome about 8 minutes after a create, a boot for a
# copy kept from an earlier round), opens one forward a machine (`forward.sh`, which reopens itself),
# runs the chain over every port (`chain.mjs`, a job to a port, each port taking the next as it comes
# free), then stops every machine. The round's wait is the slowest machine's start plus its slowest
# job, not the sum of the jobs.
#
#   tools/frame-budget/rig/round.sh <queue.json> [--rigs N] [--max-rigs 10] [--retries 1] [--keep-running]
#
# The queue's shape is the chain's (`rig/chain.mjs`). --rigs sets the machine count; by default it is
# the queue's job count (an experiment on two tiers is two jobs), at most --max-rigs. The count never
# falls below the machines the root already has: lowering `rig_count` destroys copies, which is a
# decision for its own apply, not a side effect of a round. Starting and stopping machines is
# `terraform apply` on `_infra/test-rig-aws-windows/`, and the owner's go-ahead is the rule for it.
set -euo pipefail

here="$(cd "$(dirname "$0")/../../.." && pwd)"
# The rig root's state is read from the main checkout's root whatever checkout this runs from: a
# worktree's copy of the root is never initialised, and the machines are applied from one place.
main="$(dirname "$(git -C "$here" rev-parse --path-format=absolute --git-common-dir)")"
root="$main/_infra/test-rig-aws-windows"
queue="" rigs="" max_rigs=10 retries=1 keep=0 count=0
while [ $# -gt 0 ]; do
  case "$1" in
    --rigs) rigs="$2"; shift 2 ;;
    --max-rigs) max_rigs="$2"; shift 2 ;;
    --retries) retries="$2"; shift 2 ;;
    --keep-running) keep=1; shift ;;
    -*) echo "unknown option $1" >&2; exit 2 ;;
    *) queue="$1"; shift ;;
  esac
done
[ -n "$queue" ] && [ -f "$queue" ] || { echo "usage: $0 <queue.json> [--rigs N] [--max-rigs 10] [--retries 1] [--keep-running]" >&2; exit 2; }
queue="$(cd "$(dirname "$queue")" && pwd)/$(basename "$queue")"
cd "$here"

jobs=$(node --input-type=module -e "
  import { readFileSync } from 'node:fs';
  import { expandJobs } from './tools/frame-budget/lib/chain.mjs';
  console.log(expandJobs(JSON.parse(readFileSync(process.argv[1], 'utf8'))).length);
" "$queue")
[ -d "$root/.terraform" ] || { echo "the rig root is not initialised: run terraform init in $root" >&2; exit 2; }
have=$( (cd "$root" && terraform output -json instance_ids 2>/dev/null) | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).length)}catch{console.log(1)}})' ) || have=1
want=${rigs:-$(( jobs < max_rigs ? jobs : max_rigs ))}
[ "$want" -ge 1 ] || want=1
count=$(( want > have ? want : have ))
echo "round: $jobs job(s), $want rig(s) wanted, $have in state: rig_count=$count  $(date '+%H:%M')"

stop() {
  [ "$count" -ge 1 ] || return 0
  [ "$keep" = 1 ] && { echo "machines left running (--keep-running): their idle stop and run cap stand"; return; }
  echo "stopping every machine (running=false, rig_count=$count)  $(date '+%H:%M')"
  (cd "$root" && terraform apply -input=false -auto-approve -var running=false -var rig_count="$count" | grep -E "Apply complete|Error" | tail -2) || true
}
# Bash 3.2 (macOS's own) has no mapfile, and an empty array is "unbound" under `set -u`: the
# forwards are killed through this shell's children instead of a list.
cleanup() { pkill -P $$ 2>/dev/null || true; }
trap 'cleanup; stop' EXIT

(cd "$root" && terraform apply -input=false -auto-approve -var running=true -var rig_count="$count" | grep -E "Apply complete|Error" | tail -2)
ids=()
while IFS= read -r id; do ids+=("$id"); done < <(cd "$root" && terraform output -json instance_ids | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const id of JSON.parse(s)) console.log(id)})')
ports=()
logs="$here/tools/frame-budget/runs"
mkdir -p "$logs"
for i in "${!ids[@]}"; do
  [ "$i" -lt "$want" ] || break
  port=$(( 9333 + i ))
  "$here/tools/frame-budget/rig/forward.sh" "${ids[$i]}" "$port" > "$logs/forward-$port.log" 2>&1 &
  ports+=("$port")
done
list=$(IFS=,; echo "${ports[*]}")
# The Mac drives every sample: asleep, it freezes the harness mid-sample and drops every forward
# (2026-10-24: the lid closed a minute into a round, nothing measured). `caffeinate` holds off idle
# sleep for the round's life; a lid closed on battery still sleeps, so a round wants the lid open.
caffeinate -i -w $$ &
echo "forwards on $list; the chain waits for each Chrome to answer"
set +e
node tools/frame-budget/rig/chain.mjs --queue "$queue" --ports "$list" --retries "$retries"
status=$?
set -e
echo "chain exit $status  $(date '+%H:%M')"
exit $status
