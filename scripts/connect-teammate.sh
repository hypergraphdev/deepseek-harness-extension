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

# Kill one process and its whole descendant tree, TERM first then KILL.
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2> /dev/null); do
    kill_tree "$child"
  done
  kill -TERM "$pid" 2> /dev/null || true
  for _ in 1 2 3; do
    kill -0 "$pid" 2> /dev/null || return 0
    sleep 1
  done
  kill -KILL "$pid" 2> /dev/null || true
}

# Leader pids of every slock daemon on this host (the `npm exec`/npx front
# process), whether or not this script started it. Children are reached
# through kill_tree, so only tree roots are listed.
daemon_leader_pids() {
  local pid ppid
  # shellcheck disable=SC2009 -- pgrep -f matches the whole tree; ps lets us keep roots only
  ps -axo pid=,ppid=,command= | grep -E "npm exec @slock-ai/daemon|npx .*@slock-ai/daemon" | grep -v grep \
    | while read -r pid ppid _; do
      # A leader's parent is a shell/launcher, not another matched process.
      printf '%s\n' "$pid"
    done
}

# The --api-key value in one pid's command line, or empty.
daemon_token_of() {
  ps -o command= -p "$1" 2> /dev/null | sed -nE 's/.*--api-key ([^ ]+).*/\1/p'
}

# Resolve a daemon token to a configured teammate name, or empty.
teammate_for_token() {
  local candidate
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    [ "$(token_for "$candidate")" = "$1" ] && { printf '%s' "$candidate"; return 0; }
  done <<< "$(configured_teammates)"
  return 0
}

# Unmanaged daemon leaders: every daemon on the host except the managed pids.
unmanaged_daemons() {
  local pid managed
  managed="$(managed_teammates | while IFS= read -r name; do pid_of "$name" 2> /dev/null || true; done)"
  for pid in $(daemon_leader_pids); do
    printf '%s\n' "$managed" | grep -qx "$pid" && continue
    printf '%s\n' "$pid"
  done
}

start_one() {
  local teammate="$1"
  shift
  if running "$teammate"; then
    echo "teammate '$teammate' is already running (pid $(pid_of "$teammate"))"
    return 0
  fi
  require_token "$teammate"
  local other
  for other in $(unmanaged_daemons); do
    if [ "$(daemon_token_of "$other")" = "$token" ]; then
      echo "teammate '$teammate' is already connected by an unmanaged daemon (pid $other); run '$0 stop $teammate' first"
      return 0
    fi
  done
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
  local pid stopped=0
  if pid="$(pid_of "$teammate")"; then
    if kill -0 "$pid" 2> /dev/null; then
      kill_tree "$pid"
      echo "stopped teammate '$teammate' (pid $pid)"
    else
      echo "teammate '$teammate' was not running (stale pidfile removed)"
    fi
    rm -f "$state_dir/$teammate.pid"
    stopped=1
  fi
  # Takeover: an unmanaged daemon carrying this teammate's token dies too.
  local other token_value
  token_value="$(token_for "$teammate")"
  if [ -n "$token_value" ]; then
    for other in $(unmanaged_daemons); do
      if [ "$(daemon_token_of "$other")" = "$token_value" ]; then
        kill_tree "$other"
        echo "stopped unmanaged daemon for '$teammate' (pid $other)"
        stopped=1
      fi
    done
  fi
  [ "$stopped" -eq 1 ] || echo "teammate '$teammate': nothing running (no pidfile, no matching daemon)"
}

# Kill every unmanaged daemon on the host, naming the teammate when its token
# matches a configured one; otherwise identified by a token prefix.
stop_unmanaged_all() {
  local pid token_value name label found=0
  for pid in $(unmanaged_daemons); do
    found=1
    token_value="$(daemon_token_of "$pid")"
    name="$(teammate_for_token "$token_value")"
    label="${name:-token ${token_value:0:12}…}"
    kill_tree "$pid"
    echo "stopped unmanaged daemon (pid $pid, $label)"
  done
  return $((1 - found))
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
      local unmanaged_pid
      for unmanaged_pid in $(unmanaged_daemons); do
        if [ "$(daemon_token_of "$unmanaged_pid")" = "$(token_for "$teammate")" ]; then
          state="running unmanaged (pid $unmanaged_pid)"
          break
        fi
      done
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
  local pid token_value
  for pid in $(unmanaged_daemons); do
    token_value="$(daemon_token_of "$pid")"
    [ -n "$(teammate_for_token "$token_value")" ] && continue
    echo "unrecognized daemon: pid $pid (token ${token_value:0:12}… matches no configured teammate)"
  done
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
      stop_unmanaged_all && found=1
      [ "$found" -eq 1 ] || echo "nothing to stop (no pidfiles under $state_dir, no daemons found)"
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
