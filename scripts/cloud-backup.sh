#!/data/data/com.termux/files/usr/bin/sh

set -eu

APP_DIR="$HOME/apps/myserver"
BACKUP_DIR="$APP_DIR/backups"
NAS_DIR="$HOME/storage/shared/NAS"

DATABASE_REMOTE="gcrypt:Database"
NAS_REMOTE="gcrypt:NAS"

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

echo "Uploading complete NAS contents"

rclone copy \
    "$NAS_DIR" \
    "$NAS_REMOTE" \
    --exclude '/.Trash/**' \
    --exclude '/.Trash' \
    --create-empty-src-dirs

echo "Cloud backup completed."