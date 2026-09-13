#!/data/data/com.termux/files/usr/bin/sh

set -u

NAS_DIR="$HOME/storage/shared/NAS"
CONFIG_FILE="$HOME/.config/myserver/healthchecks.env"

WARNING_PERCENT="${STORAGE_WARNING_PERCENT:-85}"
CRITICAL_PERCENT="${STORAGE_CRITICAL_PERCENT:-95}"

if [ ! -r "$CONFIG_FILE" ]; then
    echo "Healthchecks configuration not found."
    exit 1
fi

. "$CONFIG_FILE"

if [ -z "${STORAGE_PING_URL:-}" ]; then
    echo "STORAGE_PING_URL is not configured."
    exit 1
fi

send_ping() {
    PING_TARGET="$1"

    curl \
        --fail \
        --silent \
        --show-error \
        --max-time 10 \
        --retry 3 \
        --output /dev/null \
        "$PING_TARGET"
}

get_usage_percent() {
    df -P "$NAS_DIR" |
        awk '
            NR == 2 {
                gsub("%", "", $5)
                print $5
            }
        '
}

USAGE_PERCENT="$(get_usage_percent)"

case "$USAGE_PERCENT" in
    ""|*[!0-9]*)
        echo "Could not determine storage usage."
        send_ping "$STORAGE_PING_URL/fail" || true
        exit 1
        ;;
esac

if [ "$USAGE_PERCENT" -ge "$CRITICAL_PERCENT" ]; then
    echo "Storage critical: ${USAGE_PERCENT}% used."
    send_ping "$STORAGE_PING_URL/fail" || true
    exit 1
fi

if [ "$USAGE_PERCENT" -ge "$WARNING_PERCENT" ]; then
    echo "Storage warning: ${USAGE_PERCENT}% used."
    send_ping "$STORAGE_PING_URL/fail" || true
    exit 1
fi

send_ping "$STORAGE_PING_URL" ||
    echo "Warning: storage success ping failed."

echo "Storage healthy: ${USAGE_PERCENT}% used."
exit 0