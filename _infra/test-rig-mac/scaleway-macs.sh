#!/usr/bin/env bash
# Talks to Scaleway's Apple silicon API directly, for the three things the
# Terraform provider cannot be trusted with: it treats a 403 on a read or a
# delete as "the server is gone", so its state is not a record of what is
# billed.
#
#   scaleway-macs.sh schedule <zone> <server-id>
#       Ask Scaleway to delete the server by itself at its earliest deletion
#       time, then read it back and confirm. Refuses (and schedules nothing) if
#       that time is less than 23.5 hours after creation: scheduled deletion
#       would then fire within minutes of delivery. Run by `terraform apply`.
#
#   scaleway-macs.sh list [zone ...]
#       Every Apple silicon server in the project, in each zone (default
#       fr-par-1 and fr-par-3), set against the server ids in Terraform's
#       state. Exits non-zero if a server is missing from state or is not
#       scheduled for deletion. The end-of-day check.
#
#   scaleway-macs.sh try-early-delete <zone> <server-id>
#       Send one DELETE and print the HTTP status and body exactly as the API
#       returned them. The first day's test of what an early delete does.
#
# Needs SCW_SECRET_KEY (and, for `list`, SCW_DEFAULT_PROJECT_ID) in the
# environment, plus curl and node. The key reaches curl on its standard input
# through printf, a shell builtin, so it is never on a command line.

set -euo pipefail
API=https://api.scaleway.com/apple-silicon/v1alpha1
: "${SCW_SECRET_KEY:?export SCW_SECRET_KEY first}"

# api METHOD PATH [BODY]: prints the body, then the HTTP status on a last line.
api() {
  local args=(-sS -H @- -X "$1" -w '\n%{http_code}' "$API$2")
  [[ -n "${3:-}" ]] && args+=(-H 'Content-Type: application/json' -d "$3")
  printf 'X-Auth-Token: %s\n' "$SCW_SECRET_KEY" | curl "${args[@]}"
}
# Pipes, not here-strings: bash 3.2 writes a here-string to a temporary file,
# and a server's JSON carries its password.
body() { printf '%s\n' "$1" | sed '$d'; }
status() { printf '%s\n' "$1" | tail -n1; }
field() { node -e 'const v=JSON.parse(require("fs").readFileSync(0,"utf8"))[process.argv[1]];console.log(v===undefined||v===null?"":v)' "$1"; }

get_server() { # zone id -> body, or exit
  local r
  r=$(api GET "/zones/$1/servers/$2")
  if [[ "$(status "$r")" != 200 ]]; then
    echo "GET server $2 answered HTTP $(status "$r"): $(body "$r")" >&2
    exit 1
  fi
  body "$r"
}

case "${1:-}" in
schedule)
  zone=${2:?zone}
  id=${3:?server id}
  server=$(get_server "$zone" "$id")
  created=$(printf '%s' "$server" | field created_at)
  deletable=$(printf '%s' "$server" | field deletable_at)
  gap=$(node -e 'const g=(Date.parse(process.argv[2])-Date.parse(process.argv[1]))/1000;console.log(Number.isNaN(g)?-1:Math.floor(g))' "$created" "$deletable")
  if ((gap < 84600)); then
    echo "REFUSED: $id was created at '$created' and may be deleted from '$deletable'." >&2
    echo "Scheduled deletion follows the earliest deletion time, so it could delete this Mac right after" >&2
    echo "delivery while the whole day is billed. Nothing was scheduled. Delete it by hand after 24 hours." >&2
    exit 1
  fi
  r=$(api PATCH "/zones/$zone/servers/$id" '{"schedule_deletion":true}')
  if [[ "$(status "$r")" != 200 ]]; then
    echo "PATCH schedule_deletion answered HTTP $(status "$r"): $(body "$r")" >&2
    exit 1
  fi
  scheduled=$(get_server "$zone" "$id" | field deletion_scheduled)
  if [[ "$scheduled" != true ]]; then
    echo "The API accepted the request but reads back deletion_scheduled=$scheduled for $id." >&2
    exit 1
  fi
  echo "$id is scheduled to delete itself at $deletable (created $created)."
  ;;

list)
  shift
  zones=("$@")
  ((${#zones[@]})) || zones=(fr-par-1 fr-par-3)
  : "${SCW_DEFAULT_PROJECT_ID:?export SCW_DEFAULT_PROJECT_ID first}"
  known=$(cd "$(dirname "$0")" && terraform output -json server_ids 2>/dev/null || echo '[]')
  problems=0
  for zone in "${zones[@]}"; do
    r=$(api GET "/zones/$zone/servers?project_id=$SCW_DEFAULT_PROJECT_ID&page_size=100")
    if [[ "$(status "$r")" != 200 ]]; then
      echo "$zone: HTTP $(status "$r"): $(body "$r")" >&2
      problems=1
      continue
    fi
    # shellcheck disable=SC2016 # the single-quoted program is JavaScript
    body "$r" | KNOWN="$known" ZONE="$zone" node -e '
      const { servers = [] } = JSON.parse(require("fs").readFileSync(0, "utf8"));
      const known = new Set(JSON.parse(process.env.KNOWN).map((id) => id.split("/").pop()));
      let bad = 0;
      if (!servers.length) console.log(`${process.env.ZONE}: no servers`);
      for (const s of servers) {
        const inState = known.has(s.id);
        const flags = [inState ? "in state" : "NOT IN TERRAFORM STATE", s.deletion_scheduled ? "deletion scheduled" : "NOT SCHEDULED FOR DELETION"];
        if (!inState || !s.deletion_scheduled) bad = 1;
        console.log(`${process.env.ZONE}: ${s.name} ${s.id} ${s.type} ${s.status} created ${s.created_at} deletable ${s.deletable_at}: ${flags.join(", ")}`);
      }
      process.exit(bad);
    ' || problems=1
  done
  if ((problems)); then
    echo "At least one Mac is unknown to Terraform or not scheduled for deletion: it bills EUR 0.22 an hour until deleted." >&2
    exit 1
  fi
  ;;

try-early-delete)
  zone=${2:?zone}
  id=${3:?server id}
  r=$(api DELETE "/zones/$zone/servers/$id")
  echo "DELETE $id answered HTTP $(status "$r")"
  echo "Body: $(body "$r")"
  ;;

*)
  sed -n '2,24p' "$0"
  exit 2
  ;;
esac
