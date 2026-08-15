#!/usr/bin/env bash
# Connect a local coding CLI (Claude Code, Codex, …) to your HXA Connect org
# as an online teammate bot, through the Slock daemon. The daemon detects the
# local runtimes and bridges messages between the hub and your CLI, so the bot
# shows online in the org and other agents can DM it.
#
# Usage:
#   scripts/connect-teammate.sh <teammate> [-- <extra daemon args>]
#
# <teammate> names both the bot and its token variable: teammate "codex" reads
# its token from HXA_CODEX_TOKEN (upper-cased, '-' becomes '_').
#
# Configuration — environment variables, or a .env at the repository root:
#   HXA_HUB_URL           hub base URL, e.g. https://hub.example.com/connect
#   HXA_<TEAMMATE>_TOKEN  the bot token issued for this teammate
#
# Anything after a literal '--' is passed straight to the daemon (e.g. to pin
# a model or runtime): scripts/connect-teammate.sh codex -- --model gpt-5
#
# Example:
#   HXA_HUB_URL=https://hub.example.com/connect \
#   HXA_CODEX_TOKEN=... scripts/connect-teammate.sh codex
set -euo pipefail

# Pinned to a daemon release that authenticates over the `?key=` query string,
# matching the hub's WebSocket endpoint. Newer daemon releases switched to an
# Authorization header and fail against hubs that read `?key=`. Override with
# SLOCK_DAEMON_PACKAGE once the hub accepts header auth.
DAEMON_PACKAGE="${SLOCK_DAEMON_PACKAGE:-@slock-ai/daemon@0.39.0}"

usage() {
  # Print the header comment block as help text.
  sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^#\{0,1\} \{0,1\}//'
  exit "${1:-0}"
}

[ "$#" -ge 1 ] || usage 1
case "$1" in -h | --help) usage 0 ;; esac

teammate="$1"
shift
[ "${1:-}" = "--" ] && shift

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$repo_root/.env"

# Read one KEY's value from a .env file without executing the file, tolerating
# unrelated or malformed lines. The last definition wins; surrounding quotes
# are stripped.
read_env_var() {
  [ -f "$env_file" ] || return 0
  sed -n "s/^$1=//p" "$env_file" | tail -1 | sed "s/^[\"']//;s/[\"']\$//"
}

# Environment wins; a repo-root .env is the fallback.
hub="${HXA_HUB_URL:-$(read_env_var HXA_HUB_URL)}"
[ -n "$hub" ] || {
  echo "error: HXA_HUB_URL is not set (the hub base URL, e.g. https://hub.example.com/connect)" >&2
  exit 1
}

# teammate → token variable: codex → HXA_CODEX_TOKEN
token_var="HXA_$(printf '%s' "$teammate" | tr '[:lower:]-' '[:upper:]_')_TOKEN"
token="${!token_var:-$(read_env_var "$token_var")}"
[ -n "$token" ] || {
  echo "error: $token_var is not set (the bot token for teammate '$teammate')" >&2
  exit 1
}

echo "Connecting teammate '$teammate' to $hub …"
echo "(Ctrl-C to disconnect. For a persistent teammate, run this under a service manager.)"
# The pinned daemon takes the token as a command-line flag; it is briefly
# visible in this host's process listing while the daemon runs. On a shared
# host, issue a scoped bot token and rotate it if exposure is a concern.
npx -y "$DAEMON_PACKAGE" \
  --server-url "$hub" \
  --api-key "$token" \
  "$@"
