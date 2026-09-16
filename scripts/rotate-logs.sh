#!/data/data/com.termux/files/usr/bin/sh

set -eu

LOG_DIR="${LOG_DIR:-$HOME/apps/myserver/logs}"
MAX_BYTES="${MAX_BYTES:-5242880}"

rotate_log() {
    LOG_FILE="$1"

    if [ ! -f "$LOG_FILE" ]; then
        return 0
    fi

    FILE_SIZE="$(wc -c <"$LOG_FILE")"

    if [ "$FILE_SIZE" -lt "$MAX_BYTES" ]; then
        return 0
    fi

    TEMP_FILE="${LOG_FILE}.rotate.$$"

    cp "$LOG_FILE" "$TEMP_FILE"
    chmod 600 "$TEMP_FILE"

    if [ -f "${LOG_FILE}.2" ]; then
        mv -f "${LOG_FILE}.2" "${LOG_FILE}.3"
    fi

    if [ -f "${LOG_FILE}.1" ]; then
        mv -f "${LOG_FILE}.1" "${LOG_FILE}.2"
    fi

    mv "$TEMP_FILE" "${LOG_FILE}.1"

    : >"$LOG_FILE"
    chmod 600 "$LOG_FILE"

    echo "Rotated: $LOG_FILE"
}

mkdir -p "$LOG_DIR"
chmod 700 "$LOG_DIR"

for LOG_NAME in \
    server.log \
    code-server.log \
    backup.log \
    watchdog.log \
    healthcheck.log \
    device-status.log \
    trash-cleanup.log \
    log-rotation.log \
    storage-check.log \
    nas-history-cleanup.log; do
    rotate_log "$LOG_DIR/$LOG_NAME"
done

echo "Log rotation completed."
