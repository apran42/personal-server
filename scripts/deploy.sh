#!/data/data/com.termux/files/usr/bin/sh

set -eu

REPO_DIR="$HOME/projects/note10-personal-server"
APP_DIR="$HOME/apps/myserver"
LOG_FILE="$APP_DIR/logs/server.log"

echo "1/6 Checking repository"
cd "$REPO_DIR"

if [ -n "$(git status --porcelain)" ]; then
    echo "Repository has uncommitted changes."
    exit 1
fi

echo "2/6 Pulling latest code"
git pull --ff-only

echo "3/6 Backing up database"
"$APP_DIR/scripts/backup-db.sh"

echo "4/6 Installing dependencies"
cp "$REPO_DIR/package.json" "$APP_DIR/package.json"
cp "$REPO_DIR/package-lock.json" "$APP_DIR/package-lock.json"

cd "$APP_DIR"
npm ci --omit=dev

echo "5/6 Copying application files"

for FILE in server.js auth.js nas.js system.js; do
    cp "$REPO_DIR/$FILE" "$APP_DIR/$FILE"
done

mkdir -p "$APP_DIR/public" "$APP_DIR/scripts" "$APP_DIR/logs"

cp -R "$REPO_DIR/public/." "$APP_DIR/public/"
for SCRIPT in \
    backup-db.sh \
    cloud-backup.sh \
    cleanup-trash.sh \
    cleanup-nas-history.sh \
    run-backup-monitored.sh \
    check-server-health.sh \
    rotate-logs.sh \
    check-storage.sh \
do
    cp \
        "$REPO_DIR/scripts/$SCRIPT" \
        "$APP_DIR/scripts/$SCRIPT"
done

chmod +x \
    "$APP_DIR/scripts/backup-db.sh" \
    "$APP_DIR/scripts/cloud-backup.sh" \
    "$APP_DIR/scripts/cleanup-trash.sh" \
    "$APP_DIR/scripts/cleanup-nas-history.sh" \
    "$APP_DIR/scripts/run-backup-monitored.sh" \
    "$APP_DIR/scripts/check-server-health.sh" \
    "$APP_DIR/scripts/rotate-logs.sh" \
    "$APP_DIR/scripts/check-storage.sh"

echo "6/6 Restarting server"

tmux kill-session -t myserver 2>/dev/null || true

tmux new-session -d -s myserver \
    "cd $APP_DIR && exec npm start >> $LOG_FILE 2>&1"

ATTEMPT=1

while [ "$ATTEMPT" -le 10 ]; do
    if node --env-file="$APP_DIR/.env" -e '
        const port = process.env.PORT || "8000";
        const credentials =
            process.env.SERVER_USERNAME + ":" +
            process.env.SERVER_PASSWORD;
        const authorization =
            "Basic " + Buffer.from(credentials).toString("base64");

        fetch("http://127.0.0.1:" + port + "/health", {
            headers: { authorization }
        }).then(response => {
            if (!response.ok) {
                throw new Error("HTTP " + response.status);
            }
            return response.text();
        }).then(body => {
            console.log(body);
        }).catch(error => {
            console.error(error.message);
            process.exit(1);
        });
    '; then
        echo "Deployment completed successfully."
        exit 0
    fi

    sleep 2
    ATTEMPT=$((ATTEMPT + 1))
done

echo "Deployment health check failed."
echo "Check log: $LOG_FILE"
exit 1