#!/data/data/com.termux/files/usr/bin/sh

set -eu

APP_DIR="$HOME/apps/myserver"
BACKUP_DIR="$APP_DIR/backups"
REMOTE="gcrypt:Database"

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

echo "Uploading: $BACKUP_NAME"

rclone copyto \
    "$LATEST_BACKUP" \
    "$REMOTE/$BACKUP_NAME"

echo "Checking uploaded backup"

if ! rclone lsf "$REMOTE" | grep -Fx "$BACKUP_NAME" >/dev/null; then
    echo "Uploaded backup was not found."
    exit 1
fi

echo "Removing cloud database backups older than 90 days"

rclone delete "$REMOTE" \
    --min-age 90d \
    --include 'server-*.db'

echo "Cloud backup completed: $BACKUP_NAME"