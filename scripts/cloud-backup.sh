#!/data/data/com.termux/files/usr/bin/sh

set -eu

APP_DIR="$HOME/apps/myserver"
BACKUP_DIR="$APP_DIR/backups"
NAS_DIR="$HOME/storage/shared/NAS"

DATABASE_REMOTE="gcrypt:Database"
NAS_REMOTE="gcrypt:NAS"
NAS_HISTORY_REMOTE="gcrypt:NAS-History"
NAS_HISTORY_TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"

LATEST_BACKUP="$(
    find "$BACKUP_DIR" \
        -type f \
        -name 'server-*.db' \
        -print |
        sort |
        tail -n 1
)"

if [ -z "$LATEST_BACKUP" ]; then
    echo "No local database backup found."
    exit 1
fi

BACKUP_NAME="$(basename "$LATEST_BACKUP")"

echo "Uploading database: $BACKUP_NAME"

rclone copyto \
    "$LATEST_BACKUP" \
    "$DATABASE_REMOTE/$BACKUP_NAME"

echo "Checking uploaded database"

if ! rclone lsf "$DATABASE_REMOTE" |
    grep -Fx "$BACKUP_NAME" >/dev/null; then
    echo "Uploaded database backup was not found."
    exit 1
fi

echo "Removing cloud database backups older than 90 days"

rclone delete "$DATABASE_REMOTE" \
    --min-age 90d \
    --include 'server-*.db'

echo "Synchronizing complete NAS contents"

rclone sync \
    "$NAS_DIR" \
    "$NAS_REMOTE" \
    --backup-dir \
    "$NAS_HISTORY_REMOTE/$NAS_HISTORY_TIMESTAMP" \
    --exclude '/.Trash/**' \
    --exclude '/.Trash' \
    --create-empty-src-dirs \
    --max-delete 50 \
    --check-first

echo "Cloud backup completed."
