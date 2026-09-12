#!/usr/bin/env sh

set -eu

REPO_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
LOG_FILE="$(mktemp)"
SERVER_PID=""

cleanup() {
    if [ -n "$SERVER_PID" ]; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi

    rm -f "$LOG_FILE"
}

trap cleanup EXIT INT TERM

cd "$REPO_DIR"

SERVER_USERNAME="ci-user" \
SERVER_PASSWORD="ci-password" \
HOST="127.0.0.1" \
PORT="18000" \
node server.js >"$LOG_FILE" 2>&1 &

SERVER_PID="$!"

ATTEMPT=1

while [ "$ATTEMPT" -le 15 ]; do
    if RESPONSE="$(
        curl -fs \
            -u "ci-user:ci-password" \
            "http://127.0.0.1:18000/health"
    )"; then
        echo "$RESPONSE" | grep -q '"status":"ok"'
        echo "Smoke test passed: $RESPONSE"
        exit 0
    fi

    sleep 1
    ATTEMPT=$((ATTEMPT + 1))
done

echo "Server did not become healthy."
cat "$LOG_FILE"
exit 1