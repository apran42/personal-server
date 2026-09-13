#!/usr/bin/env sh

set -eu

REPO_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
TEST_DIRECTORY="$(mktemp -d)"
LOG_FILE="$TEST_DIRECTORY/server.log"
TEST_NAS="$TEST_DIRECTORY/nas"
TEST_DATABASE="$TEST_DIRECTORY/server.db"
SERVER_PID=""

mkdir -p "$TEST_NAS"

cleanup() {
    if [ -n "$SERVER_PID" ]; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi

    if [ -n "${TEST_DIRECTORY:-}" ] &&
       [ -d "$TEST_DIRECTORY" ]; then
        rm -rf -- "$TEST_DIRECTORY"
    fi
}

trap cleanup EXIT INT TERM

cd "$REPO_DIR"

SERVER_USERNAME="ci-user" \
SERVER_PASSWORD="ci-password" \
HOST="127.0.0.1" \
PORT="18000" \
NAS_ROOT="$TEST_NAS" \
DATABASE_PATH="$TEST_DATABASE" \
node server.js >"$LOG_FILE" 2>&1 &

SERVER_PID="$!"



run_nas_api_tests() {
    BASE_URL="http://127.0.0.1:18000"
    AUTHENTICATION="ci-user:ci-password"

    UPLOAD_FILE="$TEST_DIRECTORY/ci-upload.txt"
    DOWNLOAD_FILE="$TEST_DIRECTORY/ci-download.txt"

    printf 'NAS API test\n' > "$UPLOAD_FILE"

    curl -fs \
        -u "$AUTHENTICATION" \
        -H "Content-Type: application/json" \
        -d '{"path":"","name":"CI Test"}' \
        "$BASE_URL/nas/folder" \
        >/dev/null

    curl -fs \
        -u "$AUTHENTICATION" \
        -F "files=@$UPLOAD_FILE;filename=ci-upload.txt" \
        "$BASE_URL/nas/upload?dir=CI%20Test" \
        >/dev/null

    SEARCH_RESPONSE="$(
        curl -fs \
            -u "$AUTHENTICATION" \
            "$BASE_URL/nas/search?q=ci-upload"
    )"

    printf '%s' "$SEARCH_RESPONSE" |
        grep -q '"name":"ci-upload.txt"'

    curl -fs \
        -u "$AUTHENTICATION" \
        --output "$DOWNLOAD_FILE" \
        "$BASE_URL/nas/download?path=CI%20Test%2Fci-upload.txt"

    cmp "$UPLOAD_FILE" "$DOWNLOAD_FILE"

        curl -fs \
        -u "$AUTHENTICATION" \
        -X PATCH \
        -H "Content-Type: application/json" \
        -d '{
          "path":"CI Test/ci-upload.txt",
          "name":"ci-renamed.txt"
        }' \
        "$BASE_URL/nas/entry" \
        >/dev/null

    curl -fs \
        -u "$AUTHENTICATION" \
        -H "Content-Type: application/json" \
        -d '{"path":"","name":"CI Destination"}' \
        "$BASE_URL/nas/folder" \
        >/dev/null

    curl -fs \
        -u "$AUTHENTICATION" \
        -H "Content-Type: application/json" \
        -d '{
          "path":"CI Test/ci-renamed.txt",
          "destination":"CI Destination"
        }' \
        "$BASE_URL/nas/move" \
        >/dev/null

    TRASH_RESPONSE="$(
        curl -fs \
            -u "$AUTHENTICATION" \
            -X DELETE \
            -G \
            --data-urlencode \
            "path=CI Destination/ci-renamed.txt" \
            "$BASE_URL/nas/entry"
    )"

    TRASH_ID="$(
        node -e '
          const item = JSON.parse(process.argv[1]);
          process.stdout.write(item.id);
        ' "$TRASH_RESPONSE"
    )"

    curl -fs \
        -u "$AUTHENTICATION" \
        "$BASE_URL/nas/trash" |
        grep -q "$TRASH_ID"

    printf '{"id":"%s"}' "$TRASH_ID" |
        curl -fs \
            -u "$AUTHENTICATION" \
            -H "Content-Type: application/json" \
            --data-binary @- \
            "$BASE_URL/nas/trash/restore" \
            >/dev/null

    curl -fs \
        -u "$AUTHENTICATION" \
        --output "$DOWNLOAD_FILE" \
        "$BASE_URL/nas/download?path=CI%20Destination%2Fci-renamed.txt"

    cmp "$UPLOAD_FILE" "$DOWNLOAD_FILE"

    DELETE_RESPONSE="$(
        curl -fs \
            -u "$AUTHENTICATION" \
            -X DELETE \
            -G \
            --data-urlencode \
            "path=CI Destination/ci-renamed.txt" \
            "$BASE_URL/nas/entry"
    )"

    DELETE_ID="$(
        node -e '
          const item = JSON.parse(process.argv[1]);
          process.stdout.write(item.id);
        ' "$DELETE_RESPONSE"
    )"

    curl -fs \
        -u "$AUTHENTICATION" \
        -X DELETE \
        "$BASE_URL/nas/trash/$DELETE_ID"

    if curl -fs \
        -u "$AUTHENTICATION" \
        "$BASE_URL/nas/trash" |
        grep -q "$DELETE_ID"; then
        echo "Permanent deletion test failed."
        exit 1
    fi

    echo "NAS API test passed."
}

ATTEMPT=1

while [ "$ATTEMPT" -le 15 ]; do
    if RESPONSE="$(
        curl -fs \
            -u "ci-user:ci-password" \
            "http://127.0.0.1:18000/health"
    )"; then
        echo "$RESPONSE" | grep -q '"status":"ok"'
        echo "Smoke test passed: $RESPONSE"
        run_nas_api_tests
        exit 0
    fi

    sleep 1
    ATTEMPT=$((ATTEMPT + 1))
done

echo "Server did not become healthy."
cat "$LOG_FILE"
exit 1