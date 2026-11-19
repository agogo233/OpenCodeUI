#!/bin/sh
# Reasonix entrypoint: pre-provision REASONIX_HOME, then exec the serve args.
#
# reasonix 1.x disables its web-based provider setup page when bound to a
# non-loopback address, so credentials must be prepared before serve starts:
#   1. config.toml  - copied from the in-image /defaults/config.toml
#   2. .env         - materialized from the DEEPSEEK_API_KEY env var
#
# compose `command:` replaces CMD (reasonix args), never this ENTRYPOINT, so
# a command like ["serve","--auth","token","--token","..."] lands here safely.
set -eu

REASONIX_HOME="${REASONIX_HOME:-/reasonix-home}"
mkdir -p "$REASONIX_HOME"

if [ ! -f "$REASONIX_HOME/config.toml" ]; then
    cp /defaults/config.toml "$REASONIX_HOME/config.toml"
fi

# Only rewrite .env when a key is provided, so an operator-supplied .env
# on the volume survives restarts. `if` (not `[ ] &&`) keeps `set -e` happy
# when the variable is empty. chmod 600: the file holds a credential and
# travels to the host via the mounted volume.
if [ -n "${DEEPSEEK_API_KEY:-}" ]; then
    printf 'DEEPSEEK_API_KEY=%s\n' "$DEEPSEEK_API_KEY" > "$REASONIX_HOME/.env"
    chmod 600 "$REASONIX_HOME/.env"
fi

exec reasonix "$@"
