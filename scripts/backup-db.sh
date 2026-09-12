#!/data/data/com.termux/files/usr/bin/sh

set -eu

APP_DIR="$HOME/apps/myserver"
DATABASE="$APP_DIR/data/server.db"
BACKUP_DIR="$APP_DIR/backups"
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
BACKUP_FILE="$BACKUP_DIR/server-$TIMESTAMP.db"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DATABASE" ]; then
    echo "Database not found: $DATABASE"
    exit 1
fi

sqlite3 "$DATABASE" ".backup '$BACKUP_FILE'"

RESULT="$(sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;")"

if [ "$RESULT" != "ok" ]; then
    echo "Backup integrity check failed: $RESULT"
    rm -f "$BACKUP_FILE"
    exit 1
fi

chmod 600 "$BACKUP_FILE"

find "$BACKUP_DIR" \
    -type f \
    -name 'server-*.db' \
    -mtime +14 \
    -print \
    -delete

echo "Backup created: $BACKUP_FILE"
