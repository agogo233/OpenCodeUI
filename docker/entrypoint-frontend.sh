#!/bin/sh
# Frontend entrypoint: optional page-level Basic auth.
#
# Page auth reuses the backend credentials: OPENCODE_SERVER_PASSWORD is the
# single switch. Empty -> plain static Caddyfile (legacy behavior).
# Non-empty -> hash the password at startup and run Caddyfile.auth so the
# whole UI requires the same account as the backend API.
#
# Any failure in the auth branch must abort startup (fail loud), never
# silently fall back to an unauthenticated server.
set -eu

if [ -z "${OPENCODE_SERVER_PASSWORD:-}" ]; then
    exec caddy run --config /etc/caddy/Caddyfile
fi

PAGE_AUTH_USERNAME="${OPENCODE_SERVER_USERNAME:-opencode}"
case "$PAGE_AUTH_USERNAME" in
    ''|*[!A-Za-z0-9._@-]*)
        echo "entrypoint: invalid OPENCODE_SERVER_USERNAME (allowed: A-Za-z0-9._@-), refusing to start" >&2
        exit 1
        ;;
esac
export PAGE_AUTH_USERNAME

# caddy hash-password (stable releases) requires a trailing newline on
# stdin, so the password must not contain one itself.
nl='
'
case "$OPENCODE_SERVER_PASSWORD" in
    *"$nl"*)
        echo "entrypoint: OPENCODE_SERVER_PASSWORD must not contain a newline, refusing to start" >&2
        exit 1
        ;;
esac

# Read the password from stdin so it never appears on any command line.
# Pin the algorithm: Caddyfile.auth declares basic_auth bcrypt.
PAGE_AUTH_HASH="$(printf '%s\n' "$OPENCODE_SERVER_PASSWORD" | caddy hash-password --algorithm bcrypt)" || {
    echo "entrypoint: failed to hash OPENCODE_SERVER_PASSWORD" >&2
    exit 1
}
case "$PAGE_AUTH_HASH" in
    '$'*) ;;
    *)
        echo "entrypoint: unexpected caddy hash-password output, refusing to start" >&2
        exit 1
        ;;
esac
export PAGE_AUTH_HASH

exec caddy run --config /etc/caddy/Caddyfile.auth
