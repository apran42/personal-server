#!/data/data/com.termux/files/usr/bin/sh

set -eu

TRASH_DIR="$HOME/storage/shared/NAS/.Trash"
MODE="${1:---dry-run}"
RETENTION_MINUTES=43200

case "$MODE" in
    --dry-run|--apply)
        ;;
    *)
        echo "Usage: $0 [--dry-run|--apply]"
        exit 1
        ;;
esac

if [ ! -d "$TRASH_DIR" ]; then
    echo "Trash directory does not exist: $TRASH_DIR"
    exit 0
fi

echo "Trash cleanup started: $MODE"
echo "Retention: 30 days"

FOUND=0

find "$TRASH_DIR" \
    -mindepth 1 \
    -maxdepth 1 \
    -type d \
    -mmin "+$RETENTION_MINUTES" \
    -print |
while IFS= read -r ITEM; do
    case "$ITEM" in
        "$TRASH_DIR"/*)
            ;;
        *)
            echo "Unsafe path rejected: $ITEM"
            exit 1
            ;;
    esac

    FOUND=1

    if [ "$MODE" = "--apply" ]; then
        rm -rf -- "$ITEM"
        echo "Deleted: $ITEM"
    else
        echo "Would delete: $ITEM"
    fi
done

echo "Trash cleanup completed."