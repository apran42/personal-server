#!/data/data/com.termux/files/usr/bin/sh

set -u

APP_DIR="$HOME/apps/myserver"
CONFIG_FILE="$HOME/.config/myserver/healthchecks.env"

if [ ! -r "$CONFIG_FILE" ]; then
    echo "Healthchecks configuration not found."
    exit 1
fi

. "$CONFIG_FILE"

if [ -z "${BACKUP_PING_URL:-}" ]; then
    echo "BACKUP_PING_URL is not configured."
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

send_ping "$BACKUP_PING_URL/start" ||
    echo "Warning: backup start ping failed."

"$APP_DIR/scripts/backup-db.sh"
BACKUP_RESULT="$?"

if [ "$BACKUP_RESULT" -eq 0 ]; then
    "$APP_DIR/scripts/cloud-backup.sh"
    BACKUP_RESULT="$?"
fi

if [ "$BACKUP_RESULT" -eq 0 ]; then
    send_ping "$BACKUP_PING_URL" ||
        echo "Warning: backup success ping failed."

    echo "Monitored backup completed."
else
    send_ping "$BACKUP_PING_URL/fail" ||
        echo "Warning: backup failure ping failed."

    echo "Monitored backup failed."
fi

exit "$BACKUP_RESULT"
