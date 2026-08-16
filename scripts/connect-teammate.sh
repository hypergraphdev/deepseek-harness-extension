#!/usr/bin/env bash
# Manage local coding CLIs (Claude Code, Codex, …) as online teammate bots in
# your HXA Connect org, through the Slock daemon. The daemon detects the local
# runtime and bridges messages between the hub and the CLI, so the bot shows
# online in the org and other agents can DM it.
#
# Usage:
#   scripts/connect-teammate.sh start [<teammate>...] [-- <extra daemon args>]
#   scripts/connect-teammate.sh stop [<teammate>...]
#   scripts/connect-teammate.sh status [<teammate>...]
#   scripts/connect-teammate.sh run <teammate> [-- <extra daemon args>]
#
#   start    Launch daemons in the background (pidfile + log under
#            $DSH_HOME/teammates/). No names = every teammate that has a
#            HXA_<NAME>_TOKEN in the environment or the repo .env.
#   stop     Stop managed daemons. No names = every one with a pidfile.
#   status   One line per teammate: managed process state, plus the bot's
#            online state in the org when a local dsh server is reachable.
#   run      Foreground single connection (Ctrl-C to disconnect) — the
#            original behavior.
#
# <teammate> names both the bot and its token variable: teammate "codex" reads
# its token from HXA_CODEX_TOKEN (upper-cased, '-' becomes '_').
#
# Configuration — environment variables, or a .env at the repository root:
#   HXA_HUB_URL           hub base URL, e.g. https://hub.example.com/connect
#   HXA_<TEAMMATE>_TOKEN  the bot token issued for this teammate
#
# Anything after a literal '--' is passed straight to every started daemon
# (e.g. to pin a model): scripts/connect-teammate.sh start codex -- --model gpt-5
set -euo pipefail

# Pinned to a daemon release that authenticates over the `?key=` query string,
# matching the hub's WebSocket endpoint. Newer daemon releases switched to an
# Authorization header and fail against hubs that read `?key=`. Override with
# SLOCK_DAEMON_PACKAGE — an npm spec or a local package directory (a checkout
# with a built dist/), e.g. SLOCK_DAEMON_PACKAGE=/path/to/slock-gateway.
DAEMON_PACKAGE="${SLOCK_DAEMON_PACKAGE:-@slock-ai/daemon@0.39.0}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$repo_root/.env"
state_dir="${DSH_HOME:-$HOME/.dsh}/teammates"

usage() {
  # Print the header comment block as help text.
  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^#\{0,1\} \{0,1\}//'
  exit "${1:-0}"
}

# Read one KEY's value from a .env file without executing the file, tolerating
# unrelated or malformed lines. The last definition wins; surrounding quotes
# are stripped.
read_env_var() {
  [ -f "$env_file" ] || return 0
  sed -n "s/^$1=//p" "$env_file" | tail -1 | sed "s/^[\"']//;s/[\"']\$//"
}

# teammate → token variable: codex → HXA_CODEX_TOKEN
token_var_for() {
  printf 'HXA_%s_TOKEN' "$(printf '%s' "$1" | tr '[:lower:]-' '[:upper:]_')"
}

# The teammate's token from the environment (wins) or the repo .env.
token_for() {
  local var
  var="$(token_var_for "$1")"
  printf '%s' "${!var:-$(read_env_var "$var")}"
}

require_hub() {
  hub="${HXA_HUB_URL:-$(read_env_var HXA_HUB_URL)}"
  [ -n "$hub" ] || {
    echo "error: HXA_HUB_URL is not set (the hub base URL, e.g. https://hub.example.com/connect)" >&2
    exit 1
  }
}

require_token() {
  token="$(token_for "$1")"
  [ -n "$token" ] || {
    echo "error: $(token_var_for "$1") is not set (the bot token for teammate '$1')" >&2
    exit 1
  }
}

# Every teammate with a token: names from HXA_<NAME>_TOKEN in the .env and the
# environment, excluding HXA_BOT_TOKEN (dsh-main's own credential).
configured_teammates() {
  {
    [ -f "$env_file" ] && sed -n 's/^HXA_\([A-Z0-9_]*\)_TOKEN=.*/\1/p' "$env_file"
    env | sed -n 's/^HXA_\([A-Z0-9_]*\)_TOKEN=.*/\1/p'
  } | sort -u | grep -v '^BOT$' | tr '[:upper:]_' '[:lower:]-'
}

# Teammates that currently have a pidfile, running or stale.
managed_teammates() {
  [ -d "$state_dir" ] || return 0
  for pidfile in "$state_dir"/*.pid; do
    [ -e "$pidfile" ] || continue
    basename "$pidfile" .pid
  done
}

pid_of() {
  local pidfile="$state_dir/$1.pid"
  [ -f "$pidfile" ] || return 1
  cat "$pidfile"
}

running() {
  local pid
  pid="$(pid_of "$1")" || return 1
  kill -0 "$pid" 2> /dev/null
}

# The org roster from a local dsh server, one "name online" pair per line.
# Empty when no server answers — status then reports the local view only.
hub_roster() {
  curl -s --max-time 2 http://127.0.0.1:3080/api/hxa/contacts 2> /dev/null \
    | tr '{' '\n' | sed -nE 's/.*"name":"([^"]*)".*"online":(true|false).*/\1 \2/p'
}

start_one() {
  local teammate="$1"
  shift
  if running "$teammate"; then
    echo "teammate '$teammate' is already running (pid $(pid_of "$teammate"))"
    return 0
  fi
  require_token "$teammate"
  mkdir -p "$state_dir"
  local log="$state_dir/$teammate.log"
  # The pinned daemon takes the token as a command-line flag; it is briefly
  # visible in this host's process listing while the daemon runs. On a shared
  # host, issue a scoped bot token and rotate it if exposure is a concern.
  nohup npx -y "$DAEMON_PACKAGE" \
    --server-url "$hub" \
    --api-key "$token" \
    "$@" >> "$log" 2>&1 &
  echo "$!" > "$state_dir/$teammate.pid"
  echo "started teammate '$teammate' (pid $!, log $log)"
}

stop_one() {
  local teammate="$1"
  local pid
  if ! pid="$(pid_of "$teammate")"; then
    echo "teammate '$teammate' has no pidfile (not managed by this script)"
    return 0
  fi
  if kill -0 "$pid" 2> /dev/null; then
    # npx fronts the daemon: terminate the child tree first, then the leader.
    pkill -TERM -P "$pid" 2> /dev/null || true
    kill -TERM "$pid" 2> /dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "$pid" 2> /dev/null || break
      sleep 1
    done
    if kill -0 "$pid" 2> /dev/null; then
      pkill -KILL -P "$pid" 2> /dev/null || true
      kill -KILL "$pid" 2> /dev/null || true
    fi
    echo "stopped teammate '$teammate' (pid $pid)"
  else
    echo "teammate '$teammate' was not running (stale pidfile removed)"
  fi
  rm -f "$state_dir/$teammate.pid"
}

status_all() {
  local names roster line state org
  names="$(printf '%s\n' "$@" | grep -v '^$' || true)"
  if [ -z "$names" ]; then
    names="$( (configured_teammates; managed_teammates) | sort -u)"
  fi
  [ -n "$names" ] || {
    echo "no teammates configured (no HXA_<NAME>_TOKEN found) and none managed"
    return 0
  }
  roster="$(hub_roster)"
  while IFS= read -r teammate; do
    if running "$teammate"; then
      state="running (pid $(pid_of "$teammate"))"
    elif [ -f "$state_dir/$teammate.pid" ]; then
      state="dead (stale pidfile)"
    elif [ -n "$(token_for "$teammate")" ]; then
      state="stopped"
    else
      state="no token"
    fi
    org=""
    if [ -n "$roster" ]; then
      line="$(printf '%s\n' "$roster" | grep "^$teammate " || true)"
      case "$line" in
        *true) org=", online in org" ;;
        *false) org=", offline in org" ;;
        *) org=", not in org roster" ;;
      esac
    fi
    echo "$teammate: $state$org"
  done <<< "$names"
}

[ "$#" -ge 1 ] || usage 1
case "$1" in -h | --help) usage 0 ;; esac

command="$1"
shift
case "$command" in
  start)
    require_hub
    names=()
    while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
      names+=("$1")
      shift
    done
    [ "${1:-}" = "--" ] && shift
    if [ "${#names[@]}" -eq 0 ]; then
      while IFS= read -r teammate; do
        [ -n "$teammate" ] && names+=("$teammate")
      done <<< "$(configured_teammates)"
      [ "${#names[@]}" -gt 0 ] || {
        echo "error: no teammates to start — set HXA_<NAME>_TOKEN in the environment or .env, or name one explicitly" >&2
        exit 1
      }
    fi
    for teammate in "${names[@]}"; do
      start_one "$teammate" "$@"
    done
    ;;
  stop)
    if [ "$#" -eq 0 ]; then
      found=0
      while IFS= read -r teammate; do
        [ -n "$teammate" ] || continue
        found=1
        stop_one "$teammate"
      done <<< "$(managed_teammates)"
      [ "$found" -eq 1 ] || echo "nothing to stop (no pidfiles under $state_dir)"
    else
      for teammate in "$@"; do
        stop_one "$teammate"
      done
    fi
    ;;
  status)
    status_all "$@"
    ;;
  run)
    [ "$#" -ge 1 ] || usage 1
    require_hub
    teammate="$1"
    shift
    [ "${1:-}" = "--" ] && shift
    require_token "$teammate"
    echo "Connecting teammate '$teammate' to $hub …"
    echo "(Ctrl-C to disconnect. For a persistent teammate, use: $0 start $teammate)"
    exec npx -y "$DAEMON_PACKAGE" \
      --server-url "$hub" \
      --api-key "$token" \
      "$@"
    ;;
  *)
    echo "error: unknown command '$command' (expected start | stop | status | run)" >&2
    usage 1
    ;;
esac
