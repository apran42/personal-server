#!/data/data/com.termux/files/usr/bin/sh

set -eu

NAS_HISTORY_REMOTE="gcrypt:NAS-History"
RETENTION_DAYS=90
MODE="${1:---dry-run}"
CUTOFF="$(date -d "$RETENTION_DAYS days ago" '+%Y%m%d-%H%M%S')"

if [ "$MODE" != "--dry-run" ] && [ "$MODE" != "--apply" ]; then
    echo "Usage: $0 [--dry-run|--apply]"
    exit 1
fi

echo "NAS history cleanup started: $MODE"
echo "Retention: $RETENTION_DAYS days"
echo "Cutoff: $CUTOFF"

rclone lsf "$NAS_HISTORY_REMOTE" --dirs-only 2>/dev/null |
while IFS= read -r DIRECTORY; do
    TIMESTAMP="${DIRECTORY%/}"

    case "$TIMESTAMP" in
        ????????-??????) ;;
        *)
            echo "Skipping unexpected directory: $DIRECTORY"
            continue
            ;;
    esac

    OLDEST="$(
        printf '%s\n%s\n' "$TIMESTAMP" "$CUTOFF" |
        sort |
        head -n 1
    )"

    if [ "$OLDEST" = "$TIMESTAMP" ] && [ "$TIMESTAMP" != "$CUTOFF" ]; then
        echo "Expired: $NAS_HISTORY_REMOTE/$TIMESTAMP"

        if [ "$MODE" = "--apply" ]; then
            rclone purge "$NAS_HISTORY_REMOTE/$TIMESTAMP"
        fi
    fi
done

echo "NAS history cleanup completed."