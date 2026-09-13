#!/data/data/com.termux/files/usr/bin/sh

set -u

APP_DIR="$HOME/apps/myserver"
CONFIG_FILE="$HOME/.config/myserver/healthchecks.env"

if [ ! -r "$CONFIG_FILE" ]; then
    echo "Healthchecks configuration not found."
    exit 1
fi

. "$CONFIG_FILE"

if [ -z "${SERVER_PING_URL:-}" ]; then
    echo "SERVER_PING_URL is not configured."
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

check_local_server() {
    node \
        --env-file="$APP_DIR/.env" \
        -e '
          const port = process.env.PORT || "8000";

          const credentials =
            process.env.SERVER_USERNAME +
            ":" +
            process.env.SERVER_PASSWORD;

          const authorization =
            "Basic " +
            Buffer.from(credentials).toString("base64");

          fetch(
            "http://127.0.0.1:" + port + "/health",
            {
              headers: { authorization },
              signal: AbortSignal.timeout(5000)
            }
          )
            .then((response) => {
              if (!response.ok) {
                throw new Error(
                  "HTTP " + response.status
                );
              }

              return response.json();
            })
            .then((body) => {
              if (body.status !== "ok") {
                throw new Error(
                  "Invalid health response"
                );
              }
            })
            .catch((error) => {
              console.error(error.message);
              process.exit(1);
            });
        '
}

if check_local_server; then
    send_ping "$SERVER_PING_URL" ||
        echo "Warning: server success ping failed."

    echo "Server health check passed."
    exit 0
fi

send_ping "$SERVER_PING_URL/fail" ||
    echo "Warning: server failure ping failed."

echo "Server health check failed."
exit 1